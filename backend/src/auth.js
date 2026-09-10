import jwt from 'jsonwebtoken';
import { db } from './db.js';

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
    if (payload) {
      // 回查用户行（BUG-51/52）：只验签意味着「改密前签发的 token」「被删除或被降权的
      // 账号」在 exp（默认 7d）之前仍是有效身份——运维按文档改 ADMIN_PASSWORD 也无法止损。
      // 按主键取一行，顺带用库里的 role 覆盖 payload，使降权立即生效。
      // epoch 缺省按 0 处理：升级前签发的 token 仍可用，一次改密（epoch+1）后即失效。
      const row = db
        .prepare('SELECT username, role, token_epoch FROM users WHERE id = ?')
        .get(payload.id);
      if (row && (payload.epoch ?? 0) === row.token_epoch) {
        req.user = { id: payload.id, username: row.username, role: row.role, epoch: row.token_epoch };
      }
    }
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
