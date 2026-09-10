// BrowsePage 的拖拽 hook（IMPROVE-01 拆分）。
// 两种落点：拖进文件夹 = 移动；manual 排序下拖到行的上/下半 = 重排。
// 排序切换与刷新由调用方注入（setSort / refresh），避免与数据 hook 相互耦合。
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { moveFile, moveFolder, reorderItems } from '../../api.js';
import { errMsg, notifyFoldersChanged } from '../../utils.js';

export function useItemDragDrop({ data, folderId, sort, isAdmin, setSort, refresh }) {
  const { t } = useTranslation();
  // Drag state. dragging mirrors to ref so DOM event handlers see fresh value
  // even before the next React render finishes.
  const [dragging, setDragging] = useState(null);
  const draggingRef = useRef(null);
  // dropZone shapes:
  //   { mode: 'into',  targetType: 'folder', id }   — drop INTO a folder (move)
  //   { mode: 'before'|'after', targetType, id }    — reorder relative to a row
  const [dropZone, setDropZone] = useState(null);
  const [moveError, setMoveError] = useState('');
  const moveErrorTimer = useRef(null);
  useEffect(() => () => clearTimeout(moveErrorTimer.current), []);

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
      clearTimeout(moveErrorTimer.current);
      moveErrorTimer.current = setTimeout(() => setMoveError(''), 4000);
    }
  };

  return {
    dragging,
    dropZone,
    moveError,
    onDragStart,
    onDragEnd,
    onRowDragOver,
    onRowDragLeave,
    onRowDrop,
  };
}
