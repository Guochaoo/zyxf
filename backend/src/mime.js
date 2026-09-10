import { normalizeExt } from './extPolicy.js';

// MIME 表必须覆盖 extPolicy.ALLOWED_EXTS 的每一项：BUG-26 之后「扩展名派生」是 mime_type
// 的唯一权威来源，缺项会让正式资料在库里存成 NULL、对外返回 application/octet-stream。
// backend/test/mime.test.js 有一条不变量断言锁住这一点——加白名单类型时同步补这里。
const MIME = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  txt: 'text/plain; charset=utf-8',
  md: 'text/plain; charset=utf-8',
  log: 'text/plain; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  json: 'application/json',
  // ---- Word ----
  doc: 'application/msword',
  dot: 'application/msword',
  wps: 'application/vnd.ms-works',
  wpt: 'application/vnd.ms-works',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  dotx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
  rtf: 'application/rtf',
  // ---- PowerPoint ----
  ppt: 'application/vnd.ms-powerpoint',
  pps: 'application/vnd.ms-powerpoint',
  dpt: 'application/vnd.ms-powerpoint',
  dps: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ppsx: 'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
  potx: 'application/vnd.openxmlformats-officedocument.presentationml.template',
  // ---- Excel ----
  xls: 'application/vnd.ms-excel',
  xlt: 'application/vnd.ms-excel',
  et: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xltx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.template',
  // ---- 压缩包（仅下载）----
  zip: 'application/zip',
  rar: 'application/vnd.rar',
  '7z': 'application/x-7z-compressed',
  tar: 'application/x-tar',
  gz: 'application/gzip',
  tgz: 'application/gzip',
  bz2: 'application/x-bzip2',
  // ---- 其他（sync 导入的历史对象类型）----
  mp4: 'video/mp4',
  mp3: 'audio/mpeg',
};

export function mimeOf(ext) {
  const k = normalizeExt(ext);
  if (!k) return null;
  return MIME[k] || null;
}
