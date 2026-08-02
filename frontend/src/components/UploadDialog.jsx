import { useRef, useState } from 'react';
import { Upload, X, Loader2 } from 'lucide-react';
import { uploadFile } from '../api.js';
import { errMsg, formatSize } from '../utils.js';

const CONCURRENCY = 3; // files upload in parallel; each is an independent OSS direct-upload

export default function UploadDialog({ folderId, onClose, onDone }) {
  const inputRef = useRef(null);
  const [files, setFiles] = useState([]); // {file, progress, status, error}
  const [busy, setBusy] = useState(false);

  const addFiles = (list) =>
    setFiles((prev) => [
      ...prev,
      ...Array.from(list).map((f) => ({ file: f, progress: 0, status: 'pending' })),
    ]);

  const onPick = (e) => {
    addFiles(e.target.files || []);
    e.target.value = '';
  };

  const onDrop = (e) => {
    e.preventDefault();
    addFiles(e.dataTransfer.files || []);
  };

  const uploadOne = async (item) => {
    setFiles((prev) => prev.map((it) => (it === item ? { ...it, status: 'uploading' } : it)));
    try {
      await uploadFile({
        file: item.file,
        folderId,
        onProgress: (p) =>
          setFiles((prev) => prev.map((it) => (it === item ? { ...it, progress: p } : it))),
      });
      setFiles((prev) =>
        prev.map((it) => (it === item ? { ...it, status: 'done', progress: 100 } : it))
      );
    } catch (e) {
      setFiles((prev) =>
        prev.map((it) => (it === item ? { ...it, status: 'error', error: errMsg(e) } : it))
      );
    }
  };

  const start = async () => {
    if (!files.length) return;
    setBusy(true);
    const pending = files.filter((f) => f.status !== 'done');
    for (let i = 0; i < pending.length; i += CONCURRENCY) {
      await Promise.all(pending.slice(i, i + CONCURRENCY).map(uploadOne));
    }
    setBusy(false);
    onDone?.();
  };

  return (
    <div
      className="upload-dialog fixed inset-0 bg-black/60 z-[80] flex items-center justify-center p-3 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[88vh] overflow-y-auto rb-card rounded-lg border-0 bg-white p-4 sm:p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 font-semibold">
            <Upload className="w-5 h-5" />
            上传文件
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className="border-2 border-dashed border-slate-300 rounded-[10px] px-4 py-10 flex flex-col items-center justify-center hover:bg-slate-100 cursor-pointer text-center text-sm"
        >
          <Upload className="w-7 h-7 mb-2" />
          <div>点击选择文件，或拖拽到此处</div>
          <input ref={inputRef} type="file" multiple hidden onChange={onPick} />
        </div>

        {files.length > 0 && (
          <ul className="mt-4 max-h-60 overflow-auto space-y-2">
            {files.map((it, i) => (
              <li key={i} className="text-xs">
                <div className="flex justify-between gap-3">
                  <span className="truncate mr-2">{it.file.name}</span>
                  <span className="shrink-0">{formatSize(it.file.size)}</span>
                </div>
                <div className="h-1.5 mt-1 bg-slate-200 rounded">
                  <div
                    className={`h-full rounded ${
                      it.status === 'error'
                        ? 'bg-red-500'
                        : it.status === 'done'
                          ? 'bg-[#1E8E3E]'
                          : 'bg-brand-500'
                    }`}
                    style={{ width: `${it.progress}%` }}
                  />
                </div>
                {it.status === 'error' && (
                  <div className="text-red-600 mt-0.5">{it.error}</div>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="text-sm px-3 py-1.5 rounded-[14px] hover:bg-slate-100"
          >
            关闭
          </button>
          <button
            onClick={start}
            disabled={busy || files.length === 0}
            className="text-sm px-3 py-1.5 rounded-[14px] bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 flex items-center gap-1"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            开始上传
          </button>
        </div>
      </div>
    </div>
  );
}
