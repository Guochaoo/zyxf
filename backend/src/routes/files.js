import { Router } from 'express';
import path from 'node:path';
import rateLimit from 'express-rate-limit';
import { db } from '../db.js';
import { requireAdmin } from '../auth.js';
import { buildPostPolicy, copyOssObject, deleteOssObjectIfExists, signedGetUrl } from '../oss.js';
import { generateWebofficeToken, refreshWebofficeToken } from '../imm.js';
import { mimeOf } from '../mime.js';
import { findFileByNameInFolder, findOssKeyConflict, nextSortOrder } from '../dbHelpers.js';
import { objectKeyForFile, ossPrefix, parseOptionalFolderId } from '../storagePath.js';
import { isExtAllowed, normalizeExt, PREVIEWABLE_EXTS, shouldForceDownload } from '../extPolicy.js';

// ---- Anti-abuse: per-IP signed-URL issue limit ----
// Every call issues a 30-min valid signed URL, so previews and downloads are
// equally throttled (admins bypass the cap).
const downloadLimiter = (windowMs, max, message) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.user?.role === 'admin',
    message: { error: message },
  });
const downloadLimiterShort = downloadLimiter(60 * 1000, 60, '请求过于频繁,请稍后再试');
const downloadLimiterLong = downloadLimiter(60 * 60 * 1000, 240, '本小时请求次数已达上限,请稍后再试');

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

const SHORT_SIGN_TTL = 1800; // 30 min — enough for long preview sessions, short enough to limit link-sharing risk

// In-memory dedupe: same file_id + IP within window counts once.
const DOWNLOAD_DEDUP_WINDOW_MS = 5 * 60 * 1000;
const DOWNLOAD_DEDUP_CAP = 10000; // hard cap — beyond this, stats are dropped, not scanned
const recentDownloads = new Map(); // key -> expireAt
function shouldLogDownload(fileId, ip) {
  const key = `${fileId}|${ip}`;
  const now = Date.now();
  const exp = recentDownloads.get(key);
  if (exp && exp > now) return false;
  if (recentDownloads.size >= DOWNLOAD_DEDUP_CAP) return false;
  recentDownloads.set(key, now + DOWNLOAD_DEDUP_WINDOW_MS);
  return true;
}
// Periodic sweep instead of per-insert O(n) scan.
setInterval(() => {
  const now = Date.now();
  for (const [k, e] of recentDownloads) if (e <= now) recentDownloads.delete(k);
}, DOWNLOAD_DEDUP_WINDOW_MS).unref?.();

const router = Router();

// Shared validation for both upload steps: filename, parent folder, duplicate
// name and extension whitelist. Returns { trimmed, pid, ext } or { error, status }.
function validateUploadInput(name, folderId) {
  // Strip control chars (esp. NUL) up front: path.extname('a.exe NUL .txt')
  // yields '.txt', which would let a crafted name bypass the extension whitelist.
  const sanitized = String(name || '').replace(/[\u0000-\u001f\u007f]/g, '');
  const trimmed = sanitized.trim();
  if (!trimmed) return { error: '文件名不能为空' };
  const pid = parseOptionalFolderId(folderId);
  if (Number.isNaN(pid)) return { error: '无效的文件夹 ID' };
  if (pid !== null) {
    const f = db.prepare('SELECT id FROM folders WHERE id = ?').get(pid);
    if (!f) return { error: '文件夹不存在' };
  }
  if (findFileByNameInFolder(db, trimmed, pid)) {
    return { error: '此文件夹中已存在同名文件', status: 409 };
  }
  const ext = normalizeExt(path.extname(trimmed));
  if (!isExtAllowed(ext)) {
    return { error: `不允许的文件类型: ${ext ? '.' + ext : '(无扩展名)'}`, status: 415 };
  }
  return { trimmed, pid, ext };
}

function getFileOr404(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: '无效的文件 ID' });
    return null;
  }
  const file = db.prepare('SELECT * FROM files WHERE id = ?').get(id);
  if (!file) {
    res.status(404).json({ error: '资源不存在' });
    return null;
  }
  return file;
}

// Step 1: ask backend for a signed upload policy
router.post('/upload-url', requireAdmin, (req, res) => {
  const { filename, folder_id } = req.body || {};
  const v = validateUploadInput(filename, folder_id);
  if (v.error) return res.status(v.status || 400).json({ error: v.error });
  const key = objectKeyForFile(db, v.pid, v.trimmed);
  res.json({ ...buildPostPolicy({ key }), ext: `.${v.ext}` });
});

// Step 2: after the browser uploads to OSS, register metadata
router.post('/', requireAdmin, (req, res) => {
  const { name, oss_key, size, mime_type, folder_id } = req.body || {};
  if (!oss_key || !Number.isFinite(size)) {
    return res.status(400).json({ error: '缺少必要参数（name/oss_key/size）' });
  }
  const v = validateUploadInput(name, folder_id);
  if (v.error) return res.status(v.status || 400).json({ error: v.error });
  const expectedKey = objectKeyForFile(db, v.pid, v.trimmed);
  if (oss_key !== expectedKey) {
    return res.status(400).json({ error: 'oss_key 与文件夹路径不匹配' });
  }
  const so = nextSortOrder(db, 'files', 'folder_id', v.pid);
  const info = db
    .prepare(
      `INSERT INTO files (folder_id, name, oss_key, size, mime_type, ext, uploader, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      v.pid,
      v.trimmed,
      oss_key,
      size,
      mime_type || null,
      v.ext || null,
      req.user?.username || null,
      so,
      Date.now()
    );
  res.json({ id: info.lastInsertRowid });
});

// Get a bare signed url for the object. The frontend will fetch it as a Blob
// and convert to a Blob URL so the browser ignores OSS's force-download header
// (added automatically on un-filed bucket domains for certain MIME types).
router.get('/:id/url', downloadLimiterShort, downloadLimiterLong, async (req, res) => {
  const file = getFileOr404(req, res);
  if (!file) return;

  const ext = normalizeExt(file.ext);
  const contentType = mimeOf(ext) || 'application/octet-stream';
  // Defence in depth: any type not on the inline whitelist (and anything risky)
  // is served with Content-Disposition: attachment so it cannot execute in the OSS origin.
  const isDownload = req.query.download === '1';
  const forceAttach = isDownload || shouldForceDownload(ext);
  const urlOptions = {};
  // NOTE: we never override response-content-type — this OSS bucket rejects
  // that parameter with InvalidRequest (EC 0017-00000902, "Can not override
  // response header on content-type") for every object. Browser uploads store
  // a correct Content-Type already, so the raw object header is served as-is.
  // Only Content-Disposition is overridden (allowed).
  if (!isDownload) {
    urlOptions.disposition = dispositionFor(file.name, forceAttach);
  }

  const url = signedGetUrl(file.oss_key, SHORT_SIGN_TTL, urlOptions);

  if (isDownload) {
    const ip = req.ip || req.socket?.remoteAddress || '';
    const ua = String(req.headers['user-agent'] || '').slice(0, 256);
    if (shouldLogDownload(file.id, ip)) {
      db.prepare(
        'INSERT INTO download_logs (file_id, file_name, downloaded_at, ip, ua) VALUES (?, ?, ?, ?, ?)'
      ).run(file.id, file.name, Date.now(), ip || null, ua || null);
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

// WebOffice preview token via IMM GenerateWebofficeToken. Works for
// browser-uploaded ("externally uploaded") objects too — the JS-SDK renders
// the returned WebofficeURL in the browser, mobile WebViews included.
router.get('/:id/weboffice-token', downloadLimiterShort, downloadLimiterLong, async (req, res, next) => {
  const file = getFileOr404(req, res);
  if (!file) return;
  const ext = normalizeExt(file.ext);
  if (!PREVIEWABLE_EXTS.has(ext)) {
    return res.status(415).json({ error: '该文件类型不支持在线预览' });
  }
  try {
    const info = await generateWebofficeToken(file);
    res.json(info);
  } catch (e) {
    console.warn('[files] weboffice token failed:', e.message);
    res.status(502).json({ error: '预览服务暂不可用，请稍后再试' });
  }
});

// Refresh a WebOffice access token (30-min lifetime) with the refresh token
// (1-day lifetime). The frontend JS-SDK calls this via its refreshToken
// callback before the access token expires.
router.post('/:id/weboffice-refresh', downloadLimiterShort, downloadLimiterLong, async (req, res) => {
  const file = getFileOr404(req, res);
  if (!file) return;
  const { access_token, refresh_token } = req.body || {};
  if (!access_token || !refresh_token) {
    return res.status(400).json({ error: '缺少 access_token 或 refresh_token' });
  }
  try {
    const info = await refreshWebofficeToken({ accessToken: access_token, refreshToken: refresh_token });
    console.log(`[files] weboffice token refreshed for file ${file.id}`);
    res.json(info);
  } catch (e) {
    console.warn('[files] weboffice refresh failed:', e.message);
    // Refresh token may itself be expired (1-day lifetime) — the client can
    // then regenerate a fresh session via weboffice-token.
    res.status(502).json({ error: '预览凭证刷新失败，请关闭后重新打开' });
  }
});

// Move a file to another folder (folder_id = null means root)
router.patch('/:id', requireAdmin, async (req, res) => {
  const file = getFileOr404(req, res);
  if (!file) return;
  const id = file.id;

  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'name')) {
    const newName = String(req.body?.name || '').trim();
    if (!newName) return res.status(400).json({ error: '名称不能为空' });
    if (newName === file.name) return res.json({ ok: true, unchanged: true });
    const ext = normalizeExt(path.extname(newName));
    if (!isExtAllowed(ext)) {
      return res.status(415).json({ error: `不允许的文件类型: ${ext ? '.' + ext : '(无扩展名)'}` });
    }
    if (findFileByNameInFolder(db, newName, file.folder_id, file.id)) {
      return res.status(409).json({ error: '此文件夹中已存在同名文件' });
    }

    const newKey = objectKeyForFile(db, file.folder_id, newName);
    if (findOssKeyConflict(db, newKey, id)) {
      return res.status(409).json({ error: '目标存储路径已存在同名文件' });
    }

    if (file.oss_key !== newKey) await copyOssObject(file.oss_key, newKey);
    db.prepare('UPDATE files SET name = ?, ext = ?, oss_key = ? WHERE id = ?').run(
      newName,
      ext || null,
      newKey,
      id
    );
    if (file.oss_key !== newKey) {
      await deleteOssObjectIfExists(file.oss_key);
    }
    return res.json({ ok: true, name: newName, oss_key: newKey });
  }

  const target = parseOptionalFolderId(req.body?.folder_id);
  if (Number.isNaN(target)) return res.status(400).json({ error: '无效的文件夹 ID' });
  if (target !== null) {
    const exists = db.prepare('SELECT id FROM folders WHERE id = ?').get(target);
    if (!exists) return res.status(400).json({ error: '目标文件夹不存在' });
  }
  if (target === file.folder_id) return res.json({ ok: true, unchanged: true });
  if (findFileByNameInFolder(db, file.name, target, file.id)) {
    return res.status(409).json({ error: '目标文件夹中已存在同名文件' });
  }
  const newKey = objectKeyForFile(db, target, file.name);
  await copyOssObject(file.oss_key, newKey);
  const so = nextSortOrder(db, 'files', 'folder_id', target);
  db.prepare('UPDATE files SET folder_id = ?, oss_key = ?, sort_order = ? WHERE id = ?').run(
    target,
    newKey,
    so,
    id
  );
  await deleteOssObjectIfExists(file.oss_key);
  res.json({ ok: true });
});

// Delete a file
router.delete('/:id', requireAdmin, async (req, res) => {
  const file = getFileOr404(req, res);
  if (!file) return;
  try {
    await deleteOssObjectIfExists(file.oss_key);
  } catch (e) {
    console.warn('oss delete failed:', e.message);
    return res.status(502).json({ error: 'OSS 删除失败' });
  }
  db.prepare('DELETE FROM files WHERE id = ?').run(file.id);
  res.json({ ok: true });
});

// Clean up an orphaned OSS object when metadata registration fails after upload.
// Only keys matching the configured prefix are accepted.
router.post('/cleanup-upload', requireAdmin, (req, res) => {
  const { oss_key } = req.body || {};
  if (!oss_key) return res.status(400).json({ error: 'oss_key 不能为空' });
  const prefix = ossPrefix();
  if (prefix && !oss_key.startsWith(prefix + '/') && oss_key !== prefix) {
    return res.status(400).json({ error: 'OSS key 与配置的前缀不匹配' });
  }
  deleteOssObjectIfExists(oss_key).then(
    () => res.json({ ok: true }),
    (e) => { console.warn('cleanup-upload failed:', e.message); res.json({ ok: true, warn: 'OSS 删除失败' }); }
  );
});

export default router;
