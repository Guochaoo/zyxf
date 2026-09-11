import { Router } from 'express';
import crypto from 'node:crypto';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { db } from '../db.js';
import { isUniqueError } from '../dbHelpers.js';
import { signToken } from '../auth.js';
import { wrapAsync, serviceError } from '../http.js';
import { isMailEnabled, sendVerificationCode } from '../mail.js';
import { hashPassword, verifyPassword, dummyPasswordHash } from '../password.js';
import { limiterOptions } from '../limiter.js';

const router = Router();

// Brute-force protection: 10 attempts per 15 min per (IP + 提交的账号)。
// Successful logins do not count toward the cap.
// 原先只按出口 IP 分桶：校园/办公 NAT 下任何人（无需账号、无需知道用户名）打 10 次错密码，
// 就把该出口所有人锁在登录页外 15 分钟（正确密码也拿 429）；反过来对「分布式爆破单个账号」
// 又毫无约束。改按「IP + 账号」分桶，另叠一层纯 IP 的宽松洪泛桶顶住随机用户名的脚本。
const loginLimiter = rateLimit({
  ...limiterOptions(15 * 60 * 1000, 10, '尝试次数过多,请稍后再试'),
  skipSuccessfulRequests: true,
  keyGenerator: (req) =>
    `${ipKeyGenerator(req.ip)}|${String(req.body?.username || '').trim().toLowerCase()}`,
});
const loginFloodLimiter = rateLimit(limiterOptions(15 * 60 * 1000, 100, '尝试次数过多,请稍后再试'));

// 发码限流：每 IP 每小时 10 次（叠加在全局 publicLimiter 之上）。
const codeLimiter = rateLimit(limiterOptions(60 * 60 * 1000, 10, '验证码请求过于频繁，请稍后再试'));

// 注册限流：每 IP 每分钟 15 次。
const registerLimiter = rateLimit(limiterOptions(60 * 1000, 15, '操作过于频繁，请稍后再试'));

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_TTL_MS = 10 * 60 * 1000; // 验证码有效期 10 分钟
const RESEND_COOLDOWN_MS = 60 * 1000; // 同一邮箱重发冷却 60 秒
const DAILY_SEND_LIMIT = 10; // 同一邮箱 24h 内最多发 10 次
const MAX_CODE_ATTEMPTS = 5; // 单个验证码最多可尝试核验 5 次
const MAX_CODE_USES = 3; // 单个验证码核验通过后最多可用于 3 次注册提交（防枚举探测，BUG-71）

const hashCode = (code) => crypto.createHash('sha256').update(String(code)).digest('hex');
const normalizeEmail = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : '');
const emailRegistered = (email) => !!db.prepare('SELECT id FROM users WHERE email = ?').get(email);

// IMPROVE-16：密码哈希改用 crypto.scrypt（见 src/password.js），事件循环不再被哈希独占。
router.post('/login', loginFloodLimiter, loginLimiter, wrapAsync(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' });
  }
  // 用户名或邮箱均可登录：邮箱统一小写后匹配（注册时已归一化存储）。
  const identifier = String(username).trim();
  const user = db
    .prepare('SELECT * FROM users WHERE username = ? OR email = ?')
    .get(identifier, identifier.toLowerCase());
  // 先校验再判 user，两条分支耗时等价（账号不存在时对着 dummy 哈希跑一次，BUG-70）。
  const stored = user ? user.password_hash : await dummyPasswordHash();
  const { ok: passwordOk, legacy } = await verifyPassword(password, stored);
  if (!user || !passwordOk) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  // 历史 bcrypt 哈希在首次成功登录时升级为 scrypt（存量账号无需重置密码）。
  if (legacy) {
    try {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(password), user.id);
    } catch (e) {
      console.warn('[auth] 密码哈希升级失败（不影响本次登录）:', e.message);
    }
  }
  const token = signToken({
    id: user.id,
    username: user.username,
    role: user.role,
    epoch: user.token_epoch ?? 0,
  });
  res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
}));

// 发送注册验证码。冷却/日限额状态存 email_codes 行，随验证码一起覆写。
router.post('/register/code', codeLimiter, wrapAsync(async (req, res) => {
  if (!isMailEnabled()) {
    return res.status(503).json({ error: '邮件功能未配置，请联系管理员' });
  }
  const email = normalizeEmail(req.body?.email);
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: '邮箱格式不正确' });
  }
  if (emailRegistered(email)) {
    return res.status(409).json({ error: '该邮箱已被注册' });
  }
  const now = Date.now();
  const rec = db.prepare('SELECT * FROM email_codes WHERE email = ?').get(email);
  if (rec && now - rec.created_at < RESEND_COOLDOWN_MS) {
    return res.status(429).json({ error: '验证码已发送，请一分钟后再试' });
  }
  // 24h 窗口外的计数视为新一轮，重置额度。
  const sentCount = rec && now - rec.first_sent_at < 24 * 60 * 60 * 1000 ? rec.sent_count : 0;
  if (sentCount >= DAILY_SEND_LIMIT) {
    return res.status(429).json({ error: '该邮箱今日验证码发送次数已达上限，请明天再试' });
  }

  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const firstSentAt = sentCount === 0 ? now : rec.first_sent_at;
  // 先发信、成功后才落库（BUG-69）：原先先 upsert 再发信，失败不回滚——邮件服务抖动时
  // 用户重试 10 次即耗光当日额度（一封码都没收到），且会覆写掉手上那枚仍有效的验证码。
  try {
    await sendVerificationCode(email, code);
  } catch (e) {
    return serviceError(res, e, '验证码邮件发送失败，请稍后再试');
  }
  db.prepare(
    `INSERT INTO email_codes (email, code_hash, attempts, uses, expires_at, created_at, sent_count, first_sent_at)
     VALUES (?, ?, 0, 0, ?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET
       code_hash = excluded.code_hash, attempts = 0, uses = 0, expires_at = excluded.expires_at,
       created_at = excluded.created_at, sent_count = excluded.sent_count, first_sent_at = excluded.first_sent_at`
  ).run(email, hashCode(code), now + CODE_TTL_MS, now, sentCount + 1, firstSentAt);

  res.json({ ok: true, cooldown: RESEND_COOLDOWN_MS / 1000 });
}));

// 注册并自动登录：核验通过即建号（role='user'），直接返回与 /login 同构的
// { token, user }，前端无需二次登录。
router.post('/register', registerLimiter, wrapAsync(async (req, res) => {
  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  const email = normalizeEmail(req.body?.email);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';

  if (username.length < 2 || username.length > 32) {
    return res.status(400).json({ error: '用户名需为 2-32 个字符' });
  }
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: '邮箱格式不正确' });
  }
  // 密码下限按字符数（8 位字符是用户能理解的口径），上限按字节（bcrypt 只用前 72 字节；
  // 现在虽然改用 scrypt，仍保留该上限：校验口径不该随哈希算法变，且老库里还有 bcrypt 账号）：
  // 只判 password.length 会让 40 个汉字（120 字节）通过校验、实际只有前 24 个字生效，
  // 于是「前缀相同、后缀不同」的密码也能登录同一账号（BUG-72）。
  if (password.length < 8 || Buffer.byteLength(password, 'utf8') > 72) {
    return res.status(400).json({ error: '密码至少 8 位，且不超过 72 字节（约 24 个汉字）' });
  }
  if (!/^\d{6}$/.test(code)) {
    return res.status(400).json({ error: '验证码格式不正确' });
  }

  const rec = db.prepare('SELECT * FROM email_codes WHERE email = ?').get(email);
  const now = Date.now();
  if (!rec || rec.expires_at < now) {
    return res.status(400).json({ error: '验证码已过期，请重新获取' });
  }
  if (rec.attempts >= MAX_CODE_ATTEMPTS) {
    return res.status(400).json({ error: '验证码错误次数过多，请重新获取' });
  }
  if (rec.code_hash !== hashCode(code)) {
    db.prepare('UPDATE email_codes SET attempts = attempts + 1 WHERE email = ?').run(email);
    return res.status(400).json({ error: '验证码错误' });
  }
  // 核验通过即记账（BUG-71）：一枚合法验证码若可无限复用，就能拿它反复探测用户名是否
  // 被占用（409 = 已占用），枚举速率比 /login 高两个数量级且不产生失败日志。
  if (rec.uses >= MAX_CODE_USES) {
    return res.status(400).json({ error: '该验证码使用次数过多，请重新获取' });
  }
  db.prepare('UPDATE email_codes SET uses = uses + 1 WHERE email = ?').run(email);

  // 用户名与邮箱冲突返回同一句文案：不透露是哪个字段冲突，避免这里变成存在性 oracle。
  // 并发下的真正冲突仍由下方 UNIQUE 捕获兜底。
  if (
    db.prepare('SELECT id FROM users WHERE username = ?').get(username) ||
    emailRegistered(email)
  ) {
    return res.status(409).json({ error: '用户名或邮箱已被使用' });
  }

  const hash = await hashPassword(password);
  try {
    const info = db
      .prepare('INSERT INTO users (username, password_hash, role, email, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(username, hash, 'user', email, now);
    db.prepare('DELETE FROM email_codes WHERE email = ?').run(email);
    const user = { id: Number(info.lastInsertRowid), username, role: 'user' };
    res.json({ token: signToken({ ...user, epoch: 0 }), user });
  } catch (e) {
    if (isUniqueError(e)) {
      return res.status(409).json({ error: '用户名或邮箱已被使用' });
    }
    throw e;
  }
}));

router.get('/me', (req, res) => {
  res.json({ user: req.user || null });
});

export default router;
