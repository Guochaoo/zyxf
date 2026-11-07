import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';

/**
 * PreviewUnavailable — 「预览服务出错」提示 + 下载按钮。
 *
 * 在线预览下线后这是浮层里唯一的正文：所有类型都走这里，由用户自行下载查看。
 * 日后重做预览时，这个组件仍然作为 viewer 失败时的兜底。
 */
export default function PreviewUnavailable({ onDownload }) {
  const { t } = useTranslation();
  return (
    <div className="h-full flex flex-col items-center justify-center text-ink-2 gap-3 p-8">
      <div className="text-3xl">⚠️</div>
      <div className="text-sm text-center text-ink-2">{t('preview.unavailable')}</div>
      <div className="text-xs text-ink-3 text-center">{t('preview.downloadDirect')}</div>
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
