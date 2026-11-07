import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { Download, X, Loader2 } from 'lucide-react';
import { getFileUrl } from '../../api.js';
import { downloadFileById, errMsg, formatSize, isLargeFile, LARGE_FILE_THRESHOLD } from '../../utils.js';
import useMediaQuery from '../../hooks/useMediaQuery.js';
import { useModalDialog } from '../../hooks/useModalDialog.js';
import PreviewUnavailable from './PreviewUnavailable.jsx';

/**
 * Preview — full-screen overlay for a file.
 *
 * 在线预览能力已下线（原先走阿里云 IMM WebOffice + JS-SDK，按次付费且需绑定
 * IMM 项目）。现在所有类型统一落到「预览服务出错 + 直接下载」：浮层只负责文件名、
 * 下载、移动端大文件提示，不再取签名 URL / 预览凭证。日后重做预览时，在这里接回
 * 一个 viewer 即可（列层面板与关闭/焦点语义都不必动）。
 */
export default function Preview({ file, onClose }) {
  const { t } = useTranslation();
  const [downloadErr, setDownloadErr] = useState('');
  const [downloading, setDownloading] = useState(false);
  const isMobile = useMediaQuery('(max-width: 640px)');

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
  }, [file, downloading, t]);

  const largeFileWarn = isMobile && isLargeFile(file.size);
  // Esc 关闭 + Tab 在预览框内循环 + 关闭后焦点归还给列表行（原先 Esc 无效）
  const panelRef = useModalDialog({ onClose });

  const overlay = (
    <div
      className="fixed inset-0 bg-black/60 z-[120] flex items-stretch justify-center p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('preview.aria')}
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
              disabled={downloading}
              className="flex items-center gap-1 text-sm text-ink-2 hover:text-brand-600 px-2 py-1 rounded-sm disabled:opacity-50 transition-colors"
              title={t('preview.download')}
            >
              {downloading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              <span className="hidden sm:inline">{downloading ? t('preview.downloading') : t('preview.download')}</span>
            </button>
            <button
              onClick={onClose}
              className="p-1 hover:bg-hover rounded-sm text-ink-3 transition-colors"
              title={t('preview.close')}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content area */}
        <div className="min-h-0 flex-1 bg-inset overflow-auto">
          {largeFileWarn && (
            <div className="mx-3 mt-2 sm:mx-4 sm:mt-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-700">
              {t('preview.largeFileHint', { size: formatSize(LARGE_FILE_THRESHOLD) })}
            </div>
          )}

          <PreviewUnavailable onDownload={download} />
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
