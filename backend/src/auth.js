import jwt from 'jsonwebtoken';

export const DEV_JWT_SECRET = 'dev-secret';

const SECRET = process.env.JWT_SECRET || DEV_JWT_SECRET;
const EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

if (!process.env.JWT_SECRET && process.env.NODE_ENV !== 'development') {
  console.warn('[auth] WARNING: JWT_SECRET not set in environment — using insecure default. Set it in .env.');
}

export function signToken(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: EXPIRES_IN });
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, SECRET);
  } catch {
    return null;
  }
}

// Attach req.user if there is a valid token (optional auth).
export function attachUser(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    const payload = verifyToken(token);
    if (payload) req.user = payload;
  }
  next();
}

// Require admin role.
export function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'unauthenticated' });
  }
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'forbidden' });
  }
  next();
}
