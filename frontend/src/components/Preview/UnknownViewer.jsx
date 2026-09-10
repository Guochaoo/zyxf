import { useTranslation } from 'react-i18next';

/** Fallback for file types with no preview support (archives, etc.). */
export default function UnknownViewer({ signedUrl }) {
  const { t } = useTranslation();
  return (
    <div className="h-full flex flex-col items-center justify-center text-ink-2 gap-3 p-8">
      <div className="text-lg">📎</div>
      <div className="text-sm text-center">{t('preview.unsupported')}</div>
      {signedUrl && (
        <a
          href={signedUrl}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-brand-600 hover:underline"
        >
          {t('preview.downloadFile')}
        </a>
      )}
    </div>
  );
}
