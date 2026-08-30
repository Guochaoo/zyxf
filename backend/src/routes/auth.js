import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { db } from '../db.js';
import { isUniqueError } from '../dbHelpers.js';
import { signToken } from '../auth.js';
import { wrapAsync, serviceError } from '../http.js';
import { isMailEnabled, sendVerificationCode } from '../mail.js';

const router = Router();

// Brute-force protection: 10 attempts per 15 min per IP.
// Successful logins do not count toward the cap.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: '尝试次数过多,请稍后再试' },
});

// 发码限流：每 IP 每小时 10 次（叠加在全局 publicLimiter 之上）。
const codeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '验证码请求过于频繁，请稍后再试' },
});

// 注册限流：每 IP 每分钟 15 次。
const registerLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '操作过于频繁，请稍后再试' },
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_TTL_MS = 10 * 60 * 1000; // 验证码有效期 10 分钟
const RESEND_COOLDOWN_MS = 60 * 1000; // 同一邮箱重发冷却 60 秒
const DAILY_SEND_LIMIT = 10; // 同一邮箱 24h 内最多发 10 次
const MAX_CODE_ATTEMPTS = 5; // 单个验证码最多可尝试核验 5 次

const hashCode = (code) => crypto.createHash('sha256').update(String(code)).digest('hex');
const normalizeEmail = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : '');

router.post('/login', loginLimiter, (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' });
  }
  // 用户名或邮箱均可登录：邮箱统一小写后匹配（注册时已归一化存储）。
  const identifier = String(username).trim();
  const user = db
    .prepare('SELECT * FROM users WHERE username = ? OR email = ?')
    .get(identifier, identifier.toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  const token = signToken({ id: user.id, username: user.username, role: user.role });
  res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
});

// 发送注册验证码。冷却/日限额状态存 email_codes 行，随验证码一起覆写。
router.post('/register/code', codeLimiter, wrapAsync(async (req, res) => {
  if (!isMailEnabled()) {
    return res.status(503).json({ error: '邮件功能未配置，请联系管理员' });
  }
  const email = normalizeEmail(req.body?.email);
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: '邮箱格式不正确' });
  }
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
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
  db.prepare(
    `INSERT INTO email_codes (email, code_hash, attempts, expires_at, created_at, sent_count, first_sent_at)
     VALUES (?, ?, 0, ?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET
       code_hash = excluded.code_hash, attempts = 0, expires_at = excluded.expires_at,
       created_at = excluded.created_at, sent_count = excluded.sent_count, first_sent_at = excluded.first_sent_at`
  ).run(email, hashCode(code), now + CODE_TTL_MS, now, sentCount + 1, firstSentAt);

  try {
    await sendVerificationCode(email, code);
  } catch (e) {
    return serviceError(res, e, '验证码邮件发送失败，请稍后再试');
  }
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
  if (password.length < 8 || password.length > 72) {
    return res.status(400).json({ error: '密码需为 8-72 位' });
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

  // 先给出更友好的重复提示；并发下的竞态由下方 UNIQUE 捕获兜底。
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
    return res.status(409).json({ error: '用户名已被使用' });
  }
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
    return res.status(409).json({ error: '该邮箱已被注册' });
  }

  const hash = bcrypt.hashSync(password, 10);
  try {
    const info = db
      .prepare('INSERT INTO users (username, password_hash, role, email, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(username, hash, 'user', email, now);
    db.prepare('DELETE FROM email_codes WHERE email = ?').run(email);
    const user = { id: Number(info.lastInsertRowid), username, role: 'user' };
    res.json({ token: signToken(user), user });
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
