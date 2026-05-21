import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { db, ensureAdmin } from './db.js';
import { attachUser } from './auth.js';
import authRoutes from './routes/auth.js';
import folderRoutes from './routes/folders.js';
import fileRoutes from './routes/files.js';
import searchRoutes from './routes/search.js';
import statsRoutes from './routes/stats.js';

const app = express();
const PORT = Number(process.env.PORT) || 4000;
const isProd = process.env.NODE_ENV === 'production';

// ---- Production safety: refuse to start with insecure defaults ----
if (isProd) {
  const missing = [];
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'dev-secret') missing.push('JWT_SECRET');
  if (!process.env.ADMIN_PASSWORD) missing.push('ADMIN_PASSWORD');
  if (missing.length) {
    console.error(
      `[index] FATAL: in production but ${missing.join(', ')} not set. Refusing to start with insecure defaults.`
    );
    process.exit(1);
  }
  if (!process.env.CORS_ORIGIN || process.env.CORS_ORIGIN === '*') {
    console.warn('[index] WARNING: CORS_ORIGIN is "*" in production. Restrict to your real origin.');
  }
}

const adminUser = process.env.ADMIN_USER || 'admin';
const adminPass = process.env.ADMIN_PASSWORD || 'admin123';
if (!process.env.ADMIN_PASSWORD && !isProd) {
  console.warn('[index] dev mode: using default admin password (admin123).');
}
ensureAdmin(adminUser, adminPass);

// Behind nginx / load balancer: trust the first proxy so req.ip is the client IP.
app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: false, // keep off for now — Vite/HMR & inline styles
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || '*',
  })
);
app.use(express.json({ limit: '1mb' }));
app.use(attachUser);

app.get('/api/health', (_req, res) => res.json({ ok: true, time: Date.now() }));
app.use('/api/auth', authRoutes);
app.use('/api/folders', folderRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/stats', statsRoutes);

// Sanitize errors in production — never leak internals to clients.
app.use((err, _req, res, _next) => {
  console.error(err);
  if (isProd) {
    return res.status(err.status || 500).json({ error: 'internal error' });
  }
  res.status(err.status || 500).json({ error: err.message || 'internal error' });
});

app.listen(PORT, () => {
  console.log(`[zyxf-backend] listening on http://localhost:${PORT}`);
});
