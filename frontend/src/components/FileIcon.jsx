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
