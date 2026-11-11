import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';

/**
 * PreviewUnavailable — 「暂不支持预览此类型」提示 + 下载按钮。
 *
 * 覆盖的是浏览器渲染不了的类型（Word / PPT / Excel / 压缩包等）；PDF 与 TXT
 * 有自己的 viewer，取数或渲染失败时也各自给下载入口，不经过这里。
 */
export default function PreviewUnavailable({ onDownload }) {
  const { t } = useTranslation();
  return (
    <div className="h-full flex flex-col items-center justify-center text-ink-2 gap-3 p-8">
      <div className="text-3xl">⚠️</div>
      <div className="text-sm text-center text-ink-2">{t('preview.unavailable')}</div>
      <button
        onClick={onDownload}
        className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold transition-colors"
      >
        <Download className="w-4 h-4" />
        {t('preview.downloadFile')}
      </button>
    </div>
  );
}
