import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, FolderOpen, FileText, Loader2, X } from 'lucide-react';
import { search as searchApi } from '../api.js';
import { formatSize } from '../utils.js';

export default function SearchBar() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const inputRef = useRef(null);
  const wrapRef = useRef(null);
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
    const onClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
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
      // For files, navigate to the parent folder (so the user sees it in context)
      navigate(item.folder_id ? `/folder/${item.folder_id}` : '/');
    }
  };

  const total = results ? (results.folders?.length || 0) + (results.files?.length || 0) : 0;

  return (
    <div ref={wrapRef} className="relative z-[70] w-full sm:max-w-md">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={q}
          onChange={onChange}
          onFocus={() => results && setOpen(true)}
          placeholder="搜索文件… (Ctrl+K)"
          className="w-full pl-9 pr-8 py-2 bg-white/10 backdrop-blur border border-white/15 rounded-full text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-brand-500/50 focus:bg-white/15 transition-colors"
        />
        {q && (
          <button
            onClick={clear}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <X className="w-4 h-4" />
            )}
          </button>
        )}
      </div>

      {open && results && (
        <div className="absolute top-full mt-2 left-0 right-0 z-[90] bg-slate-900/95 backdrop-blur-md border border-white/10 rounded-xl shadow-2xl overflow-hidden">
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
                    <button
                      key={`f-${f.id}`}
                      onClick={() => handleResult(f)}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-white/10 transition-colors"
                    >
                      <FileText className="w-4 h-4 text-blue-400 shrink-0" />
                      <span className="text-sm text-slate-200 truncate flex-1">{f.name}</span>
                      <span className="text-xs text-slate-500 shrink-0">{formatSize(f.size)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="border-t border-white/10 px-4 py-2 text-xs text-slate-600">
            {total} 个结果 — Esc 关闭
          </div>
        </div>
      )}
    </div>
  );
}
