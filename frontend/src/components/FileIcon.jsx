import {
  Folder,
  FileText,
  Image as ImageIcon,
  FileSpreadsheet,
  Presentation,
  FileType2,
  File as FileGeneric,
} from 'lucide-react';

const EXT_MAP = {
  pdf: { Icon: FileType2, color: 'text-red-500' },
  doc: { Icon: FileText, color: 'text-blue-500' },
  docx: { Icon: FileText, color: 'text-blue-500' },
  ppt: { Icon: Presentation, color: 'text-orange-500' },
  pptx: { Icon: Presentation, color: 'text-orange-500' },
  xls: { Icon: FileSpreadsheet, color: 'text-green-600' },
  xlsx: { Icon: FileSpreadsheet, color: 'text-green-600' },
  jpg: { Icon: ImageIcon, color: 'text-pink-500' },
  jpeg: { Icon: ImageIcon, color: 'text-pink-500' },
  png: { Icon: ImageIcon, color: 'text-pink-500' },
  gif: { Icon: ImageIcon, color: 'text-pink-500' },
  webp: { Icon: ImageIcon, color: 'text-pink-500' },
  bmp: { Icon: ImageIcon, color: 'text-pink-500' },
  svg: { Icon: ImageIcon, color: 'text-pink-500' },
};

export default function FileIcon({ type, ext, className = 'w-5 h-5' }) {
  if (type === 'folder') {
    return <Folder className={`${className} text-amber-500`} />;
  }
  const key = (ext || '').toLowerCase();
  const item = EXT_MAP[key];
  if (item) {
    const { Icon, color } = item;
    return <Icon className={`${className} ${color}`} />;
  }
  return <FileGeneric className={`${className} text-slate-400`} />;
}
