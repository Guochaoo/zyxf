import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

/**
 * 密码哈希（IMPROVE-16）。
 *
 * 用 Node 内置的 `crypto.scrypt`（libuv 线程池，真异步）而不是 bcryptjs：后者是纯 JS
 * 实现，一次哈希期间事件循环被独占约 40 ms（实测 timer 被推迟 40 ms），登录/注册会把
 * 同一时刻的 /api/health、下载、搜索全部排队。scrypt 在相同耗时（≈42 ms）下事件循环
 * 只被推迟 1 ms。
 *
 * 参数 N=32768, r=8, p=1 是 OWASP 对 scrypt 的推荐档位（内存 32 MB / 次，需显式放宽
 * Node 默认的 32 MB maxmem 限制）；存储格式 `scrypt$N$r$p$salt$hash`，参数随哈希走，
 * 以后再调档位不影响旧密码。
 *
 * 兼容：库里已有的 bcrypt 哈希（`$2a$/$2b$/$2y$`）仍能用来校验，校验通过后由调用方
 * 用新的 scrypt 哈希覆盖（见 routes/auth.js 的登录路径），存量账号会在首次登录时迁移。
 *
 * 为什么还留着 bcryptjs 依赖：只服务于上面这条兼容路径（`verifyPassword` 的 legacy 分支）。
 * 存量账号全部迁移完之后可以删掉该依赖与这个分支；注册/登录的新哈希一律走 scrypt。
 */
const SCRYPT_PARAMS = { N: 32768, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const KEY_LEN = 32;
const SALT_LEN = 16;

// crypto.scrypt 对「参数畸形」抛出的错误码（见 verifyPassword 的分类）：这些等价于
// 「库里的哈希坏了，校验不通过」，不应该把它升级成 500。
const MALFORMED_HASH_ERRORS = new Set([
  'ERR_CRYPTO_INVALID_SCRYPT_PARAMS',
  'ERR_OUT_OF_RANGE',
  'ERR_INVALID_ARG_TYPE',
  'ERR_INVALID_ARG_VALUE',
]);

const scryptAsync = (password, salt, opts) =>
  new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, KEY_LEN, opts, (err, key) => (err ? reject(err) : resolve(key)));
  });

/** 生成新的密码哈希（scrypt）。 */
export async function hashPassword(password) {
  const salt = crypto.randomBytes(SALT_LEN);
  const key = await scryptAsync(password, salt, SCRYPT_PARAMS);
  const { N, r, p } = SCRYPT_PARAMS;
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

/** 是否为 bcrypt 历史哈希（用于登录时判断是否需要迁移）。 */
export const isLegacyHash = (hash) => typeof hash === 'string' && /^\$2[aby]\$/.test(hash);

/**
 * 校验密码。返回 { ok, legacy }：legacy=true 表示这次是通过旧 bcrypt 哈希校验成功的，
 * 调用方应把该行升级为 scrypt 哈希。
 *
 * ⚠️ 「存储的哈希本身畸形」与「scrypt 执行失败」必须分开：前者按校验不通过处理，
 * 后者要冒泡成 500。原先所有 scrypt 异常都被 catch 成 { ok: false }，于是一次瞬时的
 * 资源性失败（内存/线程池）会在登录接口原样表现成 401「用户名或密码错误」——
 * 用户以为密码错了，测试里表现为「admin 登录没拿到 token」，真实原因被彻底掩盖
 * （BUG-104 的偶发签名就是这个形状：干净检出、约 4–6% 的运行、无 429/500 可辨）。
 */
export async function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || !stored) return { ok: false, legacy: false };

  if (isLegacyHash(stored)) {
    const ok = await bcrypt.compare(password, stored);
    return { ok, legacy: ok };
  }

  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return { ok: false, legacy: false };
  const [, n, r, p, saltB64, keyB64] = parts;
  try {
    const key = await scryptAsync(password, Buffer.from(saltB64, 'base64'), {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: SCRYPT_PARAMS.maxmem,
    });
    const expected = Buffer.from(keyB64, 'base64');
    // 长度不同时 timingSafeEqual 会抛错，先比长度（不是秘密信息）
    const ok = key.length === expected.length && crypto.timingSafeEqual(key, expected);
    return { ok, legacy: false };
  } catch (e) {
    // 参数/取值非法 = 库里的哈希畸形（例如 N 非数字、超出 maxmem），等价于校验失败；
    // 其它错误（ENOMEM、线程池失败等）不吞，交给上层变成 500 并带上真实原因。
    if (MALFORMED_HASH_ERRORS.has(e?.code)) return { ok: false, legacy: false };
    throw e;
  }
}

// 账号不存在时也要跑一次等价的哈希，抹平「不存在」与「密码错」之间的时间差（BUG-70）。
// 惰性生成一次，避免模块加载期做昂贵计算。
// 失败不能被缓存：一次瞬时的资源性失败若留在 memo 里，之后所有「账号不存在」的登录都会
// 一直 500（改成 reject 时清空）。
let dummyHashPromise = null;
export const dummyPasswordHash = () => {
  if (!dummyHashPromise) {
    dummyHashPromise = hashPassword('timing-equalizer').catch((e) => {
      dummyHashPromise = null;
      throw e;
    });
  }
  return dummyHashPromise;
};
