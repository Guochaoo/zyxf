import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import { BsFolder } from 'react-icons/bs';
import FileIcon from './FileIcon.jsx';
import GlideList from './GlideList.jsx';
import { useFolderTree } from '../hooks/useFolderTree.js';
import { openFilePreview } from '../ui.js';

/**
 * Sidebar folder tree, Vercel-docs style:
 * - recursive expand/collapse, chevron toggles a subtree without navigating
 * - clicking a folder name navigates into it; the current folder is highlighted
 * - the ancestor chain of the current folder auto-expands
 * - listens for the global 'folders-changed' event to refresh after admin ops
 */
export default function FolderTree({ currentId = 0, className = '' }) {
  const { t } = useTranslation();
  const { tree, rootFiles } = useFolderTree();
  const [expanded, setExpanded] = useState(() => new Set());
  const location = useLocation();
  const currentRef = useRef(currentId);
  currentRef.current = currentId;

  // Collapse everything when switching folders unless it's on the active path.
  const toggle = useCallback((id) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const activePath = useMemo(() => {
    if (!tree) return [];
    const ids = [];
    const walk = (nodes) => {
      for (const n of nodes) {
        ids.push(n.id);
        if (n.id === currentRef.current) return true;
        if (n.children?.length && walk(n.children)) return true;
        ids.pop();
      }
      return false;
    };
    walk(tree);
    return ids;
  }, [tree, location.pathname]);

  useEffect(() => {
    setExpanded((prev) => {
      const next = new Set(prev);
      // 首页 (root node) is expanded by default; re-expand it when returning
      // to the root. Manual collapse is respected until the next navigation.
      if (currentRef.current === 0) next.add(0);
      for (const id of activePath) next.add(id);
      return next;
    });
  }, [activePath]);

  // 滚动时显示滑块，停止 700ms 后渐隐（配合 .rb-side-scroll 的 CSS 过渡）。
  // 直接操作 class 避免 setState 在滚动事件里触发重渲染。
  const scrollHideTimer = useRef(null);
  useEffect(() => () => clearTimeout(scrollHideTimer.current), []);
  const handleTreeScroll = (e) => {
    const el = e.currentTarget;
    el.classList.add('is-scrolling');
    clearTimeout(scrollHideTimer.current);
    scrollHideTimer.current = setTimeout(() => el.classList.remove('is-scrolling'), 700);
  };

  if ((!tree || tree.length === 0) && rootFiles.length === 0) return null;

  const rootId = currentId || 0;

  return (
    <aside className={`flex min-h-0 flex-1 flex-col ${className}`.trim()}>
      <div className="px-2 pb-2 text-[12px] font-medium text-ink-3">{t('tree.title')}</div>
      <nav
        aria-label={t('tree.title')}
        className="rb-side-scroll -mx-1 min-h-0 flex-1 overflow-y-auto px-1"
        onScroll={handleTreeScroll}
      >
        <GlideList className="-mx-1 px-1">
          <TreeNode
            node={{ id: 0, name: t('tree.home'), children: tree || [], files: rootFiles }}
            depth={0}
            currentId={rootId}
            expanded={expanded}
            onToggle={toggle}
          />
        </GlideList>
      </nav>
    </aside>
  );
}

function TreeNode({ node, depth, currentId, expanded, onToggle }) {
  const { t } = useTranslation();
  const isCurrent = node.id === currentId;
  const hasChildren = node.children && node.children.length > 0;
  const hasFiles = node.files && node.files.length > 0;
  const expandable = hasChildren || hasFiles;
  const open = expanded.has(node.id);

  const row = (
    <span
      data-glide-row
      className={`flex h-8 w-full items-center gap-1.5 rounded-md px-2 text-[14px] leading-none transition-[color,transform] duration-150 active:scale-[0.98] ${
        isCurrent
          ? 'bg-inset font-medium text-ink'
          : 'text-ink-2 hover:text-ink'
      }`}
      style={{ paddingLeft: `${8 + depth * 16}px` }}
    >
      {expandable ? (
        <span
          role="button"
          tabIndex={0}
          aria-expanded={open}
          aria-label={open ? t('tree.collapseAria', { name: node.name }) : t('tree.expandAria', { name: node.name })}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onToggle(node.id);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.stopPropagation();
              onToggle(node.id);
            }
          }}
          className="-ml-1 flex h-6 w-5 shrink-0 items-center justify-center text-ink-3"
        >
          <ChevronRight
            className={`h-3.5 w-3.5 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
          />
        </span>
      ) : (
        <span className="w-5 shrink-0" />
      )}
      <BsFolder className="h-4 w-4 shrink-0 text-ink-3" />
      <span className="min-w-0 flex-1 truncate">{node.name}</span>
    </span>
  );

  return (
    <div>
      {isCurrent ? (
        <div aria-current="page">{row}</div>
      ) : (
        <Link className="block" to={node.id === 0 ? '/' : `/folder/${node.id}`}>
          {row}
        </Link>
      )}
      {expandable && open && (
        <div>
          {node.children.map((c) => (
            <TreeNode
              key={c.id}
              node={c}
              depth={depth + 1}
              currentId={currentId}
              expanded={expanded}
              onToggle={onToggle}
            />
          ))}
          {(node.files || []).map((f) => (
            <FileRow key={`f-${f.id}`} file={f} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

// File leaf — clicking navigates to its folder and opens the preview.
function FileRow({ file, depth }) {
  const navigate = useNavigate();

  return (
    <button
      type="button"
      onClick={() => openFilePreview(file, navigate)}
      className="block w-full text-left"
    >
      <span
        data-glide-row
        className="flex h-8 w-full items-center gap-1.5 rounded-md px-2 text-[14px] leading-none text-ink-2 transition-[color,transform] duration-150 active:scale-[0.98] hover:text-ink"
        style={{ paddingLeft: `${8 + depth * 16}px` }}
      >
        <span className="w-5 shrink-0" />
        <FileIcon type="file" ext={file.ext} className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{file.name}</span>
      </span>
    </button>
  );
}
