// Centralized file-extension policy.
// ---------------------------------------------------------------
// ALLOWED_EXTS    -> accepted by the upload endpoint
// PREVIEWABLE_EXTS -> inline-previewable documents (allow-list minus archives)
// INLINE_IMAGE_EXTS -> legacy raster images may still be served inline
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

// Archives are download-only (never previewed); unknown types are also forced
// to download at serve time.
const ARCHIVE_EXTS = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2']);

// Only these file types are allowed for upload.
// All previewable files go through Alibaba Cloud WebOffice (IMM doc/preview).
// Archives are download-only.
// Macro-enabled Office formats (docm/dotm/xlsm/xltm/pptm/potm) are rejected:
// they are the standard vector for distributing malware to students.
export const ALLOWED_EXTS = new Set([
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
  // 压缩包（仅下载，不预览）
  ...ARCHIVE_EXTS,
]);

// Everything on the allow-list that isn't an archive is previewable.
export const PREVIEWABLE_EXTS = new Set(
  [...ALLOWED_EXTS].filter((e) => !ARCHIVE_EXTS.has(e))
);

// Raster images are not on the upload allow-list but may exist as legacy
// objects imported by sync; they are inert (no script execution), so they
// may still be served inline.
const INLINE_IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']);

export function normalizeExt(ext) {
  return String(ext || '').toLowerCase().replace(/^\./, '');
}

export function isExtAllowed(ext) {
  const e = normalizeExt(ext);
  if (!e) return false;
  if (BLOCKED_EXTS.has(e)) return false;
  return ALLOWED_EXTS.has(e);
}

// Default-deny inline: only known-previewable document types and inert
// raster images are served inline; everything else (svg, html-ish, unknown
// extensions imported from OSS) is forced to download. The OSS bucket is
// bound to the site's own domain (custom domain), so an inline SVG/HTML
// object would run scripts on the site origin — never allow that.
export function shouldForceDownload(ext) {
  const e = normalizeExt(ext);
  if (!e) return true;
  if (BLOCKED_EXTS.has(e)) return true;
  return !(PREVIEWABLE_EXTS.has(e) || INLINE_IMAGE_EXTS.has(e));
}
