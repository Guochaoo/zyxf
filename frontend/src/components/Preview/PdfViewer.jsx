import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Loader2 } from 'lucide-react';

/**
 * PdfViewer — 取回 PDF 后转成 blob URL 交给浏览器原生阅读器。
 *
 * 为什么不直接把签名 URL 塞进 iframe：OSS 默认域名会下发
 * `Content-Disposition: attachment` + `x-oss-force-download: true`
 * （桶开了强制下载 / 默认域名的安全策略），签名里的 response-content-disposition
 * 会被覆盖，iframe 不会渲染、只会触发下载。转成 blob URL 后浏览器按本地文档处理，
 * 与 Content-Disposition 无关——downloadFileById 早就用的是同一招。
 *
 * 代价：整份 PDF 先落到内存再渲染，没有按页流式加载；学习资料通常几 MB，可接受。
 */
export default function PdfViewer({ url, name, onDownload }) {
  const { t } = useTranslation();
  const [state, setState] = useState({ status: 'loading', blobUrl: null });

  useEffect(() => {
    let cancelled = false;
    let objectUrl = null;
    setState({ status: 'loading', blobUrl: null });

    fetch(url)
      .then((resp) => {
        if (!resp.ok) throw new Error(String(resp.status));
        return resp.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        // 有些对象的 MIME 会落成 octet-stream，浏览器据此不会启用 PDF 阅读器
        const typed = blob.type === 'application/pdf' ? blob : new Blob([blob], { type: 'application/pdf' });
        objectUrl = URL.createObjectURL(typed);
        setState({ status: 'ready', blobUrl: objectUrl });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error', blobUrl: null });
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  if (state.status === 'error') {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 p-8">
        <div className="text-sm text-ink-2">{t('preview.pdfFailed')}</div>
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

  if (state.status === 'loading') {
    return (
      <div className="h-full flex items-center justify-center gap-2 text-xs text-ink-3">
        <Loader2 className="w-4 h-4 animate-spin" />
        {t('preview.loading')}
      </div>
    );
  }

  return <iframe src={state.blobUrl} title={name} className="h-full w-full border-0 bg-surface" />;
}
