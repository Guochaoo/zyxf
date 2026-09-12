// 浏览页容器（IMPROVE-01）：只做编排——路由参数、数据/同步/拖拽三个 hook 的接线、
// 管理操作与页面级弹窗。展示件在 ./Browse/ 下，数据请求在 ./Browse/use*.js 里。
// 传给 ItemList 的处理器一律 useCallback（IMPROVE-54）：行组件 memo 依赖
// 处理器身份稳定，每次渲染换新闭包会让列表行全部跟着重渲染。
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Loader2, RotateCw } from 'lucide-react';
import { BsCloudArrowUp, BsFolderPlus } from 'react-icons/bs';
import {
  createFolder,
  deleteFile,
  deleteFolder,
  getFileUrl,
  renameFile,
  renameFolder,
} from '../api.js';
import { useAuth } from '../auth.jsx';
import Preview from '../components/Preview/index.jsx';
import UploadDialog from '../components/UploadDialog.jsx';
import Toast from '../components/Toast.jsx';
import { downloadAndAlert, errMsg, notifyFoldersChanged } from '../utils.js';
import { useFolderContents } from './Browse/useFolderContents.js';
import { useItemDragDrop } from './Browse/useItemDragDrop.js';
import { useOssSync } from './Browse/useOssSync.js';
import ItemList from './Browse/ItemList.jsx';
import RenameDialog from './Browse/RenameDialog.jsx';
import SortControl from './Browse/SortControl.jsx';
import { FloatingPill, ToolbarIconButton } from './Browse/primitives.jsx';

export default function BrowsePage() {
  const { id: idParam } = useParams();
  const folderId = Number(idParam) || 0;
  const navigate = useNavigate();
  const location = useLocation();
  const { isAdmin } = useAuth();
  const { t } = useTranslation();

  const { data, loading, err, sort, order, setSort, refresh, toggleSort } =
    useFolderContents(folderId);
  const { syncing, syncNotice, clearSyncNotice, onSyncRefresh } = useOssSync(refresh);
  const {
    dragging,
    dropZone,
    moveError,
    onDragStart,
    onDragEnd,
    onRowDragOver,
    onRowDragLeave,
    onRowDrop,
  } = useItemDragDrop({ data, folderId, sort, isAdmin, setSort, refresh });

  const [previewing, setPreviewing] = useState(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);

  // Go up one level: current folder's parent (root when at top).
  const onGoBack = useCallback(() => {
    const parentId = data?.folder?.parent_id;
    navigate(parentId ? `/folder/${parentId}` : '/');
  }, [data, navigate]);

  // 深链预览：搜索/知识图谱跳转时带 previewFile，等列表数据到位后再打开预览。
  useEffect(() => {
    const previewFile = location.state?.previewFile;
    if (!previewFile || loading || !data) return;
    setPreviewing(previewFile);
    navigate(location.pathname, { replace: true, state: null });
  }, [data, loading, location.pathname, location.state, navigate]);

  // 管理操作共享骨架：await 动作 → 通知目录树 + 刷新；失败 alert 兜底。
  // notify=false 用于不影响目录树的操作（如删除文件）。
  const runAdmin = useCallback(
    async (fn, failMsg, notify = true) => {
      try {
        await fn();
        if (notify) notifyFoldersChanged();
        refresh();
      } catch (e) {
        alert(errMsg(e, failMsg));
      }
    },
    [refresh]
  );

  const onCreateFolder = useCallback(() => {
    const name = window.prompt(t('browse.newFolderName'));
    if (!name) return;
    runAdmin(() => createFolder(name, folderId || null), t('browse.createError'));
  }, [folderId, runAdmin, t]);

  const onDeleteFolder = useCallback(
    (f) => {
      if (!confirm(t('browse.confirmDeleteFolder', { name: f.name }))) return;
      runAdmin(() => deleteFolder(f.id), t('browse.deleteError'));
    },
    [runAdmin, t]
  );

  const onDeleteFile = useCallback(
    (f) => {
      if (!confirm(t('browse.confirmDeleteFile', { name: f.name }))) return;
      runAdmin(() => deleteFile(f.id), t('browse.deleteError'), false);
    },
    [runAdmin, t]
  );

  const openRenameDialog = useCallback((item) => {
    setRenameTarget(item);
    setRenameValue(item.name);
  }, []);

  const onRenameFolder = useCallback(
    (f) => openRenameDialog({ ...f, type: 'folder' }),
    [openRenameDialog]
  );

  const onRenameFile = useCallback(
    (f) => openRenameDialog({ ...f, type: 'file' }),
    [openRenameDialog]
  );

  const onDownloadFile = useCallback((f) => downloadAndAlert(f, getFileUrl), []);

  const onEnterFolder = useCallback((f) => navigate(`/folder/${f.id}`), [navigate]);

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
            ? t('browse.dragSortHint')
            : t('browse.dragMoveHint')}
        </FloatingPill>
      )}
      {moveError && (
        <FloatingPill className="text-red bg-[#fef2f2] border border-[#fecaca]">{moveError}</FloatingPill>
      )}
      {/* 同步结果用顶部 Toast 通知卡（与登录/注册页同一个自定义组件）；
          key 绑定通知 id，保证连续两次结果文本相同时也会重新计时。
          主行给短标题、副行给明细，避免长文案被单行省略号截断。 */}
      {syncNotice && (
        <Toast
          key={syncNotice.id}
          type={syncNotice.ok ? 'success' : 'error'}
          message={syncNotice.message}
          sub={syncNotice.sub}
          onClose={clearSyncNotice}
        />
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
          <ItemList
            data={data}
            isAdmin={isAdmin}
            dragging={dragging}
            dropZone={dropZone}
            onEnterFolder={onEnterFolder}
            onPreviewFile={setPreviewing}
            onDeleteFolder={onDeleteFolder}
            onDeleteFile={onDeleteFile}
            onRenameFolder={onRenameFolder}
            onRenameFile={onRenameFile}
            onDownloadFile={onDownloadFile}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onRowDragOver={onRowDragOver}
            onRowDragLeave={onRowDragLeave}
            onRowDrop={onRowDrop}
          />
        )}
      </div>

      {/* 页脚法务条：仅首页显示，文件夹页不展示。
          ICP 备案号跳工信部备案系统；字体署名是 OPPO Sans 授权的硬性要求
          （条件 1「prominent notice」+ 条件 4「随附协议原文」），链接指向仓库里
          保留的那份授权协议 public/licenses/。见 docs/ISSUES.md BUG-99。 */}
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
          <span aria-hidden="true"> · </span>
          <span>{t('footer.font')}</span>{' '}
          <a
            href="/licenses/OPPO-Sans-4.0-License.txt"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-slate-600"
          >
            OPPO Sans
          </a>
        </footer>
      )}

      <RenameDialog
        target={renameTarget}
        value={renameValue}
        onValueChange={setRenameValue}
        onSubmit={submitRenameDialog}
        onClose={closeRenameDialog}
        renaming={renaming}
      />

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
