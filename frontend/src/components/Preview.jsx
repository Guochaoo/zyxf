import { useEffect, useRef, useState } from 'react';
import { X, Download, Loader2 } from 'lucide-react';
import { getFileUrl } from '../api.js';
import { getPreviewKind } from '../utils.js';

export default function Preview({ file, onClose }) {
  // signedUrl: the raw OSS signed URL from backend (used by Office viewer & image)
  // blobUrl:   an object: URL created locally after fetching the file; used for
  //            PDF / text iframes to bypass OSS's force-download header.
  const [signedUrl, setSignedUrl] = useState(null);
  const [mimeType, setMimeType] = useState(null);
  const [blobUrl, setBlobUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState('');
  const blobRef = useRef(null);
  const kind = getPreviewKind(file.ext);

  useEffect(() => {
    let cancelled = false;
    let controller = new AbortController();
    setLoading(true);
    setErr('');
    setProgress(0);
    (async () => {
      try {
        const meta = await getFileUrl(file.id);
        if (cancelled) return;
        setSignedUrl(meta.url);
        setMimeType(meta.mime_type);

        // For PDF / text we must turn the response into a Blob so the
        // browser ignores OSS's Content-Disposition: attachment header.
        // For image and office we can use signedUrl directly.
        if (kind === 'pdf' || kind === 'text') {
          const resp = await fetch(meta.url, { signal: controller.signal });
          if (!resp.ok) throw new Error(`下载文件失败 (${resp.status})`);
          // Read with progress
          const total = Number(resp.headers.get('content-length')) || 0;
          const reader = resp.body?.getReader();
          if (!reader) {
            const buf = await resp.arrayBuffer();
            if (cancelled) return;
            const blob = new Blob([buf], { type: meta.mime_type || 'application/octet-stream' });
            const url = URL.createObjectURL(blob);
            blobRef.current = url;
            setBlobUrl(url);
          } else {
            const chunks = [];
            let received = 0;
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              chunks.push(value);
              received += value.byteLength;
              if (total) setProgress(Math.round((received / total) * 100));
            }
            if (cancelled) return;
            const blob = new Blob(chunks, { type: meta.mime_type || 'application/octet-stream' });
            const url = URL.createObjectURL(blob);
            blobRef.current = url;
            setBlobUrl(url);
          }
        }
      } catch (e) {
        if (!cancelled && e.name !== 'AbortError') {
          setErr(e.response?.data?.error || e.message || '加载失败');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
      if (blobRef.current) {
        URL.revokeObjectURL(blobRef.current);
        blobRef.current = null;
      }
    };
  }, [file.id, kind]);

  const download = async () => {
    if (!signedUrl) {
      alert('文件地址尚未就绪，请稍后重试');
      return;
    }
    try {
      // Reuse the fetched blob if available; otherwise fetch now.
      let href = blobUrl;
      let cleanup = false;
      if (!href) {
        const resp = await fetch(signedUrl);
        if (!resp.ok) throw new Error(`下载失败 (${resp.status})`);
        const blob = await resp.blob();
        href = URL.createObjectURL(blob);
        cleanup = true;
      }
      const a = document.createElement('a');
      a.href = href;
      a.download = file.name; // preserves original Chinese filename
      document.body.appendChild(a);
      a.click();
      a.remove();
      if (cleanup) setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch (e) {
      alert(e.message || '下载失败');
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <div className="truncate text-slate-800 font-medium">{file.name}</div>
          <div className="flex items-center gap-2">
            <button
              onClick={download}
              disabled={loading || !signedUrl}
              className="flex items-center gap-1 text-sm text-slate-600 hover:text-brand-600 px-2 py-1 rounded disabled:opacity-50"
              title="下载"
            >
              <Download className="w-4 h-4" />
              下载
            </button>
            <button
              onClick={onClose}
              className="p-1 hover:bg-slate-100 rounded text-slate-500"
              title="关闭"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
        <div className="flex-1 bg-slate-100 overflow-auto">
          {loading && (
            <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-2">
              <Loader2 className="w-6 h-6 animate-spin" />
              {(kind === 'pdf' || kind === 'text') && progress > 0 && (
                <div className="text-xs">加载中… {progress}%</div>
              )}
            </div>
          )}
          {!loading && err && (
            <div className="h-full flex items-center justify-center text-red-500 p-4 text-center">
              {err}
            </div>
          )}
          {!loading && !err && (
            <PreviewBody
              kind={kind}
              signedUrl={signedUrl}
              blobUrl={blobUrl}
              name={file.name}
              mimeType={mimeType}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function PreviewBody({ kind, signedUrl, blobUrl, name }) {
  if (kind === 'image') {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <img src={signedUrl} alt={name} className="max-h-full max-w-full object-contain shadow" />
      </div>
    );
  }
  if (kind === 'pdf' && blobUrl) {
    return <iframe src={blobUrl} title={name} className="w-full h-full bg-white" />;
  }
  if (kind === 'office') {
    const viewer = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(signedUrl)}`;
    return <iframe src={viewer} title={name} className="w-full h-full bg-white" />;
  }
  if (kind === 'text' && blobUrl) {
    return <iframe src={blobUrl} title={name} className="w-full h-full bg-white" />;
  }
  return (
    <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-3 p-8">
      <div>该文件类型暂不支持在线预览。</div>
      <a
        href={signedUrl}
        target="_blank"
        rel="noreferrer"
        className="text-sm text-brand-600 hover:underline"
      >
        在新窗口打开
      </a>
    </div>
  );
}
