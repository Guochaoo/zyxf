// 文件夹路由（IMPROVE-55 瘦身）：参数解析、权限、HTTP 状态映射。
// 业务逻辑（子树搬迁、递归大小、整树构建、面包屑）在 services/folders.js。
import { Router } from 'express';
import { db, prepareOnce, transaction } from '../db.js';
import { requireAdmin } from '../auth.js';
import { deleteOssObjectIfExists } from '../oss.js';
import { folderExists, isUniqueError, nextSortOrder } from '../dbHelpers.js';
import { wrapAsync, serviceError } from '../http.js';
import { parseOptionalFolderId, placeholderKeyForFolderFromMap } from '../storagePath.js';
import { invalidateLibraryCaches } from '../libraryCaches.js';
import {
  MoveTargetError,
  UniqueFolderNameError,
  applySubtreeObjectMove,
  batchOss,
  collectFolderTree,
  computeFolderSizes,
  containsPathSeparator,
  createFolderRow,
  findFolderInParent,
  getBreadcrumb,
  getFolder,
  getFolderTreePayload,
  isReservedFolderName,
  MAX_REORDER_ITEMS,
  relocateFolderSubtree,
  sortByName,
} from '../services/folders.js';

const router = Router();

const SORT_FIELDS = {
  name: 'name COLLATE NOCASE',
  size: 'size',
  created_at: 'created_at',
  manual: 'sort_order',
};

// Full folder tree for the sidebar navigation (public).
router.get('/tree', (_req, res) => {
  res.json(getFolderTreePayload());
});

// List the contents (subfolders + files) of a folder. id=0 means root.
router.get('/:id/contents', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 0) return res.status(400).json({ error: '无效的文件夹 ID' });
  const folder = getFolder(id);
  if (!folder) return res.status(404).json({ error: '文件夹不存在' });

  // 白名单查询必须用 hasOwn：SORT_FIELDS 是对象字面量，`SORT_FIELDS['constructor']`
  // 会命中 Object.prototype 上的成员（真值），于是 `|| 默认值` 不生效，成员被当成
  // sort 表达式拼进 SQL 并抛 `near "Object": syntax error` → 500。
  const sortParam = String(req.query.sort || '');
  const sort = Object.hasOwn(SORT_FIELDS, sortParam) ? SORT_FIELDS[sortParam] : SORT_FIELDS.name;
  const order = req.query.order === 'desc' ? 'DESC' : 'ASC';

  const parentClause = id === 0 ? 'parent_id IS NULL' : 'parent_id = ?';
  const folderClause = id === 0 ? 'folder_id IS NULL' : 'folder_id = ?';
  const args = id === 0 ? [] : [id];

  const isNameSort = sort === SORT_FIELDS.name;
  const isSizeSort = sort === SORT_FIELDS.size;
  // Folders have no size column in SQL; fetch them by name, then re-sort by the
  // recursive size computed below.
  const folderSortKey = isSizeSort ? SORT_FIELDS.name : sort;
  // Manual mode: also include id as tiebreaker; non-manual: secondary by name then id
  const tieBreak =
    sort === SORT_FIELDS.manual ? `, id ${order}` : `, name COLLATE NOCASE ASC, id ASC`;
  const folders = prepareOnce(
      `SELECT id, name, sort_order, created_at FROM folders WHERE ${parentClause} ORDER BY ${folderSortKey} ${order}${tieBreak}`
    )
    .all(...args)
    .map((f) => ({ ...f, type: 'folder' }));
  if (isNameSort) sortByName(folders, order === 'DESC');

  // Attach recursive total size (sum of all descendant files) to each folder.
  const sizeMap = computeFolderSizes(folders.map((f) => f.id));
  for (const f of folders) f.size = sizeMap[f.id] || 0;

  // Re-sort by the computed recursive size so folders interleave correctly.
  if (isSizeSort) {
    folders.sort((a, b) => {
      const c = a.size - b.size;
      if (c !== 0) return order === 'DESC' ? -c : c;
      return a.name.localeCompare(b.name, 'zh');
    });
  }

  // oss_key is internal storage layout — not exposed to (anonymous) clients.
  const files = prepareOnce(
      `SELECT id, name, size, mime_type, ext, sort_order, created_at FROM files WHERE ${folderClause} ORDER BY ${sort} ${order}${tieBreak}`
    )
    .all(...args)
    .map((f) => ({ ...f, type: 'file' }));
  if (isNameSort) sortByName(files, order === 'DESC');

  res.json({
    folder: { id: folder.id, name: folder.name, parent_id: folder.parent_id ?? null },
    breadcrumb: getBreadcrumb(id),
    folders,
    files,
    // 手动排序下文件夹与文件共享同一 sort_order 序列，但 folders/files 是两个
    // 数组，前端无从还原用户拖拽出的交错顺序。额外给出合并视图（仅 manual 模式，
    // 其余模式由前端按各自规则重排），使刷新后与持久化顺序一致（BUG-27）。
    ...(sort === SORT_FIELDS.manual
      ? {
          items: [...folders, ...files].sort(
            (a, b) => a.sort_order - b.sort_order || a.id - b.id
          ),
        }
      : {}),
  });
});

// Create folder
router.post('/', requireAdmin, wrapAsync(async (req, res, next) => {
  const { name, parent_id } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: '名称不能为空' });
  const trimmed = name.trim();
  const pid = parseOptionalFolderId(parent_id);
  if (Number.isNaN(pid)) return res.status(400).json({ error: '无效的父级 ID' });
  if (pid !== null) {
    if (!folderExists(db, pid)) return res.status(400).json({ error: '父文件夹不存在' });
  }
  if (findFolderInParent(trimmed, pid)) {
    return res.status(409).json({ error: '同名文件夹已存在' });
  }
  if (containsPathSeparator(trimmed)) {
    return res.status(400).json({ error: '文件夹名不能包含斜杠' });
  }
  if (isReservedFolderName(trimmed)) {
    return res.status(400).json({ error: '.preview 是系统保留名称，请换一个' });
  }
  try {
    const newId = await createFolderRow(trimmed, pid);
    invalidateLibraryCaches();
    res.json({ id: newId, name: trimmed, parent_id: pid });
  } catch (e) {
    if (isUniqueError(e)) {
      return res.status(409).json({ error: '同名文件夹已存在' });
    }
    return next(e);
  }
}));

// Rename or move folder (parent_id = null means root)
router.patch('/:id', requireAdmin, wrapAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: '无效的文件夹 ID' });
  const folder = getFolder(id);
  if (!folder) return res.status(404).json({ error: '资源不存在' });

  const body = req.body || {};
  const hasName = Object.prototype.hasOwnProperty.call(body, 'name');
  const hasParent = Object.prototype.hasOwnProperty.call(body, 'parent_id');
  // BUG-86：空 body / 未知字段不得被当成「移动到根」。必须显式 400。
  if (!hasName && !hasParent) {
    return res.status(400).json({ error: '请求体必须包含 name 或 parent_id' });
  }

  if (hasName) {
    const newName = String(body.name || '').trim();
    if (!newName) return res.status(400).json({ error: '名称不能为空' });
    if (newName === folder.name) return res.json({ ok: true, unchanged: true });
    if (containsPathSeparator(newName)) {
      return res.status(400).json({ error: '文件夹名不能包含斜杠' });
    }
    if (isReservedFolderName(newName)) {
      return res.status(400).json({ error: '.preview 是系统保留名称，请换一个' });
    }
    const parentId = folder.parent_id ?? null;

    // BUG-54：重名检查与 UPDATE 必须同事务，否则并发改名能写出同父同名。
    let outcome;
    try {
      outcome = relocateFolderSubtree(id, {
        nameOverrides: new Map([[id, newName]]),
        updateFolder: () => {
          if (findFolderInParent(newName, parentId, id)) throw new UniqueFolderNameError();
          prepareOnce('UPDATE folders SET name = ? WHERE id = ?').run(newName, id);
        },
      });
    } catch (e) {
      if (e instanceof UniqueFolderNameError || isUniqueError(e)) {
        return res.status(409).json({ error: '同名文件夹已存在' });
      }
      throw e;
    }
    if (outcome.conflict) {
      return res.status(409).json({ error: '目标存储路径已存在同名文件' });
    }
    if (outcome.tooLarge) {
      return res.status(409).json({ error: `文件夹内条目过多（${outcome.size} 项），请分批移动/改名` });
    }
    await applySubtreeObjectMove(outcome.plan);
    invalidateLibraryCaches();
    return res.json({ ok: true, name: newName });
  }

  const raw = body.parent_id;
  const newParent = parseOptionalFolderId(raw);
  if (Number.isNaN(newParent)) return res.status(400).json({ error: '无效的父级 ID' });

  if (newParent === id) return res.status(400).json({ error: '不能移动到自己内部' });
  if (newParent === (folder.parent_id ?? null)) return res.json({ ok: true, unchanged: true });

  let outcome;
  try {
    outcome = relocateFolderSubtree(id, {
      parentOverrides: new Map([[id, newParent]]),
      updateFolder: () => {
        // BUG-54：事务内重做全部校验（事务外的前置检查只为尽早给出友好文案）。
        if (newParent !== null && !folderExists(db, newParent)) throw new MoveTargetError('目标父文件夹不存在');
        if (newParent !== null) {
          let cur = newParent;
          const seen = new Set();
          while (cur != null && !seen.has(cur)) {
            if (cur === id) throw new MoveTargetError('不能移动到自身的子文件夹中');
            seen.add(cur);
            cur = prepareOnce('SELECT parent_id FROM folders WHERE id = ?').get(cur)?.parent_id ?? null;
          }
        }
        if (findFolderInParent(folder.name, newParent, id)) throw new UniqueFolderNameError();
        const so = nextSortOrder(db, 'folders', 'parent_id', newParent);
        prepareOnce('UPDATE folders SET parent_id = ?, sort_order = ? WHERE id = ?').run(newParent, so, id);
      },
    });
  } catch (e) {
    if (e instanceof UniqueFolderNameError || isUniqueError(e)) {
      return res.status(409).json({ error: '目标位置已存在同名文件夹' });
    }
    if (e instanceof MoveTargetError) return res.status(400).json({ error: e.message });
    throw e;
  }
  if (outcome.conflict) {
    return res.status(409).json({ error: '目标存储路径已存在同名文件' });
  }
  if (outcome.tooLarge) {
    return res.status(409).json({ error: `文件夹内条目过多（${outcome.size} 项），请分批移动/改名` });
  }
  await applySubtreeObjectMove(outcome.plan);
  invalidateLibraryCaches();
  res.json({ ok: true });
}));

// Reorder items (folders + files) inside the same parent.
// Body: { parent_folder_id: number|null, order: [{type:'file'|'folder', id}, ...] }
router.post('/reorder', requireAdmin, (req, res) => {
  const { parent_folder_id, order } = req.body || {};
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order 必须是数组' });
  if (order.length > MAX_REORDER_ITEMS) {
    return res.status(400).json({ error: `order 过长（最多 ${MAX_REORDER_ITEMS} 项）` });
  }
  const pid = parseOptionalFolderId(parent_folder_id);
  if (Number.isNaN(pid)) return res.status(400).json({ error: '无效的父文件夹 ID' });

  // Entries without a known type and id are ignored by validation and update alike.
  const isReorderItem = (it) => !!it && (it.type === 'file' || it.type === 'folder') && !!it.id;

  // Validate every entry belongs to the claimed parent folder.
  // 两条语句在循环外 prepare 一次复用（原实现逐项重新解析 SQL）。
  const parentOf = {
    file: prepareOnce('SELECT folder_id p FROM files WHERE id = ?'),
    folder: prepareOnce('SELECT parent_id p FROM folders WHERE id = ?'),
  };
  for (const it of order.filter(isReorderItem)) {
    const f = parentOf[it.type].get(Number(it.id));
    if (!f) return res.status(400).json({ error: `${it.type} ${it.id} not found` });
    if ((f.p ?? null) !== pid) {
      return res.status(400).json({ error: `${it.type} ${it.id} does not belong to this parent` });
    }
  }

  // We separate sort_order between folders and files so the front-end can mix them in one list.
  // Backend uses interleaved indexes for both, which is fine because UI orders by sort_order globally
  // among each type, and we want the user-visible ordering to match the array.
  const updateStmt = {
    file: prepareOnce('UPDATE files SET sort_order = ? WHERE id = ?'),
    folder: prepareOnce('UPDATE folders SET sort_order = ? WHERE id = ?'),
  };
  const tx = transaction(() => {
    for (let i = 0; i < order.length; i++) {
      const it = order[i];
      if (!isReorderItem(it)) continue;
      updateStmt[it.type].run(i, Number(it.id));
    }
  });
  tx();
  res.json({ ok: true });
});

// Delete folder (cascade)
router.delete('/:id', requireAdmin, wrapAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: '无效的 ID' });
  // 存在性校验（与 PATCH 同口径）：不校验的话，对不存在的 id 会返回 200 且
  // removed_files 虚报，更糟的是 placeholderKeyForFolderFromMap 在 folderMap 里
  // 查不到该 id 时会退化成「只剩前缀」，等于用桶里的 `<prefix>/` 这个伪键去调真实删除。
  if (!getFolder(id)) return res.status(404).json({ error: '文件夹不存在' });
  // Gather all descendant keys to clean up OSS objects.
  const { folderIds, files, folderMap } = collectFolderTree(id);
  const keys = files.map((f) => f.oss_key);
  for (const fid of folderIds) {
    if (!folderMap.has(fid)) continue; // 只处理真实存在的文件夹，绝不伪造前缀根键
    const placeholder = placeholderKeyForFolderFromMap(fid, folderMap);
    if (placeholder) keys.push(placeholder);
  }

  // Delete OSS objects before removing database rows so the two stores stay in sync.
  try {
    await batchOss(keys, (k) => deleteOssObjectIfExists(k));
  } catch (e) {
    return serviceError(res, e, 'OSS 删除失败');
  }

  prepareOnce('DELETE FROM folders WHERE id = ?').run(id);
  invalidateLibraryCaches();
  res.json({ ok: true, removed_files: keys.length });
}));

export default router;
