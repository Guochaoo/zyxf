export function formatSize(bytes) {
  if (bytes == null) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatDate(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function formatMonthDay(ts) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function timeAgo(ts) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} 天前`;
  const mo = Math.floor(d / 30);
  return `${mo} 月前`;
}

// ---- extension classification (mirrors backend extPolicy.js) ----
// Macro-enabled Office formats (docm/dotm/xlsm/xltm/pptm/potm) are rejected
// by the backend upload whitelist, so they are intentionally absent here too.

const OFFICE_EXT = new Set([
  // Word
  'doc', 'dot', 'wps', 'wpt', 'docx', 'dotx', 'rtf',
  // PPT
  'ppt', 'pptx', 'ppsx', 'ppsm', 'pps', 'potx', 'dpt', 'dps',
  // Excel
  'xls', 'xlt', 'et', 'xlsx', 'xltx', 'csv',
  // PDF
  'pdf',
  // 文本
  'txt',
]);

const ARCHIVE_EXT = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2']);

export const LARGE_FILE_THRESHOLD = 20 * 1024 * 1024; // 20 MB
export const LARGE_FILE_HINT = '文件较大（>20MB），建议在 WiFi 下预览或直接下载';

// ---- helpers ----

// Strip the leading dot and lowercase an extension string (mirrors backend extPolicy.js).
export function normalizeExt(ext) {
  return String(ext || '').toLowerCase().replace(/^\./, '');
}

export async function downloadFileById(file, getFileUrl) {
  const meta = await getFileUrl(file.id, { download: true });
  const resp = await fetch(meta.url);
  if (!resp.ok) throw new Error(`下载失败 (${resp.status})`);
  const blob = await resp.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

// Download + alert on failure (shared by BrowsePage / SearchBar).
export async function downloadAndAlert(file, getFileUrl) {
  try {
    await downloadFileById(file, getFileUrl);
  } catch (e) {
    alert(e.message || '下载失败');
  }
}

export function getPreviewKind(ext) {
  ext = normalizeExt(ext);
  if (OFFICE_EXT.has(ext)) return 'office';
  if (ARCHIVE_EXT.has(ext)) return 'archive';
  return 'unknown';
}

export function isLargeFile(size) {
  return size != null && size > LARGE_FILE_THRESHOLD;
}

// Pull the backend error message out of an axios error, with a fallback.
export function errMsg(e, fallback = '操作失败') {
  return e?.response?.data?.error || e?.message || fallback;
}
