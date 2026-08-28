// Shared Express helpers used by every route file.

// Express 4 does NOT await/catch rejected promises returned by async handlers;
// an unhandled rejection would terminate the process (Node ≥ 15). Wrap every
// async handler so a rejection is forwarded to the error middleware as a 500.
export const wrapAsync = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// Log + 502 JSON for a failed external-service call (OSS / IMM / upstream).
// Keeps the "log the real error, never leak internals to clients" shape
// identical across route files.
export function serviceError(res, e, message) {
  console.warn(message, e?.message || e);
  return res.status(502).json({ error: message });
}
