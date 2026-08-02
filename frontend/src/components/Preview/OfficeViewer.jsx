import { useState, useEffect, useMemo, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import { DownloadIcon } from '../icons';

/**
 * OfficeViewer — previews Office documents & PDF via Alibaba Cloud IMM doc/preview.
 *
 * Falls back to Microsoft Office Online Viewer if IMM URL is unavailable.
 * IMM preview requires a custom domain bound to the OSS bucket.
 */
const TIMEOUT_MS = 60_000; // 60 s — WebOffice cold start can take 15-30s on first request

export default function OfficeViewer({ signedUrl, immUrl, name, onDownload }) {
  const [timedOut, setTimedOut] = useState(false);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const minSpinnerRef = useRef(0);

  const viewerUrl = useMemo(() => immUrl || (
    signedUrl
      ? `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(signedUrl)}`
      : null
  ), [immUrl, signedUrl]);

  const usingIMM = !!immUrl;

  useEffect(() => {
    if (!viewerUrl) return;
    setTimedOut(false);
    setIframeLoaded(false);
    minSpinnerRef.current = Date.now() + 2000; // keep spinner at least 2s after onLoad
    const timer = setTimeout(() => setTimedOut(true), TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [viewerUrl]);

  if (!viewerUrl) {
    return (
      <div className="h-full flex items-center justify-center text-slate-500 text-sm p-4">
        文件地址尚未就绪
      </div>
    );
  }

  if (timedOut) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-3 p-8">
        <div className="text-3xl">⏱️</div>
        <div className="text-sm text-center max-w-xs">
          {usingIMM
            ? '阿里云 WebOffice 预览响应超时（60秒），请确认：\n① 已为 Bucket 绑定自定义域名\n② 已绑定 IMM Project\n③ 自定义域名已正确解析到 OSS'
            : '文档预览服务响应超时，当前网络环境可能无法访问该服务'}
        </div>
        <div className="text-xs text-slate-400 text-center">
          建议直接下载文件后在本地查看
        </div>
        <button
          onClick={onDownload}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold transition-colors mt-2"
        >
          <DownloadIcon className="w-4 h-4" />
          下载文件
        </button>
        <button
          onClick={() => setTimedOut(false)}
          className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
        >
          继续等待预览
        </button>
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-0 bg-white">
      {/* Loading spinner overlay — hidden once iframe loads */}
      {!iframeLoaded && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-white z-0 gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-brand-600" />
          <div className="text-xs text-slate-400">
            {usingIMM ? 'WebOffice 文档加载中，首次加载可能需要较长时间…' : '文档加载中…'}
          </div>
        </div>
      )}
      <iframe
        src={viewerUrl}
        title={name}
        className="relative z-10 w-full h-full bg-white"
        onLoad={() => {
          const remaining = minSpinnerRef.current - Date.now();
          if (remaining > 0) setTimeout(() => setIframeLoaded(true), remaining);
          else setIframeLoaded(true);
        }}
      />
    </div>
  );
}
