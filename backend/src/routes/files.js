import { Router } from 'express';
import path from 'node:path';
import { db } from '../db.js';
import { requireAdmin } from '../auth.js';
import { buildPostPolicy, copyOssObject, deleteOssObjectIfExists, signedGetUrl } from '../oss.js';
import { generateWebofficeToken, refreshWebofficeToken } from '../imm.js';
import { mimeOf } from '../mime.js';
import { findSibling, folderExists, isUniqueError, nextSortOrder } from '../dbHelpers.js';
import { objectKeyForFile, ossPrefix, parseOptionalFolderId } from '../storagePath.js';
import { isExtAllowed, normalizeExt, PREVIEWABLE_EXTS, shouldForceDownload } from '../extPolicy.js';
import { invalidateLibraryCaches } from '../searchService.js';
import { enqueueFile } from '../indexPipeline.js';
import { adminBypassLimiter } from '../limiter.js';
import { wrapAsync, serviceError } from '../http.js';

// ---- Anti-abuse: per-IP signed-URL issue limit ----
// Every call issues a 30-min valid signed URL, so previews and downloads are
// equally throttled (admins bypass the cap).
const downloadLimiterShort = adminBypassLimiter(60 * 1000, 60, '请求过于频繁,请稍后再试');
const downloadLimiterLong = adminBypassLimiter(60 * 60 * 1000, 240, '本小时请求次数已达上限,请稍后再试');

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

// 415 message shared by upload validation and rename validation.
const rejectedExtMessage = (ext) => `不允许的文件类型: ${ext ? '.' + ext : '(无扩展名)'}`;

// Strip control chars (esp. NUL): path.extname('a.exe NUL .txt')
// yields '.txt', which would let a crafted name bypass the extension whitelist.
// Used by BOTH upload validation and rename validation — keep them in sync.
function sanitizeName(name) {
  return String(name || '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
}

// 文件名同样不能含路径分隔符。OSS key 的每一段都要过 cleanObjectSegment（'/'、'\' → '-'），
// 于是 'a/b.pdf' 与 'a-b.pdf' 会落到同一个 key，而查重是按**原始 name** 比较的（findSibling），
// 两者不等价：轻则 INSERT 撞 UNIQUE(oss_key)，重则先覆盖既有对象再失败，把别的文件内容换掉。
// 文件夹名早已有同款校验（folders.js containsPathSeparator），文件名这一半此前缺失。
const containsPathSeparator = (name) => /[\/\\]/.test(name);
const SEPARATOR_ERROR = '文件名不能包含路径分隔符（/ 或 \\）';

// Shared duplicate-name check: a file with the same (non-NULL) folder_id and
// name, optionally excluding one id (for rename/move self-checks).
const findFileByName = (name, folderId, excludeId) =>
  findSibling(db, 'files', { name, parentColumn: 'folder_id', parentId: folderId, excludeId });

// 目标 OSS key 是否已被别的文件记录占用。**按 key 查重是必需的**：`cleanObjectSegment`
// 不是单射——NFC/NFD 两种写法的 `café.pdf`、以及 `.`/`_` 这类段名都会映射到同一个 key，
// 而按 name 查重的 SQL 是字节比较（NFD ≠ NFC），于是 upload-url 会放行并把已存在对象的
// key 发回给浏览器，直传时**覆盖掉既有文件的内容**，之后 POST /files 才撞 UNIQUE(oss_key)
// 报 409，前端 cleanup-upload 又因该 key 已被引用而拒绝清理 → 内容被换且不可恢复。
const findFileByOssKey = (key, excludeId = null) =>
  excludeId == null
    ? db.prepare('SELECT id FROM files WHERE oss_key = ?').get(key)
    : db.prepare('SELECT id FROM files WHERE oss_key = ? AND id != ?').get(key, excludeId);

const KEY_TAKEN_ERROR = '该存储路径已被占用（同名或等价名称的文件已存在）';

// Shared validation for both upload steps: filename, parent folder, duplicate
// name and extension whitelist. Returns { trimmed, pid, ext } or { error, status }.
function validateUploadInput(name, folderId) {
  // 文件名统一按 NFC 落库：OSS key 由 cleanObjectSegment 归一化，库里若保留 NFD 形式，
  // 「按 name 查重」与「按 key 查重」就永远不等价（同一条目两种写法都能建）。
  const trimmed = sanitizeName(name).normalize('NFC');
  if (!trimmed) return { error: '文件名不能为空' };
  if (containsPathSeparator(trimmed)) return { error: SEPARATOR_ERROR };
  const pid = parseOptionalFolderId(folderId);
  if (Number.isNaN(pid)) return { error: '无效的文件夹 ID' };
  if (pid !== null && !folderExists(db, pid)) {
    return { error: '文件夹不存在' };
  }
  if (findFileByName(trimmed, pid)) {
    return { error: '此文件夹中已存在同名文件', status: 409 };
  }
  // 名称不同但 key 相同（归一化/清洗后等价）同样要拦，见 findFileByOssKey 的说明。
  if (findFileByOssKey(objectKeyForFile(db, pid, trimmed))) {
    return { error: KEY_TAKEN_ERROR, status: 409 };
  }
  const ext = normalizeExt(path.extname(trimmed));
  if (!isExtAllowed(ext)) {
    return { error: rejectedExtMessage(ext), status: 415 };
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
router.post('/', requireAdmin, wrapAsync(async (req, res) => {
  const { name, oss_key, size, folder_id } = req.body || {};
  if (!oss_key || !Number.isFinite(size) || size < 0) {
    return res.status(400).json({ error: '缺少必要参数（name/oss_key/size）' });
  }
  const v = validateUploadInput(name, folder_id);
  if (v.error) return res.status(v.status || 400).json({ error: v.error });
  const expectedKey = objectKeyForFile(db, v.pid, v.trimmed);
  if (oss_key !== expectedKey) {
    return res.status(400).json({ error: 'oss_key 与文件夹路径不匹配' });
  }
  const so = nextSortOrder(db, 'files', 'folder_id', v.pid);
  try {
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
        // MIME 以服务端由扩展名派生值为准（BUG-26）：浏览器上报的 file.type 可能
        // 为空或与实际不符，而下载/预览响应一律按扩展名派生，两处必须同源。
        mimeOf(v.ext) || null,
        v.ext || null,
        req.user?.username || null,
        so,
        Date.now()
      );
    res.json({ id: info.lastInsertRowid });
    invalidateLibraryCaches();
    // 内容索引：入队而不是同步抽（下载 + 解析是重活，放请求里会超时），由后台 worker 消化
    enqueueFile(info.lastInsertRowid);
  } catch (e) {
    if (isUniqueError(e)) {
      return res.status(409).json({ error: '此文件夹中已存在同名文件' });
    }
    throw e;
  }
}));

// Get a bare signed url for the object. The frontend will fetch it as a Blob
// and convert to a Blob URL so the browser ignores OSS's force-download header
// (added automatically on un-filed bucket domains for certain MIME types).
router.get('/:id/url', downloadLimiterShort, downloadLimiterLong, (req, res) => {
  const file = getFileOr404(req, res);
  if (!file) return;

  const ext = normalizeExt(file.ext);
  const isDownload = req.query.download === '1';

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
    url: signedGetUrl(file.oss_key, SHORT_SIGN_TTL, {
      // 不可预览类型由 OSS 强制 attachment：桶绑定站点自有域名时，内联 SVG/HTML
      // 会在站点源上执行脚本，而 extPolicy 的 default-deny 只有服务端能真正兜住
      // （前端此前并不消费 force_download 字段）。
      forceDownload: isDownload || shouldForceDownload(ext),
      filename: file.name,
    }),
    name: file.name,
    ext: file.ext,
    mime_type: mimeOf(ext) || 'application/octet-stream',
    size: file.size,
    force_download: isDownload || shouldForceDownload(ext),
  });
});

// WebOffice preview token via IMM GenerateWebofficeToken. Works for
// browser-uploaded ("externally uploaded") objects too — the JS-SDK renders
// the returned WebofficeURL in the browser, mobile WebViews included.
router.get('/:id/weboffice-token', downloadLimiterShort, downloadLimiterLong, wrapAsync(async (req, res) => {
  const file = getFileOr404(req, res);
  if (!file) return;
  const ext = normalizeExt(file.ext);
  if (!PREVIEWABLE_EXTS.has(ext)) {
    return res.status(415).json({ error: '该文件类型不支持在线预览' });
  }
  try {
    res.json(await generateWebofficeToken(file));
  } catch (e) {
    serviceError(res, e, '预览服务暂不可用，请稍后再试');
  }
}));

// Refresh a WebOffice access token (30-min lifetime) with the refresh token
// (1-day lifetime). The frontend JS-SDK calls this via its refreshToken
// callback before the access token expires.
router.post('/:id/weboffice-refresh', downloadLimiterShort, downloadLimiterLong, wrapAsync(async (req, res) => {
  const file = getFileOr404(req, res);
  if (!file) return;
  const { access_token, refresh_token } = req.body || {};
  if (!access_token || !refresh_token) {
    return res.status(400).json({ error: '缺少 access_token 或 refresh_token' });
  }
  try {
    res.json(await refreshWebofficeToken({ accessToken: access_token, refreshToken: refresh_token }));
  } catch (e) {
    // Refresh token may itself be expired (1-day lifetime) — the client can
    // then regenerate a fresh session via weboffice-token.
    serviceError(res, e, '预览凭证刷新失败，请关闭后重新打开');
  }
}));

// Shared OSS write skeleton for rename/move: copy object → DB update → delete
// old object. copyOssObject no-ops when keys are equal; `deleteOld` guards the
// delete step so a same-key rename never deletes the live object.
async function copyUpdateDelete(file, newKey, update, deleteOld = true) {
  await copyOssObject(file.oss_key, newKey);
  update();
  if (deleteOld) await deleteOssObjectIfExists(file.oss_key);
}

// Move or rename a file
router.patch('/:id', requireAdmin, wrapAsync(async (req, res, next) => {
  const file = getFileOr404(req, res);
  if (!file) return;
  const id = file.id;

  const patchBody = req.body || {};
  if (
    !Object.prototype.hasOwnProperty.call(patchBody, 'name') &&
    !Object.prototype.hasOwnProperty.call(patchBody, 'folder_id')
  ) {
    // 空 body / 全是未知字段原先会被当成「folder_id: undefined → 移动到根」，
    // 一个拼错的请求就静默移动文件（并复制一份 OSS 对象）。必须显式 400。
    return res.status(400).json({ error: '请求体必须包含 name 或 folder_id' });
  }

  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'name')) {
    // 与上传路径同款 NFC 归一化：否则同一条目能用 NFD 写法再建一份，而两者的 OSS key 相同。
    const newName = sanitizeName(req.body?.name).normalize('NFC');
    if (!newName) return res.status(400).json({ error: '名称不能为空' });
    if (containsPathSeparator(newName)) return res.status(400).json({ error: SEPARATOR_ERROR });
    if (newName === file.name) return res.json({ ok: true, unchanged: true });
    const ext = normalizeExt(path.extname(newName));
    if (!isExtAllowed(ext)) {
      return res.status(415).json({ error: rejectedExtMessage(ext) });
    }
    if (findFileByName(newName, file.folder_id, id)) {
      return res.status(409).json({ error: '此文件夹中已存在同名文件' });
    }

    const newKey = objectKeyForFile(db, file.folder_id, newName);
    if (db.prepare('SELECT id FROM files WHERE oss_key = ? AND id != ?').get(newKey, id)) {
      return res.status(409).json({ error: '目标存储路径已存在同名文件' });
    }

    try {
      await copyUpdateDelete(
        file,
        newKey,
        () =>
          db.prepare('UPDATE files SET name = ?, ext = ?, oss_key = ? WHERE id = ?').run(
            newName,
            ext || null,
            newKey,
            id
          ),
        file.oss_key !== newKey
      );
      invalidateLibraryCaches();
      return res.json({ ok: true, name: newName, oss_key: newKey });
    } catch (e) {
      return next(e);
    }
  }
  const target = parseOptionalFolderId(req.body?.folder_id);
  if (Number.isNaN(target)) return res.status(400).json({ error: '无效的文件夹 ID' });
  if (target !== null && !folderExists(db, target)) {
    return res.status(400).json({ error: '目标文件夹不存在' });
  }
  if (target === file.folder_id) return res.json({ ok: true, unchanged: true });
  if (findFileByName(file.name, target, id)) {
    return res.status(409).json({ error: '目标文件夹中已存在同名文件' });
  }
  const newKey = objectKeyForFile(db, target, file.name);
  // 与改名分支同款的 key 冲突检查。文件名查重是按**原始 name** 比较的（findSibling），
  // 而 OSS key 是 cleanObjectSegment 归一化后比较，两者不等价（历史脏数据、Unicode
  // 归一化差异都能制造同名不同 name 的情况）。缺这步会先 copyOssObject 覆盖目标对象、
  // 再因 UNIQUE(oss_key) 抛 500——目标文件的内容被换掉而 DB 行还指向旧 key。
  if (db.prepare('SELECT id FROM files WHERE oss_key = ? AND id != ?').get(newKey, id)) {
    return res.status(409).json({ error: '目标存储路径已存在同名文件' });
  }
  try {
    await copyUpdateDelete(file, newKey, () => {
      const so = nextSortOrder(db, 'files', 'folder_id', target);
      db.prepare('UPDATE files SET folder_id = ?, oss_key = ?, sort_order = ? WHERE id = ?').run(
        target,
        newKey,
        so,
        id
      );
    });
    invalidateLibraryCaches();
    res.json({ ok: true });
  } catch (e) {
    return next(e);
  }
}));

// Delete a file
router.delete('/:id', requireAdmin, wrapAsync(async (req, res) => {
  const file = getFileOr404(req, res);
  if (!file) return;
  try {
    await deleteOssObjectIfExists(file.oss_key);
  } catch (e) {
    return serviceError(res, e, 'OSS 删除失败');
  }
  db.prepare('DELETE FROM files WHERE id = ?').run(file.id);
  invalidateLibraryCaches();
  res.json({ ok: true });
}));

// Clean up an orphaned OSS object when metadata registration fails after upload.
// Only keys matching the configured prefix are accepted.
router.post('/cleanup-upload', requireAdmin, wrapAsync(async (req, res) => {
  const { oss_key } = req.body || {};
  if (!oss_key) return res.status(400).json({ error: 'oss_key 不能为空' });
  const prefix = ossPrefix();
  // 没有前缀就无法界定「本应用的对象」范围：原实现在这种配置下会照删任意 key，
  // 等于提供了一个可销毁桶内任意对象（含别的应用对象）的接口。宁可放弃这次
  // best-effort 清理（最坏只留一个孤儿对象），也不做无边界删除。
  if (!prefix) {
    return res.status(400).json({ error: '未配置 OSS_KEY_PREFIX，拒绝清理（无法确定对象归属）' });
  }
  if (!oss_key.startsWith(prefix + '/')) {
    return res.status(400).json({ error: 'OSS key 与配置的前缀不匹配' });
  }
  // `zyxf/../other/x` 也能通过 startsWith（字符串层面确实以 `zyxf/` 开头），
  // 但 OSS 端若按路径语义归一化就会删到前缀之外的对象。对象键里不存在合法的
  // `.` / `..` 段（生成侧 cleanObjectSegment 已把它们换成 `_`），一律拒绝。
  if (oss_key.split('/').some((seg) => seg === '.' || seg === '..')) {
    return res.status(400).json({ error: 'OSS key 含非法路径段' });
  }
  // 已被 files 行引用的对象不能删：注册失败后的清理不该动到已入库文件的对象
  // （并发或同名上传会让两者的 key 相同），否则等于把线上文件的存储对象删掉。
  if (db.prepare('SELECT id FROM files WHERE oss_key = ?').get(oss_key)) {
    return res.status(409).json({ error: '该对象已被文件记录引用，拒绝清理' });
  }
  try {
    await deleteOssObjectIfExists(oss_key);
  } catch (e) {
    // Best-effort cleanup: report success with a warning rather than failing.
    console.warn('cleanup-upload failed:', e.message);
    return res.json({ ok: true, warn: 'OSS 删除失败' });
  }
  res.json({ ok: true });
}));

export default router;
