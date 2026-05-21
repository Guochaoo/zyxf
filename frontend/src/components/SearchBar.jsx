import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { FolderOpen, Loader2, X, Download } from 'lucide-react';
import { BsSearch } from 'react-icons/bs';
import { getFileUrl, search as searchApi } from '../api.js';
import { downloadFileById, formatSize } from '../utils.js';
import FileIcon from './FileIcon.jsx';

export default function SearchBar({ className = '' }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [dropdownRect, setDropdownRect] = useState(null);
  const inputRef = useRef(null);
  const wrapRef = useRef(null);
  const dropdownRef = useRef(null);
  const timerRef = useRef(null);
  const navigate = useNavigate();

  const doSearch = useCallback(async (query) => {
    if (!query.trim()) {
      setResults(null);
      setOpen(false);
      return;
    }
    setLoading(true);
    try {
      const data = await searchApi(query);
      setResults(data);
      setOpen(true);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  const onChange = (e) => {
    const v = e.target.value;
    setQ(v);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => doSearch(v), 250);
  };

  const clear = () => {
    setQ('');
    setResults(null);
    setOpen(false);
    inputRef.current?.focus();
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        inputRef.current?.blur();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!open || !wrapRef.current) return undefined;
    const update = () => {
      const rect = wrapRef.current.getBoundingClientRect();
      setDropdownRect({
        top: rect.bottom + 8,
        left: rect.left,
        width: rect.width,
      });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open]);

  useEffect(() => {
    const onClick = (e) => {
      if (
        wrapRef.current &&
        !wrapRef.current.contains(e.target) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const handleResult = (item) => {
    setOpen(false);
    setQ('');
    setResults(null);
    if (item.type === 'folder') {
      navigate(`/folder/${item.id}`);
    } else {
      const targetPath = item.folder_id ? `/folder/${item.folder_id}` : '/';
      navigate(targetPath, {
        state: { previewFile: item },
      });
    }
  };

  const total = results ? (results.folders?.length || 0) + (results.files?.length || 0) : 0;

  const handleDownload = async (e, file) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await downloadFileById(file, getFileUrl);
    } catch (err) {
      alert(err.message || '下载失败');
    }
  };

  return (
    <div ref={wrapRef} className={`relative z-[70] w-full max-w-[520px] ${className}`.trim()}>
      <div className="rb-search-pill relative">
        <BsSearch className="absolute left-[15px] top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={q}
          onChange={onChange}
          onFocus={() => results && setOpen(true)}
          placeholder="搜索文件"
          className="w-full rounded-full border-0 bg-transparent py-[10px] pl-11 pr-10 text-sm text-white placeholder:text-slate-500 outline-none focus:outline-none focus:ring-0"
        />
        {q && (
          <button
            onClick={clear}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <X className="w-4 h-4" />
            )}
          </button>
        )}
      </div>

      {open && results && dropdownRect && createPortal(
        <div
          ref={dropdownRef}
          className="rb-search-dropdown fixed z-[200] overflow-hidden"
          style={{
            top: dropdownRect.top,
            left: dropdownRect.left,
            width: dropdownRect.width,
          }}
        >
          {total === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-slate-500">无匹配结果</div>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              {results.folders.length > 0 && (
                <div>
                  <div className="px-4 py-2 text-xs text-slate-500 font-medium">文件夹</div>
                  {results.folders.map((f) => (
                    <button
                      key={`d-${f.id}`}
                      onClick={() => handleResult(f)}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-white/10 transition-colors"
                    >
                      <FolderOpen className="w-4 h-4 text-amber-400 shrink-0" />
                      <span className="text-sm text-slate-200 truncate">{f.name}</span>
                    </button>
                  ))}
                </div>
              )}
              {results.files.length > 0 && (
                <div>
                  <div className="px-4 py-2 text-xs text-slate-500 font-medium">文件</div>
                  {results.files.map((f) => (
                    <div
                      key={`f-${f.id}`}
                    className="flex w-full items-center gap-2 hover:bg-white/10 transition-colors"
                    >
                      <button
                        type="button"
                        onClick={() => handleResult(f)}
                        className="min-w-0 flex flex-1 items-center gap-3 px-4 py-2.5 text-left"
                      >
                        <FileIcon type="file" ext={f.ext} className="w-4 h-4 shrink-0" />
                        <span className="text-sm text-slate-200 truncate flex-1">{f.name}</span>
                        <span className="text-xs text-slate-500 shrink-0">{formatSize(f.size)}</span>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => handleDownload(e, f)}
                        className="mr-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-white/10 hover:text-white"
                        title="下载"
                        aria-label={`下载 ${f.name}`}
                      >
                        <Download className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="border-t border-white/10 bg-white/5 px-4 py-2 text-xs text-slate-400">
            {total} 个结果 · Esc 关闭
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
