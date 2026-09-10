import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';

/**
 * Fallback for file types with no preview support (archives, etc.).
 * 走 onDownload（blob 下载）而不是直接 `<a href={signedUrl}>` 导航到 OSS 对象：
 * 后者会把「不可内联」类型交给浏览器自行决定如何渲染，而 OSS 桶绑定站点自有域名，
 * 内联 SVG/HTML 会在站点源上执行脚本。服务端现在也会强制 attachment，这里是第二道。
 */
export default function UnknownViewer({ onDownload }) {
  const { t } = useTranslation();
  return (
    <div className="h-full flex flex-col items-center justify-center text-ink-2 gap-3 p-8">
      <div className="text-lg">📎</div>
      <div className="text-sm text-center">{t('preview.unsupported')}</div>
      {onDownload && (
        <button
          onClick={onDownload}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold transition-colors"
        >
          <Download className="w-4 h-4" />
          {t('preview.downloadFile')}
        </button>
      )}
    </div>
  );
}
