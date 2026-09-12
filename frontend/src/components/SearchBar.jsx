import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Download, Loader2, Search, X } from 'lucide-react';
import { BsFolder } from 'react-icons/bs';
import { getFileUrl, search as searchApi } from '../api.js';
import { downloadAndAlert, errMsg } from '../utils.js';
import FileIcon from './FileIcon.jsx';
import { openFolderOrFile } from '../ui.js';
import { useClickOutside } from '../hooks/useClickOutside.js';
import { useResource } from '../data/resource.js';

export default function SearchBar({ className = '' }) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  // 输入即时更新 q（驱动输入框与清除按钮）；请求键用防抖后的 debouncedQ。
  const [debouncedQ, setDebouncedQ] = useState('');
  const [open, setOpen] = useState(false);
  const [dropdownRect, setDropdownRect] = useState(null);
  const inputRef = useRef(null);
  const wrapRef = useRef(null);
  const dropdownRef = useRef(null);
  const timerRef = useRef(null);
  const navigate = useNavigate();

  // IMPROVE-54：请求去重/取消下沉到 data/resource.js。cache:false 是刻意的——
  // 旧关键词的命中列表绝不能展示给新关键词（原先的 P1 修复）。
  const { data: results, error: searchError, loading, reload } = useResource(
    `search:${debouncedQ}`,
    (_key, { signal }) => searchApi(debouncedQ, { signal }),
    { enabled: debouncedQ.trim().length > 0, cache: false }
  );
  const err = searchError ? errMsg(searchError, t('search.failed')) : '';

  const onChange = (e) => {
    const v = e.target.value;
    setQ(v);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setDebouncedQ(v), 250);
  };

  const clear = () => {
    clearTimeout(timerRef.current);
    setQ('');
    setDebouncedQ('');
    setOpen(false);
    inputRef.current?.focus();
  };

  // Clear any pending debounce timer on unmount so a late fire can't setState
  // after the component is gone (and to avoid a stray request from the old q).
  useEffect(() => () => clearTimeout(timerRef.current), []);

  // 结果到达（或失败）时展开下拉；切换关键词后 results 变 undefined，下拉随
  // 渲染条件自动收起——「发起新查询就扔掉旧命中」的语义由此保持。
  useEffect(() => {
    if (results || err) setOpen(true);
  }, [results, err]);

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
      // 位置没变就不 setState：scroll 是 capture 监听（任何容器滚动都触发），
      // 逐帧新对象会让整个下拉（含全部结果行）无意义重渲染。
      setDropdownRect((prev) => {
        const top = rect.bottom + 8;
        if (prev && prev.top === top && prev.left === rect.left && prev.width === rect.width) {
          return prev;
        }
        return { top, left: rect.left, width: rect.width };
      });
    };
    // rAF 合并同一帧内的多次 scroll 事件（IMPROVE-52）。
    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        update();
      });
    };
    update();
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
    };
  }, [open]);

  useClickOutside(true, () => setOpen(false), wrapRef, dropdownRef);

  const handleResult = (item) => {
    setOpen(false);
    setQ('');
    setDebouncedQ('');
    openFolderOrFile(item, navigate);
  };

  const total = results ? (results.folders?.length || 0) + (results.files?.length || 0) : 0;

  const handleDownload = async (e, file) => {
    e.preventDefault();
    e.stopPropagation();
    await downloadAndAlert(file, getFileUrl);
  };

  return (
    <div ref={wrapRef} className={`relative z-[70] w-full max-w-[520px] ${className}`.trim()}>
      <div className="rb-search-pill relative">
        <Search className="absolute left-[15px] top-1/2 w-4 h-4 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={q}
          onChange={onChange}
          onFocus={() => results && setOpen(true)}
          placeholder={t('search.placeholder')}
          className="w-full rounded-full border-0 bg-transparent py-[8px] pl-11 pr-10 text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:outline-none focus:ring-0"
        />
        {q && (
          <button
            type="button"
            onClick={clear}
            aria-label={loading ? t('search.loadingAria') : t('search.clear')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-900"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <X className="w-4 h-4" />
            )}
          </button>
        )}
      </div>

      {open && (err || results) && dropdownRect && createPortal(
        <div
          ref={dropdownRef}
          className="rb-search-dropdown fixed z-[200] overflow-hidden"
          style={{
            top: dropdownRect.top,
            left: dropdownRect.left,
            width: dropdownRect.width,
          }}
        >
          {err ? (
            <div className="flex items-center justify-between gap-3 px-4 py-4 text-sm">
              <span className="text-red">{err}</span>
              <button
                type="button"
                onClick={reload}
                className="shrink-0 rounded-full bg-field px-3 py-1 text-xs text-ink-2 hover:bg-hover"
              >
                {t('search.retry')}
              </button>
            </div>
          ) : total === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-slate-500">{t('search.noResult')}</div>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              {results.folders.length > 0 && (
                <div>
                  <div className="px-4 py-2 text-xs text-slate-500 font-medium">{t('search.folders')}</div>
                  {results.folders.map((f) => (
                    <button
                      key={`d-${f.id}`}
                      onClick={() => handleResult(f)}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50 transition-colors"
                    >
                      <BsFolder className="w-4 h-4 text-amber-400 shrink-0" />
                      <span className="text-sm text-slate-900 truncate">{f.name}</span>
                    </button>
                  ))}
                </div>
              )}
              {results.files.length > 0 && (
                <div>
                  <div className="px-4 py-2 text-xs text-slate-500 font-medium">{t('search.files')}</div>
                  {results.files.map((f) => (
                    <div
                      key={`f-${f.id}`}
                      className="flex w-full items-center gap-1 hover:bg-slate-50 transition-colors"
                    >
                      <button
                        type="button"
                        onClick={() => handleResult(f)}
                        className="min-w-0 flex flex-1 items-center gap-3 py-2.5 pl-4 pr-1 text-left"
                      >
                        <FileIcon type="file" ext={f.ext} className="w-4 h-4 shrink-0" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm text-slate-900 truncate">{f.name}</span>
                          {f.folder_path && (
                            <span className="block text-xs text-slate-400 truncate">{f.folder_path}</span>
                          )}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => handleDownload(e, f)}
                        className="mr-2 flex w-8 h-8 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-900"
                        title={t('common.download')}
                        aria-label={t('search.download', { name: f.name })}
                      >
                        <Download className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="border-t border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-400">
            {err
              ? t('search.failed')
              : results?.truncated
                ? t('search.resultsTruncated', { count: total })
                : t('search.resultsCount', { count: total })}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
