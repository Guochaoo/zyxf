import rateLimit from 'express-rate-limit';

// Shared per-route rate limiter for admin-bypassed endpoints (downloads,
// AI chat, sync). Admins bypass the cap; guests are limited.
export const adminBypassLimiter = (windowMs, max, message) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.user?.role === 'admin',
    message: { error: message },
  });
