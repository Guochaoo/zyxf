import { Router } from 'express';
import path from 'node:path';
import rateLimit from 'express-rate-limit';
import { db } from '../db.js';
import { requireAdmin } from '../auth.js';
import { buildPostPolicy, copyOssObject, deleteOssObjectIfExists, signedGetUrl } from '../oss.js';
import { mimeOf } from '../mime.js';
import { nextSortOrder } from './folders.js';
import { findFileByNameInFolder, objectKeyForFile, parseOptionalFolderId } from '../storagePath.js';
import { isExtAllowed, normalizeExt, shouldForceDownload } from '../extPolicy.js';

// ---- Anti-abuse: per-IP download rate limit ----
// Only counts download requests (?download=1). Previews are not limited.
// Admins bypass the cap.
const downloadLimiterShort = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // 20 downloads / minute / IP
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.query.download !== '1' || req.user?.role === 'admin',
  message: { error: '下载过于频繁,请稍后再试' },
});
const downloadLimiterLong = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 200, // 200 downloads / hour / IP
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.query.download !== '1' || req.user?.role === 'admin',
  message: { error: '本小时下载次数已达上限,请稍后再试' },
});

// RFC 5987 encode for Content-Disposition filename* parameter.
function encodeRfc5987(value) {
  return encodeURIComponent(value)
    .replace(/['()]/g, escape) // legacy
    .replace(/\*/g, '%2A')
    .replace(/%(?:7C|60|5E)/g, (match) => match.toLowerCase());
}

function dispositionFor(name, asAttachment) {
  const fallback = String(name || 'file').replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
  const type = asAttachment ? 'attachment' : 'inline';
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encodeRfc5987(name)}`;
}

const SHORT_SIGN_TTL = 600; // 10 min — enough for browser to fetch+blob, less link-sharing risk

// In-memory dedupe: same file_id + IP within window counts once.
const DOWNLOAD_DEDUP_WINDOW_MS = 5 * 60 * 1000;
const recentDownloads = new Map(); // key -> expireAt
function shouldLogDownload(fileId, ip) {
  const key = `${fileId}|${ip}`;
  const now = Date.now();
  const exp = recentDownloads.get(key);
  if (exp && exp > now) return false;
  recentDownloads.set(key, now + DOWNLOAD_DEDUP_WINDOW_MS);
  // opportunistic cleanup
  if (recentDownloads.size > 5000) {
    for (const [k, e] of recentDownloads) if (e <= now) recentDownloads.delete(k);
  }
  return true;
}

const router = Router();

// Step 1: ask backend for a signed upload policy
router.post('/upload-url', requireAdmin, (req, res) => {
  const { filename, folder_id } = req.body || {};
  const trimmed = String(filename || '').trim();
  if (!trimmed) return res.status(400).json({ error: 'filename required' });
  const folderId = parseOptionalFolderId(folder_id);
  if (Number.isNaN(folderId)) return res.status(400).json({ error: 'invalid folder id' });
  if (folderId !== null) {
    const f = db.prepare('SELECT id FROM folders WHERE id = ?').get(folderId);
    if (!f) return res.status(400).json({ error: 'folder not found' });
  }
  if (findFileByNameInFolder(db, trimmed, folderId)) {
    return res.status(409).json({ error: 'same filename already exists in this folder' });
  }
  const ext = path.extname(trimmed).toLowerCase();
  if (!isExtAllowed(ext)) {
    return res.status(415).json({ error: `不允许的文件类型: ${ext || '(无扩展名)'}` });
  }
  const key = objectKeyForFile(db, folderId, trimmed);

  const policy = buildPostPolicy({ key });
  res.json({ ...policy, ext });
});

// Step 2: after the browser uploads to OSS, register metadata
router.post('/', requireAdmin, (req, res) => {
  const { name, oss_key, size, mime_type, folder_id } = req.body || {};
  const trimmed = String(name || '').trim();
  if (!trimmed || !oss_key || !Number.isFinite(size)) {
    return res.status(400).json({ error: 'name/oss_key/size required' });
  }
  const folderId = parseOptionalFolderId(folder_id);
  if (Number.isNaN(folderId)) return res.status(400).json({ error: 'invalid folder id' });
  if (folderId !== null) {
    const folder = db.prepare('SELECT id FROM folders WHERE id = ?').get(folderId);
    if (!folder) return res.status(400).json({ error: 'folder not found' });
  }
  if (findFileByNameInFolder(db, trimmed, folderId)) {
    return res.status(409).json({ error: 'same filename already exists in this folder' });
  }
  const expectedKey = objectKeyForFile(db, folderId, trimmed);
  if (oss_key !== expectedKey) {
    return res.status(400).json({ error: 'oss_key does not match folder path' });
  }
  const ext = path.extname(trimmed).toLowerCase().replace(/^\./, '');
  if (!isExtAllowed(ext)) {
    return res.status(415).json({ error: `不允许的文件类型: ${ext || '(无扩展名)'}` });
  }
  const so = nextSortOrder('files', 'folder_id', folderId);
  const info = db
    .prepare(
      `INSERT INTO files (folder_id, name, oss_key, size, mime_type, ext, uploader, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      folderId,
      trimmed,
      oss_key,
      size,
      mime_type || null,
      ext || null,
      req.user?.username || null,
      so,
      Date.now()
    );
  res.json({ id: info.lastInsertRowid });
});

// Get a bare signed url for the object. The frontend will fetch it as a Blob
// and convert to a Blob URL so the browser ignores OSS's force-download header
// (added automatically on un-filed bucket domains for certain MIME types).
router.get('/:id/url', downloadLimiterShort, downloadLimiterLong, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'invalid file id' });
  const file = db.prepare('SELECT * FROM files WHERE id = ?').get(id);
  if (!file) return res.status(404).json({ error: 'not found' });

  const ext = normalizeExt(file.ext);
  const contentType = mimeOf(ext) || 'application/octet-stream';
  // Defence in depth: any type not on the inline whitelist (and anything risky)
  // is served with Content-Disposition: attachment so it cannot execute in the OSS origin.
  const forceAttach = req.query.download === '1' || shouldForceDownload(ext);
  const disposition = dispositionFor(file.name, forceAttach);

  const url = signedGetUrl(file.oss_key, SHORT_SIGN_TTL, {
    contentType,
    disposition,
  });

  if (req.query.download === '1') {
    const ip = req.ip || req.socket?.remoteAddress || '';
    const ua = String(req.headers['user-agent'] || '').slice(0, 256);
    if (shouldLogDownload(file.id, ip)) {
      try {
        db.prepare(
          'INSERT INTO download_logs (file_id, file_name, downloaded_at, ip, ua) VALUES (?, ?, ?, ?, ?)'
        ).run(file.id, file.name, Date.now(), ip || null, ua || null);
      } catch {
        // Older schema may not have ip/ua columns yet; fall back silently.
        db.prepare(
          'INSERT INTO download_logs (file_id, file_name, downloaded_at) VALUES (?, ?, ?)'
        ).run(file.id, file.name, Date.now());
      }
    }
  }

  res.json({
    url,
    name: file.name,
    ext: file.ext,
    mime_type: contentType,
    size: file.size,
    force_download: forceAttach,
  });
});

// Move a file to another folder (folder_id = null means root)
router.patch('/:id', requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'invalid file id' });
    const file = db.prepare('SELECT * FROM files WHERE id = ?').get(id);
    if (!file) return res.status(404).json({ error: 'not found' });

    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'name')) {
      const newName = String(req.body?.name || '').trim();
      if (!newName) return res.status(400).json({ error: 'name required' });
      if (newName === file.name) return res.json({ ok: true, unchanged: true });
      const newExt = path.extname(newName).toLowerCase();
      if (!isExtAllowed(newExt)) {
        return res.status(415).json({ error: `不允许的文件类型: ${newExt || '(无扩展名)'}` });
      }
      if (findFileByNameInFolder(db, newName, file.folder_id, file.id)) {
        return res.status(409).json({ error: 'same filename already exists in this folder' });
      }

      const newKey = objectKeyForFile(db, file.folder_id, newName);
      const conflict = db.prepare('SELECT id FROM files WHERE oss_key = ? AND id != ?').get(newKey, id);
      if (conflict) return res.status(409).json({ error: 'target OSS path already exists' });

      if (file.oss_key !== newKey) await copyOssObject(file.oss_key, newKey);
      const ext = path.extname(newName).toLowerCase().replace(/^\./, '');
      db.prepare('UPDATE files SET name = ?, ext = ?, oss_key = ? WHERE id = ?').run(
        newName,
        ext || null,
        newKey,
        id
      );
      if (file.oss_key !== newKey) await deleteOssObjectIfExists(file.oss_key);
      return res.json({ ok: true, name: newName, oss_key: newKey });
    }

    const raw = req.body?.folder_id;
    const target = parseOptionalFolderId(raw);
    if (Number.isNaN(target)) return res.status(400).json({ error: 'invalid folder id' });
    if (target !== null) {
      const exists = db.prepare('SELECT id FROM folders WHERE id = ?').get(target);
      if (!exists) return res.status(400).json({ error: 'target folder not found' });
    }
    if (target === file.folder_id) return res.json({ ok: true, unchanged: true });
    if (findFileByNameInFolder(db, file.name, target, file.id)) {
      return res.status(409).json({ error: 'target folder already has a file with this name' });
    }
    const newKey = objectKeyForFile(db, target, file.name);
    await copyOssObject(file.oss_key, newKey);
    const so = nextSortOrder('files', 'folder_id', target);
    db.prepare('UPDATE files SET folder_id = ?, oss_key = ?, sort_order = ? WHERE id = ?').run(
      target,
      newKey,
      so,
      id
    );
    await deleteOssObjectIfExists(file.oss_key);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || 'move failed' });
  }
});

// Delete a file
router.delete('/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'invalid file id' });
  const file = db.prepare('SELECT * FROM files WHERE id = ?').get(id);
  if (!file) return res.status(404).json({ error: 'not found' });
  try {
    await deleteOssObjectIfExists(file.oss_key);
  } catch (e) {
    console.warn('oss delete failed:', e.message);
    return res.status(502).json({ error: 'oss delete failed' });
  }
  db.prepare('DELETE FROM files WHERE id = ?').run(id);
  res.json({ ok: true });
});

// Clean up an orphaned OSS object when metadata registration fails after upload.
// Only keys matching the configured prefix are accepted.
router.post('/cleanup-upload', requireAdmin, (req, res) => {
  const { oss_key } = req.body || {};
  if (!oss_key) return res.status(400).json({ error: 'oss_key required' });
  const prefix = (process.env.OSS_KEY_PREFIX || '').replace(/^\/+|\/+$/g, '');
  if (prefix && !oss_key.startsWith(prefix + '/') && oss_key !== prefix) {
    return res.status(400).json({ error: 'key does not match configured prefix' });
  }
  deleteOssObjectIfExists(oss_key).then(
    () => res.json({ ok: true }),
    (e) => { console.warn('cleanup-upload failed:', e.message); res.json({ ok: true, warn: 'oss delete failed' }); }
  );
});

export default router;
