import rateLimit from 'express-rate-limit';

// Shared options for every limiter: standardized headers + JSON error body.
export const limiterOptions = (windowMs, max, message) => ({
  windowMs,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: message },
});

// Shared per-route rate limiter for admin-bypassed endpoints (downloads,
// AI chat, sync). Admins bypass the cap; guests are limited.
export const adminBypassLimiter = (windowMs, max, message) =>
  rateLimit({ ...limiterOptions(windowMs, max, message), skip: (req) => req.user?.role === 'admin' });
