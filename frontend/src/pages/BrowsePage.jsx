import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowDown01,
  ArrowDown10,
  ArrowDownAZ,
  ArrowDownZA,
  ArrowLeft,
  CalendarArrowDown,
  CalendarArrowUp,
  Download,
  Loader2,
  PenLine,
  RotateCw,
  Trash,
} from 'lucide-react';
import {
  BsCloudArrowUp,
  BsFolderPlus,
  BsGripVertical,
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
  syncOss,
} from '../api.js';
import { useAuth } from '../auth.jsx';
import FileIcon from '../components/FileIcon.jsx';
import Preview from '../components/Preview/index.jsx';
import UploadDialog from '../components/UploadDialog.jsx';
import GlideList from '../components/GlideList.jsx';
import { downloadAndAlert, errMsg, formatDate, formatSize } from '../utils.js';
import { useSlidingIndicator } from '../hooks/useSlidingIndicator.js';
import { EASE_COLLAPSE } from '../components/ui.js';

// Direction arrow per sort key ('manual' has none).
const SORT_ARROWS = {
  name: { asc: ArrowDownAZ, desc: ArrowDownZA },
  created_at: { asc: CalendarArrowDown, desc: CalendarArrowUp },
  size: { asc: ArrowDown01, desc: ArrowDown10 },
};

// Tell the sidebar FolderTree that folder structure changed (create/rename/
// move/delete/reorder) so it refetches.
function notifyFoldersChanged() {
  window.dispatchEvent(new Event('folders-changed'));
}

// 工具栏图标按钮：外层裸 button + 内层 rb-toolbar-btn 固定宽度槽位。
function ToolbarIconButton({ title, onClick, children }) {
  return (
    <button onClick={onClick} className="p-0" title={title}>
      <span className="rb-toolbar-btn w-[38.5px] p-0">{children}</span>
    </button>
  );
}

// 底部悬浮胶囊横幅（拖拽提示/移动错误/同步结果共用骨架）。
function FloatingPill({ className = '', bottom = 'bottom-6', role, children }) {
  return (
    <div
      className={`fixed left-1/2 -translate-x-1/2 ${bottom} z-40 text-xs rounded-full shadow-md px-4 py-1.5 ${className}`}
      role={role}
    >
      {children}
    </div>
  );
}

export default function BrowsePage() {
  const { id: idParam } = useParams();
  const folderId = Number(idParam) || 0;
  const navigate = useNavigate();
  const location = useLocation();
  const { isAdmin } = useAuth();
  const { t } = useTranslation();

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
      .catch((e) => setErr(errMsg(e, t('browse.moveError'))))
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
          t('browse.syncDone', {
            folders: a.folders || 0,
            files: a.files || 0,
            removed: rm.files || 0,
          })
        );
      } else {
        showSyncMsg(t('browse.syncDone', { folders: 0, files: 0, removed: 0 }));
      }
    } catch (e) {
      showSyncMsg(errMsg(e, t('browse.moveError')), false);
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

  // 管理操作共享骨架：await 动作 → 通知目录树 + 刷新；失败 alert 兜底。
  // notify=false 用于不影响目录树的操作（如删除文件）。
  const runAdmin = async (fn, failMsg, notify = true) => {
    try {
      await fn();
      if (notify) notifyFoldersChanged();
      refresh();
    } catch (e) {
      alert(errMsg(e, failMsg));
    }
  };

  const onCreateFolder = () => {
    const name = window.prompt(t('browse.newFolderName'));
    if (!name) return;
    runAdmin(() => createFolder(name, folderId || null), t('browse.moveError'));
  };

  const onDeleteFolder = (f) => {
    if (!confirm(t('browse.confirmDeleteFolder', { name: f.name }))) return;
    runAdmin(() => deleteFolder(f.id), t('browse.deleteError'));
  };

  const onDeleteFile = (f) => {
    if (!confirm(t('browse.confirmDeleteFile', { name: f.name }))) return;
    runAdmin(() => deleteFile(f.id), t('browse.deleteError'), false);
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
      alert(errMsg(err, t('browse.renameError')));
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
    // 顺序基准必须与渲染一致：manual 模式下用后端给的合并视图 items，
    // 否则拖拽结果会与显示顺序不符（BUG-27）。
    const all = (
      data.items ?? [
        ...data.folders.map((f) => ({ ...f, type: 'folder' })),
        ...data.files.map((f) => ({ ...f, type: 'file' })),
      ]
    ).map((it) => ({ type: it.type, id: it.id }));
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
      setMoveError(errMsg(err, t('browse.moveError')));
      setTimeout(() => setMoveError(''), 4000);
    }
  };

  const onDownloadFile = (f) => downloadAndAlert(f, getFileUrl);

  return (
    <div className="space-y-4">
      {/* Toolbar — sits above the file list */}
      <div className="flex w-full flex-wrap items-center justify-end gap-2">
        <SortControl sort={sort} order={order} onChange={toggleSort} />
        <ToolbarIconButton title={t('browse.refresh')} onClick={onSyncRefresh}>
          <RotateCw className={`w-6 h-6 ${syncing ? 'animate-spin' : ''}`} />
        </ToolbarIconButton>
        {folderId !== 0 && (
          <ToolbarIconButton title={t('browse.openFolder')} onClick={onGoBack}>
            <ArrowLeft className="w-6 h-6" />
          </ToolbarIconButton>
        )}
        {isAdmin && (
          <>
            <button
              onClick={onCreateFolder}
              className="rb-toolbar-btn"
            >
              <BsFolderPlus className="w-4 h-4" />
              {t('browse.createFolder')}
            </button>
            <button
              onClick={() => setUploadOpen(true)}
              className="rb-btn-dark h-[34px]"
            >
              <BsCloudArrowUp className="w-4 h-4" />
              {t('browse.upload')}
            </button>
          </>
        )}
      </div>

      {/* Floating banners — fixed so they don't disrupt drag layout */}
      {isAdmin && dragging && (
        <FloatingPill className="pointer-events-none text-black/70 bg-black/5 border border-black/10">
          {t('browse.moving', { name: dragging.name })}
          {sort === 'manual'
            ? ' — 在行的上/下边缘可插入排序，拖到文件夹中部可移入'
            : ' — 拖到左侧目录中的文件夹'}
        </FloatingPill>
      )}
      {moveError && (
        <FloatingPill className="text-red bg-[#fef2f2] border border-[#fecaca]">{moveError}</FloatingPill>
      )}
      {syncMsg && (
        <FloatingPill
          bottom="bottom-14"
          role="status"
          className={
            syncMsgOk
              ? 'text-black/70 bg-black/5 border border-black/10'
              : 'text-red bg-[#fef2f2] border border-[#fecaca]'
          }
        >
          {syncMsg}
        </FloatingPill>
      )}

      {/* Body: file list takes the full middle column width. The knowledge
          graph renders in the App right column only on browse routes at the
          lg breakpoint (isBrowse && isLg); it is never inline below the list. */}
      <div className="bg-surface rounded-[14px] overflow-hidden">
        {loading ? (
          <div className="py-16 flex items-center justify-center text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin mr-2 text-slate-400" /> {t('common.loading')}
          </div>
        ) : err ? (
          <div className="py-16 text-center text-red">{err}</div>
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

      {/* ICP 备案号：仅首页显示，文件夹页不展示；点击跳转工信部备案系统 */}
      {folderId === 0 && (
        <footer className="-mt-3.5 text-center text-xs leading-normal text-slate-400">
          <a
            href="https://beian.miit.gov.cn"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-slate-600"
          >
            陕ICP备2026017448号
          </a>
        </footer>
      )}

      {renameTarget && (
        <div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/35 px-4">
          <form
            onSubmit={submitRenameDialog}
            className="w-full max-w-sm rb-card rounded-lg bg-white p-4 text-slate-900"
          >
            <h2 className="text-base font-semibold">{t('browse.rename')}</h2>
            <p className="mt-1 text-xs text-slate-400">
              {renameTarget.type === 'folder'
                ? t('browse.foldersLabel')
                : t('browse.filesLabel')}
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
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                disabled={renaming}
                className="rename-dialog-save rb-btn-dark h-[34px] px-3 text-sm font-semibold disabled:opacity-50"
              >
                {renaming ? t('common.loading') : t('common.save')}
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
  const { t } = useTranslation();
  // Default = admin-controlled manual order. Comes first.
  const sortOptions = useMemo(
    () => [
      { key: 'manual', label: t('browse.defaultSort') },
      { key: 'name', label: t('browse.name') },
      { key: 'created_at', label: t('browse.time') },
      { key: 'size', label: t('browse.size') },
    ],
    [t]
  );

  return (
    <div className="rb-toolbar-btn max-w-full !px-0">
      <div ref={listRef} className="sort-scroll relative flex max-w-full items-center overflow-x-auto text-xs">
        <span
          className="pointer-events-none absolute inset-y-0 rounded-[14px] bg-surface shadow-[inset_0_0_0_1px_var(--line-strong)]"
          style={{
            width: indicator.width,
            transform: `translateX(${indicator.left}px)`,
            opacity: indicator.ready ? 1 : 0,
            transition: `transform 360ms ${EASE_COLLAPSE}, width 360ms ${EASE_COLLAPSE}, opacity 160ms ease`,
          }}
        />
        {sortOptions.map((opt) => {
          const active = sort === opt.key;
          const ArrowIcon = SORT_ARROWS[opt.key]?.[order];
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
                {ArrowIcon && (
                  <ArrowIcon
                    className={`w-3.5 h-3.5 transition-opacity ${
                      active && opt.key !== 'manual' ? 'opacity-100' : 'opacity-0'
                    }`}
                  />
                )}
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
  const { t } = useTranslation();
  // data.items 存在（manual 模式）时它就是完整列表；否则 folders + files。
  const total = data?.items?.length ?? ((data?.folders?.length || 0) + (data?.files?.length || 0));
  if (total === 0) {
    return <div className="py-16 text-center text-slate-500 text-sm">{t('browse.empty')}</div>;
  }
  const actionWidthClass = isAdmin ? 'w-28' : 'w-16';
  // 按当前列表实际大小数量等分成 6 段，得到 5 个分位阈值
  const thresholds = useMemo(
    () =>
      sizeThresholds(
        [...(data?.folders || []), ...(data?.files || [])]
          .map((x) => x.size)
          .filter((n) => Number.isFinite(n))
      ),
    [data]
  );
  // 手动排序下后端返回合并视图 items（文件夹与文件共享 sort_order 序列），
  // 直接按它渲染才能保持拖拽出的交错顺序（BUG-27）；其余排序模式后端给不出
  // 交错语义，仍按「文件夹在前、文件在后」渲染。
  const ordered = data?.items ?? [
    ...(data?.folders || []).map((f) => ({ ...f, type: 'folder' })),
    ...(data?.files || []).map((f) => ({ ...f, type: 'file' })),
  ];

  // 两类的行内结构一致，仅点击目标与操作按钮不同——统一构造避免重复。
  const rows = ordered.map((item) => {
    const isFolder = item.type === 'folder';
    return {
      key: `${isFolder ? 'd' : 'f'}-${item.id}`,
      item,
      onClick: isFolder ? () => onEnterFolder(item) : () => onPreviewFile(item),
      actions: isFolder ? (
        isAdmin && (
          <>
            <RowAction title={t('browse.rename')} onClick={() => onRenameFolder(item)}>
              <PenLine className="w-4 h-4" />
            </RowAction>
            <RowAction title={t('common.delete')} onClick={() => onDeleteFolder(item)}>
              <Trash className="w-4 h-4" />
            </RowAction>
          </>
        )
      ) : (
        <>
          <RowAction title={t('browse.download')} onClick={() => onDownloadFile(item)}>
            <Download className="w-4 h-4" />
          </RowAction>
          {isAdmin && (
            <>
              <RowAction title={t('browse.rename')} onClick={() => onRenameFile(item)}>
                <PenLine className="w-4 h-4" />
              </RowAction>
              <RowAction title={t('common.delete')} onClick={() => onDeleteFile(item)}>
                <Trash className="w-4 h-4" />
              </RowAction>
            </>
          )}
        </>
      ),
    };
  });
  return (
    <GlideList as="ul" highlightClassName="bg-hover">
      <li className="rb-table-heading hidden sm:flex items-center gap-2 px-4 py-2 text-xs text-slate-500 bg-field">
        {isAdmin && <span className="w-4 h-4 -ml-1 sm:mr-1 sm:-ml-2 shrink-0" />}
        <span className="flex-1 flex items-center gap-2 min-w-0">
          <span className="w-5 h-5 shrink-0" />
          <span>{t('browse.colName')}</span>
        </span>
        <span className="w-24 text-right">{t('browse.colSize')}</span>
        <span className="w-28 text-right">{t('browse.colModified')}</span>
        <span className={`${actionWidthClass} text-right`}>{t('browse.colAction')}</span>
      </li>
      {rows.map(({ key, item, onClick, actions }) => (
        <Row
          key={key}
          item={item}
          tone={toneFor(item.size, thresholds)}
          isAdmin={isAdmin}
          dragging={dragging}
          dropZone={dropZone}
          actionWidthClass={actionWidthClass}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onRowDragOver={onRowDragOver}
          onRowDragLeave={onRowDragLeave}
          onRowDrop={onRowDrop}
          onClick={onClick}
          actions={actions}
        />
      ))}
    </GlideList>
  );
}

function RowAction({ title, onClick, children }) {
  return (
    <button type="button" onClick={onClick} title={title} className="p-1 rounded hover:bg-black/5">
      {children}
    </button>
  );
}

// 大小配色：6 档（小→大）的 背景/字体 色对
const SIZE_TONES = [
  { bg: '#DCF2E9', fg: '#3DAB7D' }, // 1 绿
  { bg: '#E0F1F7', fg: '#50A8C4' }, // 2 蓝
  { bg: '#EAE4FB', fg: '#896BD9' }, // 3 紫
  { bg: '#F6E1F8', fg: '#CF81DA' }, // 4 粉紫
  { bg: '#FCE1EA', fg: '#D982AB' }, // 5 粉（字体调深，浅粉底上更清晰）
  { bg: '#FBE0DE', fg: '#D2615A' }, // 6 红（字体调深，浅粉底上更清晰）
];

// 按当前列表实际大小数量等分成 6 段，返回 5 个分位阈值（单位：字节）
function sizeThresholds(sizes) {
  const sorted = [...sizes].sort((a, b) => a - b);
  if (sorted.length === 0) return [];
  const n = SIZE_TONES.length;
  const t = [];
  for (let i = 1; i < n; i += 1) {
    t.push(sorted[Math.min(sorted.length - 1, Math.floor((sorted.length * i) / n))]);
  }
  return t;
}

// 大小落在哪一档（0..5）；越过所有阈值则落在最大档
function toneFor(size, thresholds) {
  let i = 0;
  while (i < thresholds.length && size >= thresholds[i]) i += 1;
  return i;
}

// 大小标签徽章：按档位取对应配色并渲染格式化后的文件大小
function SizeChip(size, tone) {
  const c = SIZE_TONES[tone] ?? SIZE_TONES[0];
  return (
    <span className="records-tag" style={{ background: c.bg, color: c.fg, '--tag-base': c.fg }}>
      {formatSize(size)}
    </span>
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
  tone,
}) {
  const isSelf = dragging?.type === item.type && dragging.id === item.id;
  const targetMatch =
    dropZone && dropZone.targetType === item.type && dropZone.id === item.id;
  const isInto = targetMatch && dropZone.mode === 'into';
  const isBefore = targetMatch && dropZone.mode === 'before';
  const isAfter = targetMatch && dropZone.mode === 'after';

  return (
    <li
      data-glide-row
      draggable={isAdmin}
      onDragStart={(e) => onDragStart(e, { type: item.type, id: item.id, name: item.name })}
      onDragEnd={onDragEnd}
      onDragOver={(e) => onRowDragOver(e, { type: item.type, id: item.id })}
      onDragLeave={() => onRowDragLeave({ type: item.type, id: item.id })}
      onDrop={(e) => onRowDrop(e, { type: item.type, id: item.id })}
      className={`relative flex items-center gap-2 px-3 sm:px-4 py-3 sm:py-2.5 cursor-pointer transition-[background-color,transform] duration-150 active:scale-[0.98] ${
        isInto ? 'bg-black/5 ring-1 ring-inset ring-black/10' : ''
      } ${
        isBefore ? 'shadow-[inset_0_2px_0_0_rgba(0,0,0,0.6)]' : ''
      } ${
        isAfter ? 'shadow-[inset_0_-2px_0_0_rgba(0,0,0,0.6)]' : ''
      } ${!targetMatch && isSelf ? 'opacity-40' : ''}`}
      onClick={onClick}
    >
      {isAdmin && (
        <BsGripVertical className="w-4 h-4 -ml-1 sm:mr-1 sm:-ml-2 shrink-0 cursor-grab" />
      )}
      <span className="flex-1 flex items-center gap-2 min-w-0">
        <FileIcon type={item.type} ext={item.ext} />
        <span className="min-w-0 truncate">{item.name}</span>
      </span>
      <span className="hidden sm:flex w-24 justify-end">
        {SizeChip(item.size, tone)}
      </span>
      <span className="hidden sm:inline w-28 text-right text-xs text-slate-400">
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
