import i18n from './i18n/index.js';
// ---- extension classification ----
// 表来自后端 extPolicy.js（IMPROVE-19）：白名单是后端上传校验的唯一权威，
// 前端只做展示分类，两处合表后「后端加了类型、前端仍判 unknown → 预览退化成只能下载」
// 这类漂移不会再有。extPolicy.js 是纯数据模块（不 import node 内建），可安全共享。
// 路径别名见 vite.config.js（@backend → backend/src/）。
import { ALLOWED_EXTS, ARCHIVE_EXTS } from '@backend/extPolicy.js';

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
  if (m < 1) return i18n.t('common.justNow');
  if (m < 60) return i18n.t('common.minutesAgo', { count: m });
  const h = Math.floor(m / 60);
  if (h < 24) return i18n.t('common.hoursAgo', { count: h });
  const d = Math.floor(h / 24);
  if (d < 30) return i18n.t('common.daysAgo', { count: d });
  const mo = Math.floor(d / 30);
  return i18n.t('common.monthsAgo', { count: mo });
}

// ---- extension classification ----
// 可预览 = 白名单里去掉压缩包（与后端 PREVIEWABLE_EXTS 的算式一致）。
const OFFICE_EXT = new Set([...ALLOWED_EXTS].filter((e) => !ARCHIVE_EXTS.has(e)));
const ARCHIVE_EXT = ARCHIVE_EXTS;

// 大文件提示阈值。文案里的数值由这个常量注入（见 Preview/index.jsx），
// 两边不再各写一份——原先 i18n 字典里硬写着「>20MB」，改阈值就会说不一致。
export const LARGE_FILE_THRESHOLD = 20 * 1024 * 1024; // 20 MB

// Strip the leading dot and lowercase an extension string (mirrors backend extPolicy.js).
export function normalizeExt(ext) {
  return String(ext || '').toLowerCase().replace(/^\./, '');
}

export async function downloadFileById(file, getFileUrl) {
  const meta = await getFileUrl(file.id, { download: true });
  const resp = await fetch(meta.url);
  if (!resp.ok) throw new Error(i18n.t('common.downloadFailedStatus', { status: resp.status }));
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
    alert(e.message || i18n.t('common.downloadFailed'));
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
export function errMsg(e, fallback = i18n.t('common.actionFailed')) {
  return e?.response?.data?.error || e?.message || fallback;
}

// ---- 目录结构变更广播 ----
// 管理操作（新建/重命名/移动/删除/重排/同步）后广播，让侧边栏 FolderTree 与知识图谱
// 重新拉取目录树；监听方见 hooks/useFolderTree.js 与 components/FolderTree.jsx。
export function notifyFoldersChanged() {
  window.dispatchEvent(new Event('folders-changed'));
}
