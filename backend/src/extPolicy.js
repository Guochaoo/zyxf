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

export const ALLOWED_EXTS = new Set([
  // documents
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'odt', 'ods', 'odp',
  // plain text & structured
  'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'xml', 'yaml', 'yml', 'log',
  // images
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'tif', 'ico', 'heic', 'svg',
  // archives
  'zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2',
  // audio / video
  'mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac',
  'mp4', 'mov', 'webm', 'mkv', 'avi', 'wmv', 'm4v',
  // misc safe
  'epub', 'rtf',
]);

// Inline-preview is allowed only for these. Everything else is downloaded.
const INLINE_OK = new Set([
  'pdf',
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'ico',
  'mp4', 'mov', 'webm', 'm4v',
  'mp3', 'wav', 'ogg', 'm4a',
  'txt', 'md', 'csv', 'json', 'log',
]);

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
  return !INLINE_OK.has(e);
}
