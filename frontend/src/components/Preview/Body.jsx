import OfficeViewer from './OfficeViewer.jsx';
import UnknownViewer from './UnknownViewer.jsx';

/**
 * PreviewBody — routes to the correct viewer component based on file kind.
 *
 * Kind routing:
 *   'office'  → WebOffice (IMM doc/preview) — Word / PPT / Excel / PDF / TXT
 *   'archive' → download only
 *   'unknown' → download only
 */
export default function PreviewBody({ kind, signedUrl, immUrl, name, ext, onDownload }) {
  if (kind === 'office' && signedUrl) {
    // PDF without IMM: use browser's native PDF viewer via iframe
    if (!immUrl && ext && ext.toLowerCase() === 'pdf') {
      return (
        <div className="relative h-full min-h-0 bg-white">
          <iframe src={signedUrl} title={name} className="h-full w-full bg-white" />
        </div>
      );
    }
    // TXT without IMM: show download prompt (Microsoft Office Online doesn't support plain text)
    if (!immUrl && ext && ext.toLowerCase() === 'txt') {
      return (
        <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-3 p-8">
          <div className="text-sm text-center">纯文本文件暂不支持在线预览</div>
          <button
            onClick={onDownload}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold transition-colors"
          >
            下载文件
          </button>
        </div>
      );
    }
    return <OfficeViewer signedUrl={signedUrl} immUrl={immUrl} name={name} onDownload={onDownload} />;
  }

  return <UnknownViewer signedUrl={signedUrl} name={name} />;
}
