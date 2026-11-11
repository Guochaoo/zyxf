import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { Download, Loader2, X } from 'lucide-react';
import { getFileUrl } from '../../api.js';
import {
  downloadFileById,
  errMsg,
  formatSize,
  getPreviewMode,
  isLargeFile,
  LARGE_FILE_THRESHOLD,
} from '../../utils.js';
import useMediaQuery from '../../hooks/useMediaQuery.js';
import { useModalDialog } from '../../hooks/useModalDialog.js';
import PdfViewer from './PdfViewer.jsx';
import TextViewer from './TextViewer.jsx';
import PreviewUnavailable from './PreviewUnavailable.jsx';

/**
 * Preview — full-screen overlay for a file.
 *
 * 第一阶段只接「浏览器自己能渲染」的两类：PDF 内嵌签名 URL、TXT 取回按纯文本
 * 渲染；Office 与压缩包仍走「暂不支持预览 + 下载」。Office 若要在线看，得先在
 * 服务端转成 PDF 再回到这里。
 *
 * 签名 URL 每次打开都重新取，不进 data/resource.js 的缓存：缓存会让二次打开先
 * 用旧 URL 渲染、再被静默刷新的新 URL 顶掉，iframe 会整页重载（与 issue #83
 * 「换了凭证就重建 viewer」是同一类问题）。
 */
export default function Preview({ file, onClose }) {
  const { t } = useTranslation();
  const [downloadErr, setDownloadErr] = useState('');
  const [downloading, setDownloading] = useState(false);
  const isMobile = useMediaQuery('(max-width: 640px)');

  const mode = useMemo(() => getPreviewMode(file.ext), [file.ext]);
  const [link, setLink] = useState({ url: null, loading: mode !== 'none', error: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (mode === 'none') {
      setLink({ url: null, loading: false, error: null });
      return undefined;
    }
    const controller = new AbortController();
    let cancelled = false;
    setLink({ url: null, loading: true, error: null });

    getFileUrl(file.id, { signal: controller.signal })
      .then((meta) => {
        if (!cancelled) setLink({ url: meta.url, loading: false, error: null });
      })
      .catch((error) => {
        if (!cancelled) setLink({ url: null, loading: false, error });
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [file.id, mode, attempt]);

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

  // 只有「不能预览、必须整份下载」时才提醒移动端流量；PDF 是流式阅读，不必提示。
  const largeFileWarn = isMobile && mode === 'none' && isLargeFile(file.size);
  // Esc 关闭 + Tab 在预览框内循环 + 关闭后焦点归还给列表行（原先 Esc 无效）
  const panelRef = useModalDialog({ onClose });

  const linkError = link.error ? errMsg(link.error, t('preview.urlFailed')) : '';

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

          {mode === 'none' && <PreviewUnavailable onDownload={download} />}

          {mode !== 'none' && link.loading && (
            <div className="h-full flex flex-col items-center justify-center text-ink-2 gap-2">
              <Loader2 className="w-6 h-6 animate-spin" />
              <div className="text-xs">{t('preview.loading')}</div>
            </div>
          )}

          {mode !== 'none' && !link.loading && linkError && (
            <div className="h-full flex flex-col items-center justify-center gap-3 p-4">
              <div className="text-red text-sm text-center">{linkError}</div>
              <button
                onClick={() => setAttempt((n) => n + 1)}
                className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm hover:bg-brand-700 transition-colors"
              >
                {t('preview.reload')}
              </button>
            </div>
          )}

          {mode !== 'none' && !link.loading && !linkError && link.url && (
            mode === 'pdf' ? (
              <PdfViewer url={link.url} name={file.name} onDownload={download} />
            ) : (
              <TextViewer url={link.url} onDownload={download} />
            )
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
