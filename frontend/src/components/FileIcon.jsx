import {
  BsFileEarmark,
  BsFiletypeCsv,
  BsFiletypeDoc,
  BsFiletypeDocx,
  BsFiletypeGif,
  BsFiletypeJpg,
  BsFiletypeJson,
  BsFiletypeMd,
  BsFiletypeMp3,
  BsFiletypeMp4,
  BsFiletypePdf,
  BsFiletypePng,
  BsFiletypePpt,
  BsFiletypePptx,
  BsFiletypeSvg,
  BsFiletypeTxt,
  BsFiletypeXls,
  BsFiletypeXlsx,
  BsFolder,
} from 'react-icons/bs';

import { normalizeExt } from '../utils.js';
// 与后端白名单同源（IMPROVE-19）：这里只覆盖有专用图标的类型，其余回落到通用文档图标。
import { ALLOWED_EXTS, ARCHIVE_EXTS } from '@backend/extPolicy.js';

const EXT_MAP = {
  pdf: BsFiletypePdf,
  doc: BsFiletypeDoc,
  docx: BsFiletypeDocx,
  ppt: BsFiletypePpt,
  pptx: BsFiletypePptx,
  xls: BsFiletypeXls,
  xlsx: BsFiletypeXlsx,
  jpg: BsFiletypeJpg,
  jpeg: BsFiletypeJpg,
  png: BsFiletypePng,
  gif: BsFiletypeGif,
  svg: BsFiletypeSvg,
  csv: BsFiletypeCsv,
  txt: BsFiletypeTxt,
  md: BsFiletypeMd,
  json: BsFiletypeJson,
  mp3: BsFiletypeMp3,
  mp4: BsFiletypeMp4,
};

// 白名单里的同族类型复用同族图标（如 wps/wpt → Word 图标、dps/dpt → PPT 图标）：
// 逐一列举容易漏，后端一加类型图标就退成通用文档（IMPROVE-19 的同类漂移）。
const WORD_EXTS = ['wps', 'wpt'];
const SLIDE_EXTS = ['pps', 'ppsx', 'potx', 'dps', 'dpt'];
const SHEET_EXTS = ['xlt', 'xltx', 'et'];
for (const e of WORD_EXTS) if (ALLOWED_EXTS.has(e)) EXT_MAP[e] = BsFiletypeDoc;
for (const e of SLIDE_EXTS) if (ALLOWED_EXTS.has(e)) EXT_MAP[e] = BsFiletypePpt;
for (const e of SHEET_EXTS) if (ALLOWED_EXTS.has(e)) EXT_MAP[e] = BsFiletypeXls;
// 压缩包统一用通用文档图标（不预览，只下载）
for (const e of ARCHIVE_EXTS) EXT_MAP[e] = BsFileEarmark;

const ICON_COLOR = 'text-slate-600';

export default function FileIcon({ type, ext, className = 'w-5 h-5' }) {
  const key = normalizeExt(ext);
  if (type === 'folder') {
    return (
      <span className={`${className} inline-flex shrink-0 items-center justify-center`}>
        <BsFolder className={`h-full w-full ${ICON_COLOR}`} />
      </span>
    );
  }

  const Icon = EXT_MAP[key] || BsFileEarmark;

  return (
    <span className={`${className} inline-flex shrink-0 items-center justify-center`}>
      <Icon className={`h-full w-full ${ICON_COLOR}`} />
    </span>
  );
}
