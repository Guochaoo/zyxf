import { Router } from 'express';
import { db, transaction } from '../db.js';
import { requireAdmin } from '../auth.js';
import { copyOssObject, deleteOssObjectIfExists, putEmptyOssObject } from '../oss.js';
import { nextSortOrder } from '../dbHelpers.js';
import { objectKeyForFile, parseOptionalFolderId, placeholderKeyForFolder } from '../storagePath.js';

const router = Router();

// Express 4 does NOT await/catch rejected promises returned by async handlers;
// an unhandled rejection would terminate the process (Node ≥ 15). Wrap every
// async handler so a rejection is forwarded to the error middleware as a 500.
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// Folder names are mapped to OSS object-segment keys (cleanObjectSegment);
// a '/' or '\' would be normalized to '-' and could collide with a literal
// 'a-b' name. Reject them at the entry points so keys stay unambiguous.
const containsPathSeparator = (name) => /[\/\\]/.test(name);

const SORT_FIELDS = {
  name: 'name COLLATE NOCASE',
  size: 'size',
  created_at: 'created_at',
  manual: 'sort_order',
};

// SQLite has no pinyin collation, so name sorting falls back to raw Unicode
// code points (上>传>体…). Re-sort by pinyin in JS when the user picks 名称,
// matching how Chinese apps order contacts. Tiebreak by id asc (like the SQL
// fallback) regardless of direction.
const nameCollator = new Intl.Collator('zh', { sensitivity: 'base' });
const startsWithCjk = (s) => /^[\u3400-\u9fff]/.test(s || '');
const sortByName = (rows, desc) =>
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

function getFolder(id) {
  if (id === 0 || id === '0' || id == null) return { id: 0, name: '首页', parent_id: null };
  return db.prepare('SELECT * FROM folders WHERE id = ?').get(id);
}

// A folder with the same name in the same parent, optionally excluding one id.
function findFolderInParent(name, parentId, excludeId = null) {
  const where = parentId === null ? 'parent_id IS NULL' : 'parent_id = ?';
  const args = parentId === null ? [] : [parentId];
  return db
    .prepare(
      `SELECT id FROM folders WHERE name = ? AND ${where}${excludeId ? ' AND id != ?' : ''}`
    )
    .get(name, ...args, ...(excludeId ? [excludeId] : []));
}

// Recursive total size of each given folder (sum of all descendant files).
function computeFolderSizes(folderIds) {
  if (!folderIds.length) return {};
  const placeholders = folderIds.map(() => '?').join(',');
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
    .all(...folderIds);
  const map = {};
  for (const r of rows) map[r.id] = r.size;
  return map;
}

// Collect every descendant folder id and its files using two flat queries
// (BUG-06: the old version ran one query per node = N+1). Contract: returns
// { folderIds, files } where each file row carries { id, folder_id, name, oss_key }.
function collectFolderTree(folderId) {
  // Query 1: all folders once, then group children by parent in memory.
  const allFolders = db.prepare('SELECT id, parent_id FROM folders').all();
  const childrenOf = new Map(); // parent_id -> [childId, ...]
  for (const f of allFolders) {
    if (f.parent_id == null) continue;
    if (!childrenOf.has(f.parent_id)) childrenOf.set(f.parent_id, []);
    childrenOf.get(f.parent_id).push(f.id);
  }

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
  const filesByFolder = new Map(); // folder_id -> [fileRow, ...]
  for (const f of db.prepare('SELECT id, folder_id, name, oss_key FROM files').all()) {
    const key = f.folder_id ?? null;
    if (!filesByFolder.has(key)) filesByFolder.set(key, []);
    filesByFolder.get(key).push(f);
  }

  const files = [];
  for (const fid of folderIds) {
    const list = filesByFolder.get(fid);
    if (list) files.push(...list);
  }
  return { folderIds, files };
}

// Run OSS object operations concurrently in small batches (each is an HTTP round trip).
async function batchOss(items, op, size = 10) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(op));
  }
}

// Rename or move a folder subtree: copy objects to their new keys, update the
// DB in one transaction, then delete the old objects. overrides tell
// objectKeyForFile / placeholderKeyForFolder how the top folder moved.
// Returns { conflict: true } when a target OSS path is already taken.
async function relocateFolderSubtree(folderId, { parentOverrides, nameOverrides, updateFolder }) {
  const { folderIds, files } = collectFolderTree(folderId);

  const fileMoves = files.map((file) => ({
    ...file,
    newKey: objectKeyForFile(db, file.folder_id, file.name, parentOverrides, nameOverrides),
  }));
  for (const move of fileMoves) {
    if (db.prepare('SELECT id FROM files WHERE oss_key = ? AND id != ?').get(move.newKey, move.id)) {
      return { conflict: true };
    }
  }

  const placeholderMoves = folderIds
    .map((fid) => ({
      oldKey: placeholderKeyForFolder(db, fid),
      newKey: placeholderKeyForFolder(db, fid, parentOverrides, nameOverrides),
    }))
    .filter((move) => move.oldKey && move.newKey);

  // Only objects whose key actually changes need copying / deleting.
  const filesToMove = fileMoves.filter((m) => m.oss_key !== m.newKey);
  const placeholdersToMove = placeholderMoves.filter((m) => m.oldKey !== m.newKey);

  // Copy first (both stores in sync), then update DB, then delete old objects.
  await batchOss(filesToMove, (m) => copyOssObject(m.oss_key, m.newKey));
  await batchOss(placeholdersToMove, (m) => putEmptyOssObject(m.newKey));

  const updateFile = db.prepare('UPDATE files SET oss_key = ? WHERE id = ?');
  const tx = transaction(() => {
    updateFolder();
    for (const move of fileMoves) updateFile.run(move.newKey, move.id);
  });
  tx();

  await batchOss(filesToMove, (m) => deleteOssObjectIfExists(m.oss_key));
  await batchOss(placeholdersToMove, (m) => deleteOssObjectIfExists(m.oldKey));
  return { ok: true };
}

function getBreadcrumb(id) {
  const crumbs = [{ id: 0, name: '首页' }];
  if (!id || id === 0) return crumbs;
  const chain = [];
  const seen = new Set();
  let cur = db.prepare('SELECT id, name, parent_id FROM folders WHERE id = ?').get(id);
  let depth = 0;
  const MAX_DEPTH = 50;
  while (cur) {
    chain.unshift({ id: cur.id, name: cur.name });
    if (!cur.parent_id) break;
    depth++;
    if (depth > MAX_DEPTH) break;
    if (seen.has(cur.parent_id)) break;
    seen.add(cur.parent_id);
    cur = db.prepare('SELECT id, name, parent_id FROM folders WHERE id = ?').get(cur.parent_id);
  }
  return crumbs.concat(chain);
}

// Full folder tree for the sidebar navigation (public).
// Each node: { id, name, children: [...], files: [...] } ordered by
// sort_order, then name. Root-level files are returned under `files`.
// BUG-06: loaded with two flat queries (one for folders, one for files), then
// grouped in memory — the old version ran a query per node (N+1).
router.get('/tree', (_req, res) => {
  const folders = db.prepare('SELECT id, name, parent_id, sort_order FROM folders').all();
  const files = db.prepare('SELECT id, name, ext, size, folder_id, sort_order FROM files').all();

  // Replicate SQL ORDER BY sort_order, name COLLATE NOCASE; id is a stable
  // tiebreak for rows equal on both (undefined order in the original SQL).
  const cellCompare = (a, b) => {
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    const an = String(a.name || '').toLowerCase();
    const bn = String(b.name || '').toLowerCase();
    if (an < bn) return -1;
    if (an > bn) return 1;
    return a.id - b.id;
  };
  const nodeFiles = (f) => ({ id: f.id, name: f.name, ext: f.ext, size: f.size, folder_id: f.folder_id });

  const childrenOf = new Map(); // parent_id (or null) -> child folders
  const filesOf = new Map(); // folder_id (or null) -> files
  for (const f of folders) {
    const key = f.parent_id ?? null;
    if (!childrenOf.has(key)) childrenOf.set(key, []);
    childrenOf.get(key).push(f);
  }
  for (const f of files) {
    const key = f.folder_id ?? null;
    if (!filesOf.has(key)) filesOf.set(key, []);
    filesOf.get(key).push(f);
  }

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
  res.json({ tree: build(null), files: rootFiles });
});

// List the contents (subfolders + files) of a folder. id=0 means root.
router.get('/:id/contents', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 0) return res.status(400).json({ error: '无效的文件夹 ID' });
  const folder = getFolder(id);
  if (!folder) return res.status(404).json({ error: '文件夹不存在' });

  const sort = SORT_FIELDS[req.query.sort] || SORT_FIELDS.name;
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
  const folders = db
    .prepare(
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
  const files = db
    .prepare(
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
  });
});

// Create folder
router.post('/', requireAdmin, wrap(async (req, res, next) => {
  const { name, parent_id } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: '名称不能为空' });
  const trimmed = name.trim();
  const pid = parseOptionalFolderId(parent_id);
  if (Number.isNaN(pid)) return res.status(400).json({ error: '无效的父级 ID' });
  if (pid !== null) {
    const parent = db.prepare('SELECT id FROM folders WHERE id = ?').get(pid);
    if (!parent) return res.status(400).json({ error: '父文件夹不存在' });
  }
  if (findFolderInParent(trimmed, pid)) {
    return res.status(409).json({ error: '同名文件夹已存在' });
  }
  if (containsPathSeparator(trimmed)) {
    return res.status(400).json({ error: '文件夹名不能包含斜杠' });
  }
  try {
    const so = nextSortOrder(db, 'folders', 'parent_id', pid);
    const info = db
      .prepare(
        'INSERT INTO folders (name, parent_id, sort_order, created_at) VALUES (?, ?, ?, ?)'
      )
      .run(trimmed, pid, so, Date.now());
    try {
      await putEmptyOssObject(placeholderKeyForFolder(db, info.lastInsertRowid));
    } catch (e) {
      db.prepare('DELETE FROM folders WHERE id = ?').run(info.lastInsertRowid);
      throw e;
    }
    res.json({ id: info.lastInsertRowid, name: trimmed, parent_id: pid });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return res.status(409).json({ error: '同名文件夹已存在' });
    }
    return next(e);
  }
}));

// Rename or move folder (parent_id = null means root)
router.patch('/:id', requireAdmin, wrap(async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: '无效的文件夹 ID' });
  const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(id);
  if (!folder) return res.status(404).json({ error: '资源不存在' });

  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'name')) {
    const newName = String(req.body?.name || '').trim();
    if (!newName) return res.status(400).json({ error: '名称不能为空' });
    if (newName === folder.name) return res.json({ ok: true, unchanged: true });
    if (containsPathSeparator(newName)) {
      return res.status(400).json({ error: '文件夹名不能包含斜杠' });
    }
    const parentId = folder.parent_id ?? null;
    if (findFolderInParent(newName, parentId, id)) {
      return res.status(409).json({ error: '同名文件夹已存在' });
    }

    try {
      const result = await relocateFolderSubtree(id, {
        nameOverrides: new Map([[id, newName]]),
        updateFolder: () =>
          db.prepare('UPDATE folders SET name = ? WHERE id = ?').run(newName, id),
      });
      if (result.conflict) return res.status(409).json({ error: '目标存储路径已存在同名文件' });
      return res.json({ ok: true, name: newName });
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) {
        return res.status(409).json({ error: '同名文件夹已存在' });
      }
      return next(e);
    }
  }

  const raw = req.body?.parent_id;
  const newParent = parseOptionalFolderId(raw);
  if (Number.isNaN(newParent)) return res.status(400).json({ error: '无效的父级 ID' });

  if (newParent === id) return res.status(400).json({ error: '不能移动到自己内部' });

  if (newParent !== null) {
    const exists = db.prepare('SELECT id FROM folders WHERE id = ?').get(newParent);
    if (!exists) return res.status(400).json({ error: '目标父文件夹不存在' });
    // Walk up from newParent; if we hit id, it's a descendant => cycle.
    let cur = newParent;
    const seen = new Set();
    while (cur != null && !seen.has(cur)) {
      if (cur === id) return res.status(400).json({ error: '不能移动到自身的子文件夹中' });
      seen.add(cur);
      const row = db.prepare('SELECT parent_id FROM folders WHERE id = ?').get(cur);
      cur = row?.parent_id ?? null;
    }
  }

  if (newParent === (folder.parent_id ?? null)) return res.json({ ok: true, unchanged: true });
  if (findFolderInParent(folder.name, newParent, id)) {
    return res.status(409).json({ error: '目标文件夹中已存在同名文件夹' });
  }

  try {
    const so = nextSortOrder(db, 'folders', 'parent_id', newParent);
    const result = await relocateFolderSubtree(id, {
      parentOverrides: new Map([[id, newParent]]),
      updateFolder: () =>
        db
          .prepare('UPDATE folders SET parent_id = ?, sort_order = ? WHERE id = ?')
          .run(newParent, so, id),
    });
    if (result.conflict) return res.status(409).json({ error: '目标存储路径已存在同名文件' });
    res.json({ ok: true });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return res.status(409).json({ error: '目标位置已存在同名文件夹' });
    }
    return next(e);
  }
}));

// Reorder items (folders + files) inside the same parent.
// Body: { parent_folder_id: number|null, order: [{type:'file'|'folder', id}, ...] }
router.post('/reorder', requireAdmin, (req, res) => {
  const { parent_folder_id, order } = req.body || {};
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order 必须是数组' });
  const pid = parseOptionalFolderId(parent_folder_id);
  if (Number.isNaN(pid)) return res.status(400).json({ error: '无效的父文件夹 ID' });

  // Entries without a known type and id are ignored by validation and update alike.
  const isReorderItem = (it) => !!it && (it.type === 'file' || it.type === 'folder') && !!it.id;

  // Validate every entry belongs to the claimed parent folder.
  const parentCol = { file: 'folder_id', folder: 'parent_id' };
  for (const it of order.filter(isReorderItem)) {
    const f = db.prepare(`SELECT ${parentCol[it.type]} p FROM ${it.type}s WHERE id = ?`).get(Number(it.id));
    if (!f) return res.status(400).json({ error: `${it.type} ${it.id} not found` });
    if ((f.p ?? null) !== pid) {
      return res.status(400).json({ error: `${it.type} ${it.id} does not belong to this parent` });
    }
  }

  // We separate sort_order between folders and files so the front-end can mix them in one list.
  // Backend uses interleaved indexes for both, which is fine because UI orders by sort_order globally
  // among each type, and we want the user-visible ordering to match the array.
  const updateStmt = {
    file: db.prepare('UPDATE files SET sort_order = ? WHERE id = ?'),
    folder: db.prepare('UPDATE folders SET sort_order = ? WHERE id = ?'),
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
router.delete('/:id', requireAdmin, wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: '无效的 ID' });
  // Gather all descendant keys to clean up OSS objects.
  const { folderIds, files } = collectFolderTree(id);
  const keys = files.map((f) => f.oss_key);
  for (const fid of folderIds) {
    const placeholder = placeholderKeyForFolder(db, fid);
    if (placeholder) keys.push(placeholder);
  }

  // Delete OSS objects before removing database rows so the two stores stay in sync.
  try {
    await batchOss(keys, (k) => deleteOssObjectIfExists(k));
  } catch (e) {
    console.warn('OSS 删除失败', e.message);
    return res.status(502).json({ error: 'OSS 删除失败' });
  }

  db.prepare('DELETE FROM folders WHERE id = ?').run(id);
  res.json({ ok: true, removed_files: keys.length });
}));

export default router;
