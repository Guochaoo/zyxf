import { DownloadIcon } from '../icons';
import OfficeViewer from './OfficeViewer.jsx';
import UnknownViewer from './UnknownViewer.jsx';

/**
 * PreviewBody — routes to the correct viewer. Only two preview layers:
 *   1. WebOffice (IMM GenerateWebofficeToken + JS-SDK) for previewable types;
 *   2. "预览服务出错" hint + download button when the preview service fails.
 * Types that never preview (archives, unknown) keep the plain download prompt.
 */
export default function PreviewBody({ kind, signedUrl, wbToken, fileId, name, ext, onDownload }) {
  // Layer 1 — WebOffice interactive preview.
  if (kind === 'office' && wbToken?.url && wbToken?.token) {
    return <OfficeViewer wbToken={wbToken} fileId={fileId} name={name} onDownload={onDownload} />;
  }

  // Layer 2 — preview service unavailable: tell the user, offer download.
  if (kind === 'office') {
    return (
      <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-3 p-8">
        <div className="text-3xl">⚠️</div>
        <div className="text-sm text-center text-slate-600">预览服务出错，暂时无法在线预览</div>
        <div className="text-xs text-slate-400 text-center">请点击下方按钮直接下载文件查看</div>
        <button
          onClick={onDownload}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold transition-colors"
        >
          <DownloadIcon className="w-4 h-4" />
          下载文件
        </button>
      </div>
    );
  }

  // Never-previewable types (archives etc.) — plain download prompt.
  return <UnknownViewer signedUrl={signedUrl} name={name} />;
}
