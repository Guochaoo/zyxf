import { Download } from 'lucide-react';

/**
 * PreviewUnavailable — "预览服务出错" notice with a download button, shared by
 * PreviewBody (no WebOffice token) and OfficeViewer (SDK load/refresh failed).
 * Without an onDownload handler (viewer already sits inside the preview
 * overlay) only the notice is shown — the overlay's own download button works.
 */
export default function PreviewUnavailable({ onDownload }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-3 p-8">
      <div className="text-3xl">⚠️</div>
      <div className="text-sm text-center text-slate-600">预览服务出错，暂时无法在线预览</div>
      {onDownload ? (
        <>
          <div className="text-xs text-slate-400 text-center">请点击下方按钮直接下载文件查看</div>
          <button
            onClick={onDownload}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold transition-colors"
          >
            <Download className="w-4 h-4" />
            下载文件
          </button>
        </>
      ) : (
        <div className="text-xs text-slate-400 text-center">请点击右上角下载按钮保存文件</div>
      )}
    </div>
  );
}
