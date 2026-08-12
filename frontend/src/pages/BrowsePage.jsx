import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import {
  BsCloudArrowUp,
  BsFolderPlus,
  BsGripVertical,
  BsSortAlphaDown,
  BsSortAlphaDownAlt,
} from 'react-icons/bs';
import { DownloadIcon, PenLineIcon, RotateCwIcon, TrashIcon, ArrowLeftIcon } from '../components/icons';
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
  syncOss,
} from '../api.js';
import { useAuth } from '../auth.jsx';
import FileIcon from '../components/FileIcon.jsx';
import Preview from '../components/Preview/index.jsx';
import UploadDialog from '../components/UploadDialog.jsx';
import { downloadFileById, errMsg, formatDate, formatSize } from '../utils.js';
import { useSlidingIndicator } from '../hooks/useSlidingIndicator.js';

// Default = admin-controlled manual order. Comes first.
const SORT_OPTIONS = [
  { key: 'manual', label: '默认' },
  { key: 'name', label: '名称' },
  { key: 'created_at', label: '时间' },
  { key: 'size', label: '大小' },
];

// Tell the sidebar FolderTree that folder structure changed (create/rename/
// move/delete/reorder) so it refetches.
function notifyFoldersChanged() {
  window.dispatchEvent(new Event('folders-changed'));
}

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

  // OSS sync state — the refresh button syncs the shared bucket into the local
  // DB (multi-deployment), then reloads the current folder.
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');
  const [syncMsgOk, setSyncMsgOk] = useState(true);
  const syncTimerRef = useRef(null);
  const showSyncMsg = (msg, ok = true) => {
    setSyncMsg(msg);
    setSyncMsgOk(ok);
    clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => setSyncMsg(''), 5000);
  };
  useEffect(() => () => clearTimeout(syncTimerRef.current), []);

  // Drag state. dragging mirrors to ref so DOM event handlers see fresh value
  // even before the next React render finishes.
  const [dragging, setDragging] = useState(null);
  const draggingRef = useRef(null);
  // dropZone shapes:
  //   { mode: 'into',  targetType: 'folder', id }   — drop INTO a folder (move)
  //   { mode: 'before'|'after', targetType, id }    — reorder relative to a row
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

  // Sync the shared OSS bucket into the local DB, then reload the folder.
  const onSyncRefresh = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const r = await syncOss();
      notifyFoldersChanged();
      const a = r.added || {};
      const rm = r.removed || {};
      if (a.files || a.folders || rm.files) {
        showSyncMsg(
          `同步完成：新增 ${a.folders || 0} 个文件夹 / ${a.files || 0} 个文件，清理 ${rm.files || 0} 个失效文件`
        );
      } else {
        showSyncMsg('已与远端同步，无变化');
      }
    } catch (e) {
      showSyncMsg(errMsg(e, '同步失败'), false);
    } finally {
      setSyncing(false);
      refresh();
    }
  };

  // Go up one level: current folder's parent (root when at top).
  const onGoBack = () => {
    const parentId = data?.folder?.parent_id;
    navigate(parentId ? `/folder/${parentId}` : '/');
  };

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
      notifyFoldersChanged();
      refresh();
    } catch (e) {
      alert(errMsg(e, '创建失败'));
    }
  };

  const onDeleteFolder = async (f) => {
    if (!confirm(`确认删除文件夹「${f.name}」及其所有内容？此操作不可恢复。`)) return;
    try {
      await deleteFolder(f.id);
      notifyFoldersChanged();
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
      notifyFoldersChanged();
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
        notifyFoldersChanged();
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
        notifyFoldersChanged();
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

  const onDownloadFile = async (f) => {
    try {
      await downloadFileById(f, getFileUrl);
    } catch (e) {
      alert(e.message || '下载失败');
    }
  };

  return (
    <div className="space-y-4">
      {/* Toolbar — sits above the file list */}
      <div className="flex w-full flex-wrap items-center justify-end gap-2">
        <SortControl sort={sort} order={order} onChange={toggleSort} />
        <button
          onClick={onSyncRefresh}
          className="p-0"
          title="刷新（同步远端资料库）"
        >
          <span className="rb-toolbar-btn w-[38.5px] p-0">
            <RotateCwIcon className={`w-6 h-6 ${syncing ? 'animate-spin' : ''}`} />
          </span>
        </button>
        {folderId !== 0 && (
          <button
            onClick={onGoBack}
            className="p-0"
            title="返回上一级"
          >
            <span className="rb-toolbar-btn w-[38.5px] p-0">
              <ArrowLeftIcon className="w-6 h-6" />
            </span>
          </button>
        )}
        {isAdmin && (
          <>
            <button
              onClick={onCreateFolder}
              className="rb-toolbar-btn"
            >
              <BsFolderPlus className="w-4 h-4" />
              新建文件夹
            </button>
            <button
              onClick={() => setUploadOpen(true)}
              className="rb-btn-dark h-[34px]"
            >
              <BsCloudArrowUp className="w-4 h-4" />
              上传
            </button>
          </>
        )}
      </div>

      {/* Floating banners — fixed so they don't disrupt drag layout */}
      {isAdmin && dragging && (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-6 z-40 pointer-events-none text-xs text-black/70 bg-black/5 border border-black/10 rounded-full shadow-md px-4 py-1.5">
          正在移动「{dragging.name}」
          {sort === 'manual'
            ? ' — 在行的上/下边缘可插入排序，拖到文件夹中部可移入'
            : ' — 拖到左侧目录中的文件夹'}
        </div>
      )}
      {moveError && (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-6 z-40 text-xs text-red-700 bg-red-50 border border-red-200 rounded-full shadow-md px-4 py-1.5">
          {moveError}
        </div>
      )}
      {syncMsg && (
        <div
          className={`fixed left-1/2 -translate-x-1/2 bottom-14 z-40 text-xs rounded-full shadow-md px-4 py-1.5 ${
            syncMsgOk
              ? 'text-black/70 bg-black/5 border border-black/10'
              : 'text-red-700 bg-red-50 border border-red-200'
          }`}
          role="status"
        >
          {syncMsg}
        </div>
      )}

      {/* Body: file list takes the full middle column width (the graph lives
          in the App right column on xl+, inline below the list otherwise). */}
        <div className="bg-white rb-card rounded-[14px] overflow-hidden">
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
            className="w-full max-w-sm rb-card rounded-lg bg-white p-4 text-slate-900"
          >
            <h2 className="text-base font-semibold">重命名</h2>
            <p className="mt-1 text-xs text-slate-400">
              {renameTarget.type === 'folder' ? '文件夹名称' : '文件名'}
            </p>
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              className="mt-4 w-full rounded-[6px] border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeRenameDialog}
                disabled={renaming}
                className="rb-btn-ghost h-[34px] px-3 text-sm disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={renaming}
                className="rename-dialog-save rb-btn-dark h-[34px] px-3 text-sm font-semibold disabled:opacity-50"
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

function SortControl({ sort, order, onChange }) {
  const listRef = useRef(null);
  const buttonRefs = useRef({});
  const indicator = useSlidingIndicator(listRef, buttonRefs, sort);

  return (
    <div className="rb-toolbar-btn max-w-full !px-0">
      <div ref={listRef} className="sort-scroll relative flex max-w-full items-center overflow-x-auto text-xs">
        <span
          className="pointer-events-none absolute inset-y-0 rounded-[14px] bg-white shadow-[inset_0_0_0_1px_rgba(23,23,23,0.1)]"
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
    </div>
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
      <li className="rb-table-heading hidden sm:flex items-center gap-2 px-4 py-2 text-xs text-slate-500 bg-[#EFEFEF]">
        {isAdmin && <span className="w-4 h-4 -ml-1 sm:mr-1 sm:-ml-2 shrink-0" />}
        <span className="flex-1 flex items-center gap-2 min-w-0">
          <span className="w-5 h-5 shrink-0" />
          <span>名称</span>
        </span>
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
                  className="p-1 rounded hover:bg-black/5"
                  title="重命名"
                >
                  <PenLineIcon className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteFolder(f)}
                  className="p-1 rounded hover:bg-black/5"
                  title="删除"
                >
                  <TrashIcon className="w-4 h-4" />
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
                className="p-1 rounded hover:bg-black/5"
                title="下载"
              >
                <DownloadIcon className="w-4 h-4" />
              </button>
              {isAdmin && (
                <>
                  <button
                    type="button"
                    onClick={() => onRenameFile(f)}
                    className="p-1 rounded hover:bg-black/5"
                    title="重命名"
                  >
                    <PenLineIcon className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteFile(f)}
                    className="p-1 rounded hover:bg-black/5"
                    title="删除"
                  >
                    <TrashIcon className="w-4 h-4" />
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
    dropZone && dropZone.targetType === item.type && dropZone.id === item.id;
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
        isInto ? 'bg-black/5 ring-1 ring-inset ring-black/10' : ''
      } ${
        isBefore ? 'shadow-[inset_0_2px_0_0_rgba(0,0,0,0.6)]' : ''
      } ${
        isAfter ? 'shadow-[inset_0_-2px_0_0_rgba(0,0,0,0.6)]' : ''
      } ${!targetMatch && isSelf ? 'opacity-40' : ''} ${
        !targetMatch && !isSelf ? 'hover:bg-slate-50' : ''
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
        {formatSize(item.size)}
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
