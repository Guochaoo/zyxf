// 文件夹领域的业务逻辑（IMPROVE-53：从 routes/folders.js 抽出，行为不变）。
// 路由层只留参数解析、权限与 HTTP 状态映射；这里负责子树搬迁计划、递归大小
// 聚合、整树构建、面包屑等可独立测试的纯业务步骤。OSS 网络往返也在这层编排
// （copy → delete 的顺序约束见 applySubtreeObjectMove）。
import { db, prepareOnce, transaction } from '../db.js';
import {
  buildFolderIndex,
  findSibling,
  groupByKey,
  nextSortOrder,
} from '../dbHelpers.js';
import { copyOssObject, deleteOssObjectIfExists, putEmptyOssObject } from '../oss.js';
import { objectKeyForFileFromMap, placeholderKeyForFolder, placeholderKeyForFolderFromMap } from '../storagePath.js';
import { getCachedTree, setCachedTree } from '../treeCache.js';

// Folder names are mapped to OSS object-segment keys (cleanObjectSegment);
// a '/' or '\' would be normalized to '-' and could collide with a literal
// 'a-b' name. Reject them at the entry points so keys stay unambiguous.
export const containsPathSeparator = (name) => /[\/\\]/.test(name);

// 保留段名：sync 为跳过历史 IMM 影子副本，会把 `<prefix>/.preview/` 下的对象整体
// 过滤掉（见 oss.js listOssObjects）。若允许建同名文件夹，其文件永远不出现在同步
// 列表里，于是下一次 sync 会把它们判为「桶里已不存在」而删记录（对象还在，成孤儿）。
const RESERVED_FOLDER_NAMES = new Set(['.preview']);
export const isReservedFolderName = (name) =>
  RESERVED_FOLDER_NAMES.has(String(name || '').trim().toLowerCase());

// 重排请求的条目上限：order 直接来自 body（express.json 限 1mb，可达数万项），
// 校验与写库都是同步逐项执行的，不限长等于给了一个阻塞事件循环的入口。
export const MAX_REORDER_ITEMS = 2000;

// IMPROVE-17：一次改名/移动要逐个搬运子树里的 OSS 对象（copy + delete 各一轮网络往返，
// 并发固定 10）。超过该规模就拒绝，避免请求拖到 nginx 的 60 s 超时、并留下半途的孤儿对象。
// 需要更大规模时的正确做法是后台迁移任务（落库迁移状态 + sync 跳过未完成迁移的键）。
export const MAX_SUBTREE_MOVE_ITEMS = 200;

// SQLite has no pinyin collation, so name sorting falls back to raw Unicode
// code points (上>传>体…). Re-sort by pinyin in JS when the user picks 名称,
// matching how Chinese apps order contacts. Tiebreak by id asc (like the SQL
// fallback) regardless of direction.
const nameCollator = new Intl.Collator('zh', { sensitivity: 'base' });
const startsWithCjk = (s) => /^[\u3400-\u9fff]/.test(s || '');
// IMPROVE-02（就地豁免）：sortByName / cellCompare 都是**静态比较函数**，不含任何用户输入，
// 仓库用的是 SQLite（node:sqlite）而非 MongoDB，不存在 mongo-sort-injection 的注入面——
// 扫描对这两个函数的标记为误报。
export const sortByName = (rows, desc) =>
  rows.sort((a, b) => {
    // Non-CJK names (English / digits / symbols) come before any pinyin name,
    // independent of direction.
    const cjkA = startsWithCjk(a.name);
    const cjkB = startsWithCjk(b.name);
    if (cjkA !== cjkB) return cjkA ? 1 : -1;
    const c = nameCollator.compare(a.name, b.name);
    if (c !== 0) return desc ? -c : c;
    return a.id - b.id;
  });

export function getFolder(id) {
  if (id === 0 || id === '0' || id == null) return { id: 0, name: '首页', parent_id: null };
  return prepareOnce('SELECT * FROM folders WHERE id = ?').get(id);
}

// A folder with the same name in the same parent, optionally excluding one id.
export const findFolderInParent = (name, parentId, excludeId = null) =>
  findSibling(db, 'folders', { name, parentColumn: 'parent_id', parentId, excludeId });

// Recursive total size of each given folder (sum of all descendant files).
// BUG-08：按 500 个 root 分批，避免单层子项数超过 SQLite 的绑定参数上限（32766）而 500。
const FOLDER_SIZE_BATCH = 500;
export function computeFolderSizes(folderIds) {
  if (!folderIds.length) return {};
  const map = {};
  for (let i = 0; i < folderIds.length; i += FOLDER_SIZE_BATCH) {
    const chunk = folderIds.slice(i, i + FOLDER_SIZE_BATCH);
    const placeholders = chunk.map(() => '?').join(',');
    const rows = db
      .prepare(
        `WITH RECURSIVE sub(root_id, id) AS (
           SELECT id AS root_id, id FROM folders WHERE id IN (${placeholders})
           UNION ALL
           SELECT s.root_id, f.id FROM folders f JOIN sub s ON f.parent_id = s.id
         )
         SELECT s.root_id AS id, COALESCE(SUM(fl.size), 0) AS size
         FROM sub s
         LEFT JOIN files fl ON fl.folder_id = s.id
         GROUP BY s.root_id`
      )
      .all(...chunk);
    for (const r of rows) map[r.id] = r.size;
  }
  return map;
}

// Collect every descendant folder id and its files using two flat queries.
// BUG-06：原先每个节点查一次（N+1）。返回 { folderIds, files, folderMap }。
export function collectFolderTree(folderId) {
  // Query 1: all folders once, then group children by parent in memory.
  const { folderMap, childrenOf } = buildFolderIndex(
    prepareOnce('SELECT id, name, parent_id FROM folders').all()
  );

  // DFS pre-order from the root folder, preserving the original walk order.
  const folderIds = [];
  const stack = [folderId];
  while (stack.length) {
    const fid = stack.pop();
    folderIds.push(fid);
    const children = childrenOf.get(fid);
    if (children) for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
  }

  // Query 2: all files once, grouped by folder_id for O(1) lookup.
  const filesByFolder = groupByKey(
    prepareOnce('SELECT id, folder_id, name, oss_key FROM files').all(),
    (f) => f.folder_id ?? null
  );

  const files = [];
  for (const fid of folderIds) {
    const list = filesByFolder.get(fid);
    if (list) files.push(...list);
  }
  return { folderIds, files, folderMap };
}

// Run OSS object operations concurrently in small batches (each is an HTTP round trip).
export async function batchOss(items, op, size = 10) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(op));
  }
}

// BUG-54：校验必须和 UPDATE 在同一个事务里（原先隔着 OSS 往返，并发 PATCH 能写出 parent 环）；
// 对象复制是网络往返，只能留在事务外，故拆成 applySubtreeObjectMove 的顺序。
// Returns { ok: true } when done.
export async function applySubtreeObjectMove(plan) {
  const { filesToMove, placeholdersToMove } = plan;
  // Copy first (both stores in sync), then delete the old objects.
  await batchOss(filesToMove, (m) => copyOssObject(m.oss_key, m.newKey));
  await batchOss(placeholdersToMove, (m) => putEmptyOssObject(m.newKey));

  await batchOss(filesToMove, (m) => deleteOssObjectIfExists(m.oss_key));
  await batchOss(placeholdersToMove, (m) => deleteOssObjectIfExists(m.oldKey));
  return { ok: true };
}

// 计算搬迁计划（不触网、不写库）：把子树里需要换 key 的文件与占位对象列出来。
// 与 DB 写入同在事务内执行，因此「目标键是否被别的文件占用」和「写库」是原子的。
export function planFolderSubtreeMove(folderId, { parentOverrides, nameOverrides } = {}) {
  const { folderIds, files, folderMap } = collectFolderTree(folderId);

  // IMPROVE-17：规模过大时不做逐对象搬运（见 MAX_SUBTREE_MOVE_ITEMS）。
  if (files.length + folderIds.length > MAX_SUBTREE_MOVE_ITEMS) {
    return { tooLarge: true, size: files.length + folderIds.length };
  }

  const fileMoves = files.map((file) => ({
    ...file,
    newKey: objectKeyForFileFromMap(file.folder_id, file.name, folderMap, parentOverrides, nameOverrides),
  }));
  // 循环外 prepare 一次复用：原实现对子树里每个文件都重新解析一次 SQL。
  const keyTakenByOther = prepareOnce('SELECT id FROM files WHERE oss_key = ? AND id != ?');
  for (const move of fileMoves) {
    if (keyTakenByOther.get(move.newKey, move.id)) {
      return { conflict: true };
    }
  }

  const placeholderMoves = folderIds
    .map((fid) => ({
      oldKey: placeholderKeyForFolderFromMap(fid, folderMap),
      newKey: placeholderKeyForFolderFromMap(fid, folderMap, parentOverrides, nameOverrides),
    }))
    .filter((move) => move.oldKey && move.newKey);

  // Only objects whose key actually changes need copying / deleting.
  return {
    conflict: false,
    folderIds,
    filesToMove: fileMoves.filter((m) => m.oss_key !== m.newKey),
    placeholdersToMove: placeholderMoves.filter((m) => m.oldKey !== m.newKey),
    fileMoves,
  };
}

// 事务内执行：计划 + 更新 files.oss_key + 调用方给的文件夹 UPDATE。
// 返回 { conflict: true }（目标键已被占用）或 { tooLarge: true }（子树超过搬运阈值），
// 调用方据此回 409；两种情况都不会写库。
export function relocateFolderSubtree(folderId, { parentOverrides, nameOverrides, updateFolder } = {}) {
  const plan = planFolderSubtreeMove(folderId, { parentOverrides, nameOverrides });
  if (plan.conflict) return { conflict: true };
  if (plan.tooLarge) return { tooLarge: true, size: plan.size };

  const updateFile = prepareOnce('UPDATE files SET oss_key = ? WHERE id = ?');
  const tx = transaction(() => {
    updateFolder();
    for (const move of plan.fileMoves) updateFile.run(move.newKey, move.id);
  });
  tx();
  return { conflict: false, plan };
}

export function getBreadcrumb(id) {
  const crumbs = [{ id: 0, name: '首页' }];
  if (!id || id === 0) return crumbs;
  const chain = [];
  const seen = new Set();
  let cur = prepareOnce('SELECT id, name, parent_id FROM folders WHERE id = ?').get(id);
  let depth = 0;
  const MAX_DEPTH = 50;
  while (cur) {
    chain.unshift({ id: cur.id, name: cur.name });
    if (!cur.parent_id) break;
    depth++;
    if (depth > MAX_DEPTH) break;
    if (seen.has(cur.parent_id)) break;
    seen.add(cur.parent_id);
    cur = prepareOnce('SELECT id, name, parent_id FROM folders WHERE id = ?').get(cur.parent_id);
  }
  return crumbs.concat(chain);
}

// Full folder tree for the sidebar navigation (public). Each node:
// { id, name, children: [...], files: [...] } ordered by sort_order, then name.
// Root-level files are returned under `files`.
// BUG-06: loaded with two flat queries (one for folders, one for files), then
// grouped in memory — the old version ran a query per node (N+1).
// IMPROVE-15：整树重建按 30 s TTL 复用，写路径统一调 invalidateLibraryCaches()。
export function getFolderTreePayload() {
  const cached = getCachedTree();
  if (cached) return cached;

  const folders = prepareOnce('SELECT id, name, parent_id, sort_order FROM folders').all();
  const files = prepareOnce('SELECT id, name, ext, size, folder_id, sort_order FROM files').all();

  // Replicate SQL ORDER BY sort_order, name COLLATE NOCASE; id is a stable
  // tiebreak for rows equal on both (undefined order in the original SQL).
  // IMPROVE-02（就地豁免）：同 sortByName，静态比较器、无查询对象拼接 → 扫描标记为误报。
  const cellCompare = (a, b) => {
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    const an = String(a.name || '').toLowerCase();
    const bn = String(b.name || '').toLowerCase();
    if (an < bn) return -1;
    if (an > bn) return 1;
    return a.id - b.id;
  };
  const nodeFiles = (f) => ({ id: f.id, name: f.name, ext: f.ext, size: f.size, folder_id: f.folder_id });

  const childrenOf = groupByKey(folders, (f) => f.parent_id ?? null);
  const filesOf = groupByKey(files, (f) => f.folder_id ?? null);

  const build = (parentId) => {
    const rows = (childrenOf.get(parentId) || []).slice().sort(cellCompare);
    return rows.map((f) => ({
      id: f.id,
      name: f.name,
      children: build(f.id),
      files: (filesOf.get(f.id) || []).slice().sort(cellCompare).map(nodeFiles),
    }));
  };

  const rootFiles = (filesOf.get(null) || []).slice().sort(cellCompare).map(nodeFiles);
  const payload = { tree: build(null), files: rootFiles };
  setCachedTree(payload);
  return payload;
}

// 事务内的校验失败用这两个错误类型区分「重名（409）」与「目标非法（400）」，
// 避免把 400 类问题也算成 409。
export class UniqueFolderNameError extends Error {}
export class MoveTargetError extends Error {}

// 新建文件夹的落库 + OSS 占位对象；占位失败回滚行。OSS 归属判断与 key 规则
// 都在 storagePath，这里只编排顺序。
export async function createFolderRow(name, parentId) {
  const so = nextSortOrder(db, 'folders', 'parent_id', parentId);
  const info = prepareOnce(
    'INSERT INTO folders (name, parent_id, sort_order, created_at) VALUES (?, ?, ?, ?)'
  ).run(name, parentId, so, Date.now());
  try {
    await putEmptyOssObject(placeholderKeyForFolder(db, info.lastInsertRowid));
  } catch (e) {
    prepareOnce('DELETE FROM folders WHERE id = ?').run(info.lastInsertRowid);
    throw e;
  }
  return info.lastInsertRowid;
}
