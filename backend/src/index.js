import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { db, ensureAdmin } from './db.js';
import { attachUser } from './auth.js';
import authRoutes from './routes/auth.js';
import folderRoutes from './routes/folders.js';
import fileRoutes from './routes/files.js';
import searchRoutes from './routes/search.js';
import statsRoutes from './routes/stats.js';

const app = express();
const PORT = Number(process.env.PORT) || 4000;

const adminUser = process.env.ADMIN_USER || 'admin';
const adminPass = process.env.ADMIN_PASSWORD || 'admin123';
if (!process.env.ADMIN_PASSWORD && process.env.NODE_ENV !== 'development') {
  console.warn('[index] WARNING: ADMIN_PASSWORD not set in environment — using insecure default. Set it in .env.');
}
ensureAdmin(adminUser, adminPass);

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

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'internal error' });
});

app.listen(PORT, () => {
  console.log(`[zyxf-backend] listening on http://localhost:${PORT}`);
});
