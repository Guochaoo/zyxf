import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';

/**
 * PreviewUnavailable — "预览服务出错" notice with a download button, shared by
 * PreviewBody (no WebOffice token) and OfficeViewer (SDK load/refresh failed).
 * Without an onDownload handler (viewer already sits inside the preview
 * overlay) only the notice is shown — the overlay's own download button works.
 */
export default function PreviewUnavailable({ onDownload }) {
  const { t } = useTranslation();
  return (
    <div className="h-full flex flex-col items-center justify-center text-ink-2 gap-3 p-8">
      <div className="text-3xl">⚠️</div>
      <div className="text-sm text-center text-ink-2">{t('preview.unavailable')}</div>
      {onDownload ? (
        <>
          <div className="text-xs text-ink-3 text-center">{t('preview.downloadDirect')}</div>
          <button
            onClick={onDownload}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold transition-colors"
          >
            <Download className="w-4 h-4" />
            {t('preview.downloadFile')}
          </button>
        </>
      ) : (
        <div className="text-xs text-ink-3 text-center">{t('preview.downloadTop')}</div>
      )}
    </div>
  );
}
