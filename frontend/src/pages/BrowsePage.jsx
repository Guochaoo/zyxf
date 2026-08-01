import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, Link, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import {
  BsArrowCounterclockwise,
  BsCloudArrowUp,
  BsDownload,
  BsFolderPlus,
  BsGripVertical,
  BsPen,
  BsTrash,
  BsSortAlphaDown,
  BsSortAlphaDownAlt,
} from 'react-icons/bs';
import {
  createFolder,
  deleteFile,
  deleteFolder,
  getFileUrl,
  listFolder,
  moveFile,
  moveFolder,
  renameFile,
  renameFolder,
  reorderItems,
} from '../api.js';
import { useAuth } from '../auth.jsx';
import FileIcon from '../components/FileIcon.jsx';
import GlassSurface from '../components/GlassSurface.jsx';
import Preview from '../components/Preview/index.jsx';
import UploadDialog from '../components/UploadDialog.jsx';
import { downloadFileById, errMsg, formatDate, formatSize } from '../utils.js';
import { useSlidingIndicator } from '../hooks/useSlidingIndicator.js';
import {
  Breadcrumb as BreadcrumbRoot,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '../components/ui/breadcrumb.jsx';

// Default = admin-controlled manual order. Comes first.
const SORT_OPTIONS = [
  { key: 'manual', label: '默认' },
  { key: 'name', label: '名称' },
  { key: 'created_at', label: '时间' },
  { key: 'size', label: '大小' },
];

export default function BrowsePage() {
  const { id: idParam } = useParams();
  const folderId = Number(idParam) || 0;
  const navigate = useNavigate();
  const location = useLocation();
  const { isAdmin } = useAuth();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [sort, setSort] = useState('manual');
  const [order, setOrder] = useState('asc');
  // Refs keep the latest sort/order so refresh() always reads current values,
  // avoiding stale-closure bugs when both setSort and refresh are called together.
  const sortRef = useRef(sort);
  sortRef.current = sort;
  const orderRef = useRef(order);
  orderRef.current = order;
  const [previewing, setPreviewing] = useState(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);

  // Drag state. dragging mirrors to ref so DOM event handlers see fresh value
  // even before the next React render finishes.
  const [dragging, setDragging] = useState(null);
  const draggingRef = useRef(null);
  // dropZone shapes:
  //   { mode: 'into',  targetType: 'folder', id }   — drop INTO a folder (move)
  //   { mode: 'before'|'after', targetType, id }    — reorder relative to a row
  //   { mode: 'crumb', id }                          — drop on a breadcrumb crumb
  const [dropZone, setDropZone] = useState(null);
  const [moveError, setMoveError] = useState('');

  const refresh = useCallback(() => {
    setLoading(true);
    setErr('');
    listFolder(folderId, sortRef.current, orderRef.current)
      .then(setData)
      .catch((e) => setErr(errMsg(e, '加载失败')))
      .finally(() => setLoading(false));
  }, [folderId]);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderId, sort, order]);

  useEffect(() => {
    const previewFile = location.state?.previewFile;
    if (!previewFile || loading || !data) return;
    setPreviewing(previewFile);
    navigate(location.pathname, { replace: true, state: null });
  }, [data, loading, location.pathname, location.state, navigate]);

  const onCreateFolder = async () => {
    const name = window.prompt('新建文件夹名称');
    if (!name) return;
    try {
      await createFolder(name, folderId || null);
      refresh();
    } catch (e) {
      alert(errMsg(e, '创建失败'));
    }
  };

  const onDeleteFolder = async (f) => {
    if (!confirm(`确认删除文件夹「${f.name}」及其所有内容？此操作不可恢复。`)) return;
    try {
      await deleteFolder(f.id);
      refresh();
    } catch (e) {
      alert(errMsg(e, '删除失败'));
    }
  };

  const onDeleteFile = async (f) => {
    if (!confirm(`确认删除文件「${f.name}」？`)) return;
    try {
      await deleteFile(f.id);
      refresh();
    } catch (e) {
      alert(errMsg(e, '删除失败'));
    }
  };

  const openRenameDialog = (item) => {
    setRenameTarget(item);
    setRenameValue(item.name);
  };

  const closeRenameDialog = () => {
    if (renaming) return;
    setRenameTarget(null);
    setRenameValue('');
  };

  const submitRenameDialog = async (e) => {
    e.preventDefault();
    if (!renameTarget) return;
    const name = renameValue.trim();
    if (!name || name === renameTarget.name) {
      closeRenameDialog();
      return;
    }
    setRenaming(true);
    try {
      if (renameTarget.type === 'folder') {
        await renameFolder(renameTarget.id, name);
      } else {
        await renameFile(renameTarget.id, name);
      }
      setRenameTarget(null);
      setRenameValue('');
      refresh();
    } catch (err) {
      alert(errMsg(err, '重命名失败'));
    } finally {
      setRenaming(false);
    }
  };

  const toggleSort = (key) => {
    if (sort === key) {
      // Manual mode doesn't have asc/desc — clicking again is no-op
      if (key === 'manual') return;
      setOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    } else {
      setSort(key);
      setOrder('asc');
    }
  };

  // ---------- drag & drop ----------

  const onDragStart = (e, item) => {
    if (!isAdmin) return;
    draggingRef.current = item;
    setDragging(item);
    e.dataTransfer.effectAllowed = 'move';
    try {
      e.dataTransfer.setData('text/plain', `${item.type}:${item.id}`);
    } catch {
      /* ignore */
    }
  };

  const onDragEnd = () => {
    draggingRef.current = null;
    setDragging(null);
    setDropZone(null);
  };

  // Compute what kind of drop should happen given the target row and pointer Y.
  // Returns null if not allowed.
  const computeRowZone = (e, target /* {type:'folder'|'file', id} */) => {
    const drag = draggingRef.current;
    if (!isAdmin || !drag) return null;
    if (drag.type === target.type && drag.id === target.id) return null; // self

    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const h = rect.height;

    if (target.type === 'folder') {
      // Folders always accept "into". In manual mode, folder-on-folder also reorders at edges.
      if (sort === 'manual' && drag.type === 'folder') {
        if (y < h * 0.25) return { mode: 'before', targetType: 'folder', id: target.id };
        if (y > h * 0.75) return { mode: 'after', targetType: 'folder', id: target.id };
      }
      return { mode: 'into', targetType: 'folder', id: target.id };
    }
    // target is a file
    if (sort !== 'manual') return null; // no drop on files in sorted modes
    if (drag.type !== 'file') return null; // only file-to-file reordering
    return { mode: y < h * 0.5 ? 'before' : 'after', targetType: 'file', id: target.id };
  };

  const onRowDragOver = (e, target) => {
    const z = computeRowZone(e, target);
    if (!z) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropZone((prev) =>
      prev && prev.mode === z.mode && prev.targetType === z.targetType && prev.id === z.id
        ? prev
        : z
    );
  };

  const onRowDragLeave = (target) => {
    setDropZone((p) =>
      p && p.targetType === target.type && p.id === target.id ? null : p
    );
  };

  const buildReorder = (drag, target, position /* 'before'|'after' */) => {
    if (!data) return null;
    const all = [
      ...data.folders.map((f) => ({ type: 'folder', id: f.id })),
      ...data.files.map((f) => ({ type: 'file', id: f.id })),
    ];
    const filtered = all.filter((it) => !(it.type === drag.type && it.id === drag.id));
    const idx = filtered.findIndex((it) => it.type === target.type && it.id === target.id);
    if (idx === -1) return null;
    const insertAt = position === 'before' ? idx : idx + 1;
    filtered.splice(insertAt, 0, { type: drag.type, id: drag.id });
    return filtered;
  };

  const onRowDrop = async (e, target) => {
    e.preventDefault();
    const z = computeRowZone(e, target);
    if (!z) return;
    const item = draggingRef.current;
    draggingRef.current = null;
    setDragging(null);
    setDropZone(null);
    setMoveError('');
    try {
      if (z.mode === 'into') {
        const dest = z.id;
        if (item.type === 'file') await moveFile(item.id, dest);
        else await moveFolder(item.id, dest);
        refresh();
      } else {
        // before / after — reorder
        const newOrder = buildReorder(
          item,
          { type: z.targetType, id: z.id },
          z.mode
        );
        if (!newOrder) return;
        await reorderItems(folderId || null, newOrder);
        // Switch to manual sort if user wasn't already, so they can see the change.
        // When switching sort, useEffect will trigger refresh automatically.
        // When already in manual mode, refresh explicitly.
        if (sort !== 'manual') {
          setSort('manual');
        } else {
          refresh();
        }
      }
    } catch (err) {
      setMoveError(errMsg(err, '操作失败'));
      setTimeout(() => setMoveError(''), 4000);
    }
  };

  // Breadcrumb drop = move into that folder (id=0 means root)
  const canDropCrumb = (crumbId) => {
    const drag = draggingRef.current;
    if (!isAdmin || !drag) return false;
    if (drag.type === 'folder' && drag.id === crumbId) return false;
    return true;
  };
  const onCrumbDragOver = (e, crumbId) => {
    if (!canDropCrumb(crumbId)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropZone((p) =>
      p && p.mode === 'crumb' && p.id === crumbId ? p : { mode: 'crumb', id: crumbId }
    );
  };
  const onCrumbDragLeave = (crumbId) => {
    setDropZone((p) => (p && p.mode === 'crumb' && p.id === crumbId ? null : p));
  };
  const onCrumbDrop = async (e, crumbId) => {
    e.preventDefault();
    if (!canDropCrumb(crumbId)) return;
    const item = draggingRef.current;
    draggingRef.current = null;
    setDragging(null);
    setDropZone(null);
    setMoveError('');
    const dest = crumbId === 0 ? null : crumbId;
    try {
      if (item.type === 'file') await moveFile(item.id, dest);
      else await moveFolder(item.id, dest);
      refresh();
    } catch (err) {
      setMoveError(errMsg(err, '移动失败'));
      setTimeout(() => setMoveError(''), 4000);
    }
  };

  const onDownloadFile = async (f) => {
    try {
      await downloadFileById(f, getFileUrl);
    } catch (e) {
      alert(e.message || '下载失败');
    }
  };

  return (
    <div className="space-y-4">
      {/* Breadcrumb + Toolbar */}
      <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr] md:items-center">
        <div className="order-last flex justify-start md:order-none md:col-start-1">
          <Breadcrumb
            crumbs={data?.breadcrumb}
            currentId={folderId}
            dragging={dragging}
            dropZone={dropZone}
            onDragOver={onCrumbDragOver}
            onDragLeave={onCrumbDragLeave}
            onDrop={onCrumbDrop}
          />
        </div>
        <div className="flex w-full flex-wrap items-center justify-end gap-2 md:col-start-3 md:w-auto">
          <button
            onClick={refresh}
            className="order-2 p-0 sm:order-none"
            title="刷新"
          >
            <ToolbarGlass width={34}>
              <span className="toolbar-glass-button flex h-full w-full items-center justify-center">
                <BsArrowCounterclockwise className="w-4 h-4" />
              </span>
            </ToolbarGlass>
          </button>
          <div className="order-1 sm:order-none">
            <SortControl sort={sort} order={order} onChange={toggleSort} />
          </div>
          {isAdmin && (
            <>
              <ToolbarGlass className="order-3 shrink-0 sm:order-none">
                <button
                  onClick={onCreateFolder}
                  className="toolbar-glass-button flex h-full items-center gap-1 px-3 text-sm"
                >
                  <BsFolderPlus className="w-4 h-4" />
                  新建文件夹
                </button>
              </ToolbarGlass>
              <button
                onClick={() => setUploadOpen(true)}
                className="order-3 flex h-[34px] items-center gap-1 rounded-[14px] bg-brand-600 px-3 text-sm hover:bg-brand-700 sm:order-none"
              >
                <BsCloudArrowUp className="w-4 h-4" />
                上传
              </button>
            </>
          )}
        </div>
      </div>

      {/* Floating banners — fixed so they don't disrupt drag layout */}
      {isAdmin && dragging && (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-6 z-40 pointer-events-none text-xs text-brand-700 bg-brand-50 border border-brand-200 rounded-full shadow-md px-4 py-1.5">
          正在移动「{dragging.name}」
          {sort === 'manual'
            ? ' — 在行的上/下边缘可插入排序，拖到文件夹中部可移入'
            : ' — 拖到文件夹或上方面包屑'}
        </div>
      )}
      {moveError && (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-6 z-40 text-xs text-red-700 bg-red-50 border border-red-200 rounded-full shadow-md px-4 py-1.5">
          {moveError}
        </div>
      )}

      {/* Body */}
      <div className="bg-white/10 backdrop-blur-md border border-white/10 rounded-xl overflow-hidden">
        {loading ? (
          <div className="py-16 flex items-center justify-center text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin mr-2 text-slate-400" /> 加载中…
          </div>
        ) : err ? (
          <div className="py-16 text-center text-red-500">{err}</div>
        ) : (
          <ItemListWithRename
            data={data}
            isAdmin={isAdmin}
            dragging={dragging}
            dropZone={dropZone}
            onEnterFolder={(f) => navigate(`/folder/${f.id}`)}
            onPreviewFile={setPreviewing}
            onDeleteFolder={onDeleteFolder}
            onDeleteFile={onDeleteFile}
            onRenameFolder={(f) => openRenameDialog({ ...f, type: 'folder' })}
            onRenameFile={(f) => openRenameDialog({ ...f, type: 'file' })}
            onDownloadFile={onDownloadFile}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onRowDragOver={onRowDragOver}
            onRowDragLeave={onRowDragLeave}
            onRowDrop={onRowDrop}
          />
        )}
      </div>

      {renameTarget && (
        <div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/35 px-4">
          <form
            onSubmit={submitRenameDialog}
            className="w-full max-w-sm rounded-[18px] border border-white/10 bg-black/55 p-4 text-white shadow-2xl backdrop-blur-2xl"
          >
            <h2 className="text-base font-semibold">重命名</h2>
            <p className="mt-1 text-xs text-slate-400">
              {renameTarget.type === 'folder' ? '文件夹名称' : '文件名'}
            </p>
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              className="mt-4 w-full rounded-[12px] border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-white/30"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeRenameDialog}
                disabled={renaming}
                className="rounded-[10px] px-3 py-1.5 text-sm text-slate-300 hover:bg-white/10 disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={renaming}
                className="rename-dialog-save rounded-[10px] bg-white px-3 py-1.5 text-sm font-semibold text-black disabled:opacity-50"
              >
                {renaming ? '保存中...' : '保存'}
              </button>
            </div>
          </form>
        </div>
      )}

      {previewing && <Preview file={previewing} onClose={() => setPreviewing(null)} />}
      {uploadOpen && (
        <UploadDialog
          folderId={folderId || null}
          onClose={() => setUploadOpen(false)}
          onDone={refresh}
        />
      )}
    </div>
  );
}

function Breadcrumb({ crumbs, currentId, dragging, dropZone, onDragOver, onDragLeave, onDrop }) {
  if (!crumbs) return <div className="h-6" />;
  return (
    <BreadcrumbRoot>
      <BreadcrumbList>
        {crumbs.map((c, i) => {
          const isCurrent = i === crumbs.length - 1;
          const droppable = !!dragging && c.id !== currentId;
          const active = droppable && dropZone?.mode === 'crumb' && dropZone.id === c.id;
          const linkCls = `px-1.5 py-0.5 rounded text-white transition-colors ${
            active ? 'bg-brand-100 ring-1 ring-brand-400 !text-brand-700' : 'hover:text-white/80'
          }`;
          const dndProps = droppable
            ? {
                onDragOver: (e) => onDragOver(e, c.id),
                onDragLeave: () => onDragLeave(c.id),
                onDrop: (e) => onDrop(e, c.id),
              }
            : {};
          return (
            <Fragment key={c.id}>
              {i > 0 && <BreadcrumbSeparator />}
              <BreadcrumbItem>
                {isCurrent ? (
                  <BreadcrumbPage className="text-white">{c.name}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild className={linkCls} {...dndProps}>
                    <Link to={c.id === 0 ? '/' : `/folder/${c.id}`}>{c.name}</Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </BreadcrumbRoot>
  );
}

// Shared glass styling for the browse toolbar buttons.
function ToolbarGlass({ width = 'auto', className = '', children }) {
  return (
    <GlassSurface
      width={width}
      height={34}
      borderRadius={14}
      saturation={1.4}
      className={`toolbar-glass ${className}`}
    >
      {children}
    </GlassSurface>
  );
}

function SortControl({ sort, order, onChange }) {
  const listRef = useRef(null);
  const buttonRefs = useRef({});
  const indicator = useSlidingIndicator(listRef, buttonRefs, sort);

  return (
    <ToolbarGlass className="max-w-full">
      <div ref={listRef} className="relative flex max-w-full items-center overflow-x-auto text-xs">
        <span
          className="pointer-events-none absolute inset-y-0 rounded-[14px] bg-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)]"
          style={{
            width: indicator.width,
            transform: `translateX(${indicator.left}px)`,
            opacity: indicator.ready ? 1 : 0,
            transition:
              'transform 360ms cubic-bezier(0.22, 1, 0.36, 1), width 360ms cubic-bezier(0.22, 1, 0.36, 1), opacity 160ms ease',
          }}
        />
        {SORT_OPTIONS.map((opt) => {
          const active = sort === opt.key;
          const showArrow = active && opt.key !== 'manual';
          return (
            <button
              ref={(node) => {
                if (node) buttonRefs.current[opt.key] = node;
              }}
              key={opt.key}
              onClick={() => onChange(opt.key)}
              className={`sort-option relative z-10 flex h-[34px] shrink-0 items-center justify-center bg-transparent px-2.5 transition-colors focus:outline-none ${
                active ? 'sort-option--active' : ''
              } ${opt.key === 'manual' ? '' : 'pr-6'}`}
            >
              <span className="leading-none">{opt.label}</span>
              <span className="absolute right-2 top-1/2 flex w-3 -translate-y-1/2 items-center justify-center">
                {opt.key !== 'manual' &&
                  (order === 'asc' ? (
                    <BsSortAlphaDown className={`w-3.5 h-3.5 transition-opacity ${showArrow ? 'opacity-100' : 'opacity-0'}`} />
                  ) : (
                    <BsSortAlphaDownAlt className={`w-3.5 h-3.5 transition-opacity ${showArrow ? 'opacity-100' : 'opacity-0'}`} />
                  ))}
              </span>
            </button>
          );
        })}
      </div>
    </ToolbarGlass>
  );
}

function ItemListWithRename({
  data,
  isAdmin,
  dragging,
  dropZone,
  onEnterFolder,
  onPreviewFile,
  onDeleteFolder,
  onDeleteFile,
  onRenameFolder,
  onRenameFile,
  onDownloadFile,
  onDragStart,
  onDragEnd,
  onRowDragOver,
  onRowDragLeave,
  onRowDrop,
}) {
  const total = (data?.folders?.length || 0) + (data?.files?.length || 0);
  if (total === 0) {
    return <div className="py-16 text-center text-slate-500 text-sm">此文件夹为空</div>;
  }
  const actionWidthClass = isAdmin ? 'w-28' : 'w-16';
  return (
    <ul className="divide-y divide-white/10">
      <li className="rb-table-heading hidden sm:flex items-center px-4 py-2 text-xs text-slate-400 bg-white/5">
        <span className="flex-1">名称</span>
        <span className="w-24 text-right">大小</span>
        <span className="w-40 text-right">修改时间</span>
        <span className={`${actionWidthClass} text-right`}>操作</span>
      </li>
      {data.folders.map((f) => (
        <Row
          key={`d-${f.id}`}
          item={{ ...f, type: 'folder' }}
          isAdmin={isAdmin}
          dragging={dragging}
          dropZone={dropZone}
          actionWidthClass={actionWidthClass}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onRowDragOver={onRowDragOver}
          onRowDragLeave={onRowDragLeave}
          onRowDrop={onRowDrop}
          onClick={() => onEnterFolder(f)}
          actions={
            isAdmin && (
              <>
                <button
                  type="button"
                  onClick={() => onRenameFolder(f)}
                  className="p-1 rounded hover:bg-brand-500/20"
                  title="重命名"
                >
                  <BsPen className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteFolder(f)}
                  className="p-1 rounded hover:bg-red-500/20"
                  title="删除"
                >
                  <BsTrash className="w-4 h-4" />
                </button>
              </>
            )
          }
        />
      ))}
      {data.files.map((f) => (
        <Row
          key={`f-${f.id}`}
          item={{ ...f, type: 'file' }}
          isAdmin={isAdmin}
          dragging={dragging}
          dropZone={dropZone}
          actionWidthClass={actionWidthClass}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onRowDragOver={onRowDragOver}
          onRowDragLeave={onRowDragLeave}
          onRowDrop={onRowDrop}
          onClick={() => onPreviewFile(f)}
          actions={
            <>
              <button
                type="button"
                onClick={() => onDownloadFile(f)}
                className="p-1 rounded hover:bg-brand-500/20"
                title="下载"
              >
                <BsDownload className="w-4 h-4" />
              </button>
              {isAdmin && (
                <>
                  <button
                    type="button"
                    onClick={() => onRenameFile(f)}
                    className="p-1 rounded hover:bg-brand-500/20"
                    title="重命名"
                  >
                    <BsPen className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteFile(f)}
                    className="p-1 rounded hover:bg-red-500/20"
                    title="删除"
                  >
                    <BsTrash className="w-4 h-4" />
                  </button>
                </>
              )}
            </>
          }
        />
      ))}
    </ul>
  );
}

function Row({
  item,
  isAdmin,
  dragging,
  dropZone,
  actionWidthClass,
  onDragStart,
  onDragEnd,
  onRowDragOver,
  onRowDragLeave,
  onRowDrop,
  onClick,
  actions,
}) {
  const isSelf = dragging?.type === item.type && dragging.id === item.id;
  const targetMatch =
    dropZone && dropZone.mode !== 'crumb' && dropZone.targetType === item.type && dropZone.id === item.id;
  const isInto = targetMatch && dropZone.mode === 'into';
  const isBefore = targetMatch && dropZone.mode === 'before';
  const isAfter = targetMatch && dropZone.mode === 'after';

  return (
    <li
      draggable={isAdmin}
      onDragStart={(e) => onDragStart(e, { type: item.type, id: item.id, name: item.name })}
      onDragEnd={onDragEnd}
      onDragOver={(e) => onRowDragOver(e, { type: item.type, id: item.id })}
      onDragLeave={() => onRowDragLeave({ type: item.type, id: item.id })}
      onDrop={(e) => onRowDrop(e, { type: item.type, id: item.id })}
      className={`relative flex items-center gap-2 px-3 sm:px-4 py-3 sm:py-2.5 cursor-pointer transition-colors ${
        isInto ? 'bg-white/20 ring-1 ring-inset ring-brand-400' : ''
      } ${isBefore ? 'shadow-[inset_0_2px_0_0] shadow-brand-500' : ''} ${
        isAfter ? 'shadow-[inset_0_-2px_0_0] shadow-brand-500' : ''
      } ${!targetMatch && isSelf ? 'opacity-40' : ''} ${
        !targetMatch && !isSelf ? 'hover:bg-white/10 hover:ring-1 hover:ring-inset hover:ring-white/20' : ''
      }`}
      onClick={onClick}
    >
      {isAdmin && (
        <BsGripVertical className="w-4 h-4 -ml-1 sm:mr-1 sm:-ml-2 shrink-0 cursor-grab" />
      )}
      <span className="flex-1 flex items-center gap-2 min-w-0">
        <FileIcon type={item.type} ext={item.ext} />
        <span className="min-w-0 truncate">{item.name}</span>
      </span>
      <span className="hidden sm:inline w-24 text-right text-xs text-slate-400">
        {item.type === 'file' ? formatSize(item.size) : '-'}
      </span>
      <span className="hidden sm:inline w-40 text-right text-xs text-slate-400">
        {formatDate(item.created_at)}
      </span>
      <span
        className={`flex ${isAdmin ? 'w-24 sm:w-28' : 'w-9 sm:w-16'} shrink-0 justify-end gap-1`}
        onClick={(e) => e.stopPropagation()}
      >
        {actions}
      </span>
    </li>
  );
}
