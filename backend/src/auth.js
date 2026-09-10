import jwt from 'jsonwebtoken';

export const DEV_JWT_SECRET = 'dev-secret';

const SECRET = process.env.JWT_SECRET || DEV_JWT_SECRET;
const EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

if (!process.env.JWT_SECRET && process.env.NODE_ENV !== 'development') {
  console.warn('[auth] WARNING: JWT_SECRET not set in environment — using insecure default. Set it in .env.');
}

// 显式固定 HS256：对称密钥场景下 pin 算法可杜绝算法混淆类攻击，
// 且不受 jsonwebtoken 默认算法变化的影响。
const ALGORITHM = 'HS256';

export function signToken(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: EXPIRES_IN, algorithm: ALGORITHM });
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, SECRET, { algorithms: [ALGORITHM] });
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
