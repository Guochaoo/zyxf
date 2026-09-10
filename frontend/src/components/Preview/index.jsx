import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { Download, X, Loader2 } from 'lucide-react';
import { getFileUrl, getWebofficeToken } from '../../api.js';
import { downloadFileById, errMsg, getPreviewKind, isLargeFile } from '../../utils.js';
import useMediaQuery from '../../hooks/useMediaQuery.js';
import PreviewBody from './Body.jsx';

/**
 * Preview — full-screen overlay that fetches a file's OSS signed URL and (for
 * previewable types) WebOffice credentials, then renders the right viewer.
 */
export default function Preview({ file, onClose }) {
  const { t } = useTranslation();
  const [signedUrl, setSignedUrl] = useState(null);
  const [wbToken, setWbToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [downloadErr, setDownloadErr] = useState('');
  const [downloading, setDownloading] = useState(false);
  // Guards against a stale in-flight load writing state after a newer load
  // or an unmount (e.g. rapid re-open of a different file).
  const loadTokenRef = useRef(0);
  const kind = useMemo(() => getPreviewKind(file.ext), [file.ext]);
  const isMobile = useMediaQuery('(max-width: 640px)');

  // Fetch the signed URL (downloads / fallbacks) and WebOffice token
  // (interactive preview) in parallel; shared by the retry button.
  const loadUrl = useCallback(async () => {
    const token = ++loadTokenRef.current;
    setLoading(true);
    setErr('');
    try {
      const [urlMeta, wb] = await Promise.allSettled([
        getFileUrl(file.id),
        getWebofficeToken(file.id),
      ]);
      if (token !== loadTokenRef.current) return; // stale load — drop it
      if (urlMeta.status === 'fulfilled') setSignedUrl(urlMeta.value.url);
      if (wb.status === 'fulfilled') setWbToken(wb.value);
      // A signed-URL failure is fatal; a WebOffice-token failure just falls
      // back to the native/iframe preview path.
      if (urlMeta.status === 'rejected') setErr(errMsg(urlMeta.reason, t('common.loadFailed')));
    } catch (e) {
      if (token !== loadTokenRef.current) return;
      if (e.name !== 'AbortError') setErr(errMsg(e, t('common.loadFailed')));
    } finally {
      if (token === loadTokenRef.current) setLoading(false);
    }
  }, [file.id]);

  useEffect(() => {
    // Invalidate any in-flight load when the file (or unmount) changes.
    return () => {
      loadTokenRef.current += 1;
    };
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
      setDownloadErr(errMsg(e, t('preview.downloadFailedHint')));
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
        className="bg-surface w-full h-full min-h-[100dvh] flex flex-col overflow-hidden sm:h-[85vh] sm:min-h-0 sm:max-w-5xl sm:rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top bar */}
        <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-2.5 border-b border-line sm:px-4 sm:py-3">
          <div className="min-w-0 flex-1 truncate text-sm font-medium text-ink sm:text-base">
            {file.name}
          </div>
          <div className="flex items-center gap-2">
            {downloadErr && (
              <span className="text-xs text-red mr-1">{downloadErr}</span>
            )}
            <button
              onClick={download}
              disabled={loading || downloading || !signedUrl}
              className="flex items-center gap-1 text-sm text-ink-2 hover:text-brand-600 px-2 py-1 rounded disabled:opacity-50 transition-colors"
              title={t('preview.download')}
            >
              {downloading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              <span className="hidden sm:inline">{downloading ? t('preview.loading') : t('preview.download')}</span>
            </button>
            <button
              onClick={onClose}
              className="p-1 hover:bg-hover rounded text-ink-3 transition-colors"
              title={t('preview.close')}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content area */}
        <div className="min-h-0 flex-1 bg-inset overflow-auto">
          {largeFileWarn && !loading && !err && (
            <div className="mx-3 mt-2 sm:mx-4 sm:mt-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-700">
              {t('preview.largeFileHint')}
            </div>
          )}

          {loading && (
            <div className="h-full flex flex-col items-center justify-center text-ink-2 gap-2">
              <Loader2 className="w-6 h-6 animate-spin" />
              <div className="text-xs">{t('preview.loading')}</div>
            </div>
          )}

          {!loading && err && (
            <div className="h-full flex flex-col items-center justify-center gap-3 p-4">
              <div className="text-red text-sm text-center">{err}</div>
              <button
                onClick={loadUrl}
                className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm hover:bg-brand-700 transition-colors"
              >
                {t('preview.reload')}
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
              onDownload={download}
            />
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
