// 文件领域的业务逻辑（IMPROVE-55：从 routes/files.js 抽出，行为不变）。
// 上传输入校验（同名/同 key/扩展名白名单）、改名/移动的 OSS 编排骨架、
// 下载记账去重在这里；路由层只留参数解析、权限与 HTTP 状态映射。
import path from 'node:path';
import { db, prepareOnce } from '../db.js';
import { findSibling, folderExists } from '../dbHelpers.js';
import { copyOssObject, deleteOssObjectIfExists } from '../oss.js';
import { objectKeyForFile, parseOptionalFolderId } from '../storagePath.js';
import { isExtAllowed, normalizeExt } from '../extPolicy.js';

// 415 message shared by upload validation and rename validation.
export const rejectedExtMessage = (ext) => `不允许的文件类型: ${ext ? '.' + ext : '(无扩展名)'}`;

// Strip control chars (esp. NUL): path.extname('a.exe NUL .txt')
// yields '.txt', which would let a crafted name bypass the extension whitelist.
// Used by BOTH upload validation and rename validation — keep them in sync.
export function sanitizeName(name) {
  return String(name || '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
}

// 文件名同样不能含路径分隔符。OSS key 的每一段都要过 cleanObjectSegment（'/'、'\' → '-'），
// 于是 'a/b.pdf' 与 'a-b.pdf' 会落到同一个 key，而查重是按**原始 name** 比较的（findSibling），
// 两者不等价：轻则 INSERT 撞 UNIQUE(oss_key)，重则先覆盖既有对象再失败，把别的文件内容换掉。
// 文件夹名早已有同款校验（services/folders.js containsPathSeparator），文件名这一半此前缺失。
export const containsPathSeparator = (name) => /[\/\\]/.test(name);
export const SEPARATOR_ERROR = '文件名不能包含路径分隔符（/ 或 \\）';

// Shared duplicate-name check: a file with the same (non-NULL) folder_id and
// name, optionally excluding one id (for rename/move self-checks).
export const findFileByName = (name, folderId, excludeId) =>
  findSibling(db, 'files', { name, parentColumn: 'folder_id', parentId: folderId, excludeId });

// 目标 OSS key 是否已被别的文件记录占用。**按 key 查重是必需的**：`cleanObjectSegment`
// 不是单射——NFC/NFD 两种写法的 `café.pdf`、以及 `.`/`_` 这类段名都会映射到同一个 key，
// 而按 name 查重的 SQL 是字节比较（NFD ≠ NFC），于是 upload-url 会放行并把已存在对象的
// key 发回给浏览器，直传时**覆盖掉既有文件的内容**，之后 POST /files 才撞 UNIQUE(oss_key)
// 报 409，前端 cleanup-upload 又因该 key 已被引用而拒绝清理 → 内容被换且不可恢复。
export const findFileByOssKey = (key, excludeId = null) =>
  excludeId == null
    ? prepareOnce('SELECT id FROM files WHERE oss_key = ?').get(key)
    : prepareOnce('SELECT id FROM files WHERE oss_key = ? AND id != ?').get(key, excludeId);

export const KEY_TAKEN_ERROR = '该存储路径已被占用（同名或等价名称的文件已存在）';

// Shared validation for both upload steps: filename, parent folder, duplicate
// name and extension whitelist. Returns { trimmed, pid, ext } or { error, status }.
export function validateUploadInput(name, folderId) {
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

export function getFileById(id) {
  return prepareOnce('SELECT * FROM files WHERE id = ?').get(id);
}

// Shared OSS write skeleton for rename/move: copy object → DB update → delete
// old object. copyOssObject no-ops when keys are equal; `deleteOld` guards the
// delete step so a same-key rename never deletes the live object.
export async function copyUpdateDelete(file, newKey, update, deleteOld = true) {
  await copyOssObject(file.oss_key, newKey);
  update();
  if (deleteOld) await deleteOssObjectIfExists(file.oss_key);
}

// ---- Anti-abuse: download accounting ----
// In-memory dedupe: same file_id + IP within window counts once.
const DOWNLOAD_DEDUP_WINDOW_MS = 5 * 60 * 1000;
const DOWNLOAD_DEDUP_CAP = 10000; // hard cap — beyond this, stats are dropped, not scanned
const recentDownloads = new Map(); // key -> expireAt
export function shouldLogDownload(fileId, ip) {
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

export function logDownload(fileId, fileName, ip, ua) {
  prepareOnce(
    'INSERT INTO download_logs (file_id, file_name, downloaded_at, ip, ua) VALUES (?, ?, ?, ?, ?)'
  ).run(fileId, fileName, Date.now(), ip || null, ua || null);
}
