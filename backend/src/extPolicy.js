// Centralized file-extension policy.
// ---------------------------------------------------------------
// ALLOWED_EXTS    -> accepted by the upload endpoint
// FORCE_DOWNLOAD_EXTS -> never previewed inline; always returned with
//                       Content-Disposition: attachment (defence in depth).
// BLOCKED_EXTS    -> never accepted, even if mis-listed above.
// ---------------------------------------------------------------

export const BLOCKED_EXTS = new Set([
  // executable / scripts
  'exe', 'msi', 'bat', 'cmd', 'com', 'scr', 'cpl', 'jar',
  'sh', 'bash', 'zsh', 'ps1', 'psm1', 'vbs', 'vbe', 'wsf', 'wsh',
  'apk', 'ipa', 'app', 'dmg', 'pkg',
  // active web content (would execute in OSS origin if opened directly)
  'html', 'htm', 'mhtml', 'xhtml', 'shtml',
  'js', 'mjs', 'cjs', 'jse',
  // dlls / shared libs
  'dll', 'so', 'dylib',
]);

// Only these file types are allowed for upload.
// All previewable files go through Alibaba Cloud WebOffice (IMM doc/preview).
// Archives are download-only.
export const ALLOWED_EXTS = new Set([
  // Word
  'doc', 'dot', 'wps', 'wpt', 'docx', 'dotx', 'docm', 'dotm', 'rtf',
  // PPT
  'ppt', 'pptx', 'pptm', 'ppsx', 'ppsm', 'pps', 'potx', 'potm', 'dpt', 'dps',
  // Excel
  'xls', 'xlt', 'et', 'xlsx', 'xltx', 'csv', 'xlsm', 'xltm',
  // PDF
  'pdf',
  // 文本
  'txt',
  // 压缩包（仅下载，不预览）
  'zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2',
]);

// Archives and unknown types are forced to download.
const ARCHIVE_EXTS = new Set([
  'zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2',
]);

// Everything on the allow-list that isn't an archive is previewable.
export const PREVIEWABLE_EXTS = new Set(
  [...ALLOWED_EXTS].filter((e) => !ARCHIVE_EXTS.has(e))
);

export function normalizeExt(ext) {
  return String(ext || '').toLowerCase().replace(/^\./, '');
}

export function isExtAllowed(ext) {
  const e = normalizeExt(ext);
  if (!e) return false;
  if (BLOCKED_EXTS.has(e)) return false;
  return ALLOWED_EXTS.has(e);
}

export function shouldForceDownload(ext) {
  const e = normalizeExt(ext);
  if (!e) return true;
  if (BLOCKED_EXTS.has(e)) return true;
  // Archives are download-only; everything else can be previewed
  return ARCHIVE_EXTS.has(e);
}
