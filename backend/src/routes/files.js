import { Router } from 'express';
import path from 'node:path';
import { db } from '../db.js';
import { requireAdmin } from '../auth.js';
import { buildPostPolicy, copyOssObject, deleteOssObjectIfExists, signedGetUrl } from '../oss.js';
import { mimeOf } from '../mime.js';
import { nextSortOrder } from './folders.js';
import { findFileByNameInFolder, objectKeyForFile } from '../storagePath.js';


const router = Router();

// Step 1: ask backend for a signed upload policy
router.post('/upload-url', requireAdmin, (req, res) => {
  const { filename, folder_id } = req.body || {};
  if (!filename) return res.status(400).json({ error: 'filename required' });
  const folderId = folder_id ? Number(folder_id) : null;
  if (folderId) {
    const f = db.prepare('SELECT id FROM folders WHERE id = ?').get(folderId);
    if (!f) return res.status(400).json({ error: 'folder not found' });
  }
  const trimmed = filename.trim();
  if (findFileByNameInFolder(db, trimmed, folderId)) {
    return res.status(409).json({ error: 'same filename already exists in this folder' });
  }
  const ext = path.extname(trimmed).toLowerCase();
  const key = objectKeyForFile(db, folderId, trimmed);

  const policy = buildPostPolicy({ key });
  res.json({ ...policy, ext });
});

// Step 2: after the browser uploads to OSS, register metadata
router.post('/', requireAdmin, (req, res) => {
  const { name, oss_key, size, mime_type, folder_id } = req.body || {};
  if (!name || !oss_key || !Number.isFinite(size)) {
    return res.status(400).json({ error: 'name/oss_key/size required' });
  }
  const folderId = folder_id ? Number(folder_id) : null;
  if (folderId) {
    const folder = db.prepare('SELECT id FROM folders WHERE id = ?').get(folderId);
    if (!folder) return res.status(400).json({ error: 'folder not found' });
  }
  const trimmed = name.trim();
  if (findFileByNameInFolder(db, trimmed, folderId)) {
    return res.status(409).json({ error: 'same filename already exists in this folder' });
  }
  const expectedKey = objectKeyForFile(db, folderId, trimmed);
  if (oss_key !== expectedKey) {
    return res.status(400).json({ error: 'oss_key does not match folder path' });
  }
  const ext = path.extname(trimmed).toLowerCase().replace(/^\./, '');
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
router.get('/:id/url', (req, res) => {
  const id = Number(req.params.id);
  const file = db.prepare('SELECT * FROM files WHERE id = ?').get(id);
  if (!file) return res.status(404).json({ error: 'not found' });
  const contentType = mimeOf(file.ext) || file.mime_type || 'application/octet-stream';
  const url = signedGetUrl(file.oss_key, 3600);
  db.prepare('INSERT INTO download_logs (file_id, file_name, downloaded_at) VALUES (?, ?, ?)').run(
    file.id, file.name, Date.now()
  );
  res.json({ url, name: file.name, ext: file.ext, mime_type: contentType, size: file.size });
});

// Move a file to another folder (folder_id = null means root)
router.patch('/:id', requireAdmin, async (req, res) => {
  try {
  const id = Number(req.params.id);
  const file = db.prepare('SELECT * FROM files WHERE id = ?').get(id);
  if (!file) return res.status(404).json({ error: 'not found' });
  const raw = req.body?.folder_id;
  const target = raw === null || raw === undefined || raw === 0 || raw === '0' ? null : Number(raw);
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
  import('../oss.js').then(({ deleteOssObjectIfExists }) =>
    deleteOssObjectIfExists(oss_key).then(
      () => res.json({ ok: true }),
      (e) => { console.warn('cleanup-upload failed:', e.message); res.json({ ok: true, warn: 'oss delete failed' }); }
    )
  );
});

export default router;
