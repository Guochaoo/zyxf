import './env.js';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { ensureAdmin, pruneDownloadLogs } from './db.js';
import { attachUser, DEV_JWT_SECRET } from './auth.js';
import { limiterOptions } from './limiter.js';
import authRoutes from './routes/auth.js';
import folderRoutes from './routes/folders.js';
import fileRoutes from './routes/files.js';
import searchRoutes from './routes/search.js';
import chatRoutes from './routes/chat.js';
import statsRoutes from './routes/stats.js';
import syncRoutes from './routes/sync.js';

const app = express();
const PORT = Number(process.env.PORT) || 4000;
// 默认只绑回环：后端始终位于 nginx / Vite 代理之后，绑 127.0.0.1 可确保外部
// 无法直连，也就无法伪造 X-Forwarded-For 绕过限流（trust proxy 会采信该头）。
// 确需其它主机直连时显式设 HOST=0.0.0.0。
const HOST = process.env.HOST || '127.0.0.1';
const isProd = process.env.NODE_ENV === 'production';

// ---- Production safety: refuse to start with insecure defaults ----
if (isProd) {
  const missing = [];
  const jwt = process.env.JWT_SECRET || '';
  const pwd = process.env.ADMIN_PASSWORD || '';
  // Reject placeholder/example values from the repo, not just the literal dev default.
  const weak = /change|example|placeholder|secret|dev|test|admin123|123456/i;
  if (!jwt || jwt === DEV_JWT_SECRET || jwt.length < 32 || weak.test(jwt)) missing.push('JWT_SECRET');
  if (!pwd || pwd.length < 12 || weak.test(pwd)) missing.push('ADMIN_PASSWORD');
  if (missing.length) {
    console.error(
      `[index] FATAL: in production but ${missing.join(', ')} not set. Refusing to start with insecure defaults.`
    );
    process.exit(1);
  }
  if (!process.env.CORS_ORIGIN || process.env.CORS_ORIGIN === '*') {
    console.error(
      '[index] FATAL: in production but CORS_ORIGIN is missing or "*". Refusing to start with an open CORS policy. Set it to your real origin.'
    );
    process.exit(1);
  }
}

// ---- Loose anti-abuse limit for anonymous API traffic ----
// login/download have their own tighter limits; this only stops scripted floods.
const publicLimiter = rateLimit(limiterOptions(60 * 1000, 300, '请求过于频繁,请稍后再试'));

const adminUser = process.env.ADMIN_USER || 'admin';
const adminPass = process.env.ADMIN_PASSWORD || 'admin123';
if (!process.env.ADMIN_PASSWORD && !isProd) {
  console.warn('[index] dev mode: using default admin password (admin123).');
}
ensureAdmin(adminUser, adminPass);
// 清理超出保留期的下载日志（含 ip/ua），避免 PII 无限期留存。
const prunedLogs = pruneDownloadLogs();
if (prunedLogs) console.log(`[db] pruned ${prunedLogs} expired download_logs`);

// Behind nginx: trust the first proxy so req.ip is the client IP.
// Requires nginx to overwrite X-Forwarded-For with $remote_addr (see nginx.conf);
// otherwise clients can spoof the leftmost XFF entry and bypass all rate limits.
app.set('trust proxy', 1);

app.use(
  helmet({
    // CSP 关闭是有意的：后端只服务 /api（JSON），HTML 由 nginx 托管，而 CSP 必须
    // 与页面同源下发才有效——策略配在 frontend/nginx.conf（IMPROVE-11）。
    // 其余 helmet 头（nosniff / X-Frame-Options 等）对 API 响应仍生效。
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);
// CORS 来源：优先环境变量；dev 默认显式允许 Vite 前端（5173），不回退到全开放 '*'。
const devFrontendOrigin = process.env.ALLOWED_DEV_ORIGIN || 'http://localhost:5173';
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || devFrontendOrigin,
  })
);
app.use(express.json({ limit: '1mb' }));
app.use(attachUser);
app.use('/api', publicLimiter);

app.get('/api/health', (_req, res) => res.json({ ok: true, time: Date.now() }));
app.use('/api/auth', authRoutes);
app.use('/api/folders', folderRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/sync', syncRoutes);

// Sanitize errors in production — never leak internals to clients.
app.use((err, _req, res, _next) => {
  console.error(err);
  const message = isProd ? 'internal error' : err.message || 'internal error';
  res.status(err.status || 500).json({ error: message });
});

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  app.listen(PORT, HOST, () => {
    console.log(`[zyxf-backend] listening on http://${HOST}:${PORT}`);
  });
}

export { app };
