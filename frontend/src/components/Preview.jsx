import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Download, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { getFileUrl } from '../api.js';
import { getPreviewKind } from '../utils.js';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export default function Preview({ file, onClose }) {
  // signedUrl: the raw OSS signed URL from backend (used by Office viewer & image)
  // blobUrl:   an object: URL created locally after fetching the file; used for
  //            PDF / text iframes to bypass OSS's force-download header.
  const [signedUrl, setSignedUrl] = useState(null);
  const [blobUrl, setBlobUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState('');
  const blobRef = useRef(null);
  const kind = getPreviewKind(file.ext);
  const [isMobilePreview, setIsMobilePreview] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 640px)');
    const update = () => setIsMobilePreview(query.matches);
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);

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

  const overlay = (
    <div
      className="fixed inset-0 bg-black/60 z-[120] flex items-stretch justify-center p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-white w-full h-full min-h-[100dvh] flex flex-col overflow-hidden sm:h-[85vh] sm:min-h-0 sm:max-w-5xl sm:rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-2.5 border-b border-slate-200 sm:px-4 sm:py-3">
          <div className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800 sm:text-base">{file.name}</div>
          <div className="flex items-center gap-2">
            <button
              onClick={download}
              disabled={loading || !signedUrl}
              className="flex items-center gap-1 text-sm text-slate-600 hover:text-brand-600 px-2 py-1 rounded disabled:opacity-50"
              title="下载"
            >
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">下载</span>
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
        <div className="min-h-0 flex-1 bg-slate-100 overflow-auto">
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
              isMobilePreview={isMobilePreview}
            />
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}

function PreviewBody({ kind, signedUrl, blobUrl, name, isMobilePreview }) {
  if (kind === 'image') {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <img src={signedUrl} alt={name} className="max-h-full max-w-full object-contain shadow" />
      </div>
    );
  }
  if (kind === 'pdf' && (blobUrl || signedUrl)) {
    if (isMobilePreview) {
      return <PdfCanvasViewer src={blobUrl} name={name} />;
    }
    return (
      <div className="relative h-full min-h-0 bg-white">
        <iframe src={blobUrl} title={name} className="h-full w-full bg-white" />
      </div>
    );
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

function PdfCanvasViewer({ src, name }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const renderTaskRef = useRef(null);
  const [pdf, setPdf] = useState(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!src) return undefined;
    let cancelled = false;
    setLoading(true);
    setErr('');
    setPdf(null);
    setPageNumber(1);
    setPageCount(0);

    const task = getDocument({
      url: src,
      cMapUrl: '/pdfjs/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: '/pdfjs/standard_fonts/',
    });
    task.promise
      .then((doc) => {
        if (cancelled) {
          doc.destroy();
          return;
        }
        setPdf(doc);
        setPageCount(doc.numPages);
      })
      .catch((e) => {
        if (!cancelled) setErr(e?.message || 'PDF 预览失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
      task.destroy();
    };
  }, [src]);

  useEffect(() => {
    if (!pdf || !canvasRef.current) return undefined;
    let cancelled = false;

    const render = async () => {
      try {
        renderTaskRef.current?.cancel();
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;

        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');
        const containerWidth = Math.max(280, (wrapRef.current?.clientWidth || window.innerWidth) - 24);
        const baseViewport = page.getViewport({ scale: 1 });
        const cssScale = containerWidth / baseViewport.width;
        const outputScale = Math.min(window.devicePixelRatio || 1, 3);
        const viewport = page.getViewport({ scale: cssScale * outputScale });
        const cssHeight = baseViewport.height * cssScale;

        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(containerWidth)}px`;
        canvas.style.height = `${Math.floor(cssHeight)}px`;

        const renderTask = page.render({ canvasContext: context, viewport });
        renderTaskRef.current = renderTask;
        await renderTask.promise;
      } catch (e) {
        if (!cancelled && e?.name !== 'RenderingCancelledException') {
          setErr(e?.message || 'PDF 渲染失败');
        }
      }
    };

    render();
    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
    };
  }, [pdf, pageNumber]);

  if (loading) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-2">
        <Loader2 className="w-6 h-6 animate-spin" />
        <div className="text-xs">正在准备预览…</div>
      </div>
    );
  }

  if (err) {
    return <div className="h-full flex items-center justify-center p-4 text-center text-red-500">{err}</div>;
  }

  return (
    <div className="h-full min-h-0 bg-slate-200 flex flex-col">
      <div
        ref={wrapRef}
        className="min-h-0 flex-1 overflow-auto px-3 py-3"
      >
        <canvas ref={canvasRef} aria-label={name} className="mx-auto block bg-white shadow" />
      </div>
      <div
        className="shrink-0 border-t border-slate-300 bg-white px-3 py-2 flex items-center justify-between"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setPageNumber((n) => Math.max(1, n - 1));
          }}
          disabled={pageNumber <= 1}
          className="h-11 w-11 rounded-full border border-slate-300 bg-white text-slate-700 disabled:opacity-35 flex items-center justify-center"
          aria-label="上一页"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="text-xs text-slate-600">
          {pageNumber} / {pageCount || '-'}
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setPageNumber((n) => Math.min(pageCount || n, n + 1));
          }}
          disabled={!pageCount || pageNumber >= pageCount}
          className="h-11 w-11 rounded-full border border-slate-300 bg-white text-slate-700 disabled:opacity-35 flex items-center justify-center"
          aria-label="下一页"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
