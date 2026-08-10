import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2 } from 'lucide-react';
import { DownloadIcon } from '../icons';
import { getFileUrl, getWebofficeToken } from '../../api.js';
import { downloadFileById, errMsg, getPreviewKind, isLargeFile, LARGE_FILE_HINT } from '../../utils.js';
import PreviewBody from './Body.jsx';

/**
 * Preview — full-screen overlay that fetches a file's OSS signed URL and (for
 * previewable types) WebOffice credentials, then renders the right viewer.
 */
export default function Preview({ file, onClose }) {
  const [signedUrl, setSignedUrl] = useState(null);
  const [wbToken, setWbToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [downloadErr, setDownloadErr] = useState('');
  const [downloading, setDownloading] = useState(false);
  const kind = useMemo(() => getPreviewKind(file.ext), [file.ext]);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 640px)');
    const update = () => setIsMobile(query.matches);
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);

  // Fetch the signed URL (downloads / fallbacks) and WebOffice token
  // (interactive preview) in parallel; shared by the retry button.
  const loadUrl = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const [urlMeta, wb] = await Promise.allSettled([
        getFileUrl(file.id),
        getWebofficeToken(file.id),
      ]);
      if (urlMeta.status === 'fulfilled') setSignedUrl(urlMeta.value.url);
      if (wb.status === 'fulfilled') setWbToken(wb.value);
      // A signed-URL failure is fatal; a WebOffice-token failure just falls
      // back to the native/iframe preview path.
      if (urlMeta.status === 'rejected') setErr(errMsg(urlMeta.reason, '加载失败'));
    } catch (e) {
      if (e.name !== 'AbortError') setErr(errMsg(e, '加载失败'));
    } finally {
      setLoading(false);
    }
  }, [file.id]);

  useEffect(() => {
    loadUrl();
  }, [loadUrl]);

  // Download: fetch a fresh signed URL with ?download=1 so the backend
  // applies rate limiting and logs the event.
  const download = useCallback(async () => {
    if (downloading) return;
    setDownloadErr('');
    setDownloading(true);
    try {
      await downloadFileById(file, getFileUrl);
    } catch (e) {
      setDownloadErr(errMsg(e, '下载失败，请关闭后重新打开'));
    } finally {
      setDownloading(false);
    }
  }, [file, downloading]);

  const largeFileWarn = isMobile && isLargeFile(file.size);

  const overlay = (
    <div
      className="fixed inset-0 bg-black/60 z-[120] flex items-stretch justify-center p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-white w-full h-full min-h-[100dvh] flex flex-col overflow-hidden sm:h-[85vh] sm:min-h-0 sm:max-w-5xl sm:rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top bar */}
        <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-2.5 border-b border-slate-200 sm:px-4 sm:py-3">
          <div className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800 sm:text-base">
            {file.name}
          </div>
          <div className="flex items-center gap-2">
            {downloadErr && (
              <span className="text-xs text-red-500 mr-1">{downloadErr}</span>
            )}
            <button
              onClick={download}
              disabled={loading || downloading || !signedUrl}
              className="flex items-center gap-1 text-sm text-slate-600 hover:text-brand-600 px-2 py-1 rounded disabled:opacity-50 transition-colors"
              title="下载"
            >
              {downloading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <DownloadIcon className="w-4 h-4" />
              )}
              <span className="hidden sm:inline">{downloading ? '下载中…' : '下载'}</span>
            </button>
            <button
              onClick={onClose}
              className="p-1 hover:bg-slate-100 rounded text-slate-500 transition-colors"
              title="关闭"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content area */}
        <div className="min-h-0 flex-1 bg-slate-100 overflow-auto">
          {largeFileWarn && !loading && !err && (
            <div className="mx-3 mt-2 sm:mx-4 sm:mt-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-700">
              {LARGE_FILE_HINT}
            </div>
          )}

          {loading && (
            <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-2">
              <Loader2 className="w-6 h-6 animate-spin" />
              <div className="text-xs">正在获取文件地址…</div>
            </div>
          )}

          {!loading && err && (
            <div className="h-full flex flex-col items-center justify-center gap-3 p-4">
              <div className="text-red-500 text-sm text-center">{err}</div>
              <button
                onClick={loadUrl}
                className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm hover:bg-brand-700 transition-colors"
              >
                重新加载
              </button>
            </div>
          )}

          {!loading && !err && (
            <PreviewBody
              kind={kind}
              signedUrl={signedUrl}
              wbToken={wbToken}
              fileId={file.id}
              name={file.name}
              ext={file.ext}
              onDownload={download}
            />
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
