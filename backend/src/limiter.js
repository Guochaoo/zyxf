import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

// Shared options for every limiter: standardized headers + JSON error body.
export const limiterOptions = (windowMs, max, message) => ({
  windowMs,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: message },
});

// Shared per-route rate limiter for admin-bypassed endpoints (downloads,
// AI chat). Admins bypass the cap; guests are limited.
export const adminBypassLimiter = (windowMs, max, message) =>
  rateLimit({ ...limiterOptions(windowMs, max, message), skip: (req) => req.user?.role === 'admin' });

// 分层限流器：同一端点对游客/登录用户/管理员给出递增配额
// （游客最紧 → 登录用户更宽 → 管理员豁免），用于允许游客调用的写操作。
// 登录用户按 user id 计数，避免同一办公网/NAT 出口共用一个 IP 配额；
// 游客仍按 IP 计数，ipKeyGenerator 会把 IPv6 归并到同一子网。
export const tieredLimiter = ({ windowMs, guest, user, message }) =>
  rateLimit({
    ...limiterOptions(windowMs, user, message),
    limit: (req) => (req.user ? user : guest),
    skip: (req) => req.user?.role === 'admin',
    keyGenerator: (req) => (req.user ? `u:${req.user.id}` : ipKeyGenerator(req.ip)),
  });
