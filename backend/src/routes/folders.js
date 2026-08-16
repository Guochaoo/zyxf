import { Router } from 'express';
import { db } from '../db.js';
import { requireAdmin } from '../auth.js';
import { copyOssObject, deleteOssObjectIfExists, putEmptyOssObject } from '../oss.js';
import { findByNameInParent, findOssKeyConflict, nextSortOrder } from '../dbHelpers.js';
import { objectKeyForFile, parseOptionalFolderId, placeholderKeyForFolder } from '../storagePath.js';

const router = Router();

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

// Every descendant folder id and its files (one query per node).
function collectFolderTree(folderId) {
  const folderIds = [];
  const files = [];
  const walk = (fid) => {
    folderIds.push(fid);
    files.push(
      ...db.prepare('SELECT id, folder_id, name, oss_key FROM files WHERE folder_id = ?').all(fid)
    );
    for (const sub of db.prepare('SELECT id FROM folders WHERE parent_id = ?').all(fid)) {
      walk(sub.id);
    }
  };
  walk(folderId);
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
    if (findOssKeyConflict(db, move.newKey, move.id)) return { conflict: true };
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
  const tx = db.transaction(() => {
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
router.get('/tree', (_req, res) => {
  const childrenStmt = db.prepare(
    'SELECT id, name FROM folders WHERE parent_id = ? ORDER BY sort_order, name COLLATE NOCASE'
  );
  const rootStmt = db.prepare(
    'SELECT id, name FROM folders WHERE parent_id IS NULL ORDER BY sort_order, name COLLATE NOCASE'
  );
  const filesStmt = db.prepare(
    'SELECT id, name, ext, size, folder_id FROM files WHERE folder_id = ? ORDER BY sort_order, name COLLATE NOCASE'
  );
  const rootFilesStmt = db.prepare(
    'SELECT id, name, ext, size, folder_id FROM files WHERE folder_id IS NULL ORDER BY sort_order, name COLLATE NOCASE'
  );
  const build = (parentId) => {
    const rows = parentId === null ? rootStmt.all() : childrenStmt.all(parentId);
    return rows.map((f) => ({
      id: f.id,
      name: f.name,
      children: build(f.id),
      files: filesStmt.all(f.id),
    }));
  };
  res.json({ tree: build(null), files: rootFilesStmt.all() });
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
router.post('/', requireAdmin, async (req, res) => {
  const { name, parent_id } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: '名称不能为空' });
  const trimmed = name.trim();
  const pid = parseOptionalFolderId(parent_id);
  if (Number.isNaN(pid)) return res.status(400).json({ error: '无效的父级 ID' });
  if (pid !== null) {
    const parent = db.prepare('SELECT id FROM folders WHERE id = ?').get(pid);
    if (!parent) return res.status(400).json({ error: '父文件夹不存在' });
  }
  if (findByNameInParent(db, 'folders', 'parent_id', trimmed, pid)) {
    return res.status(409).json({ error: '同名文件夹已存在' });
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
    throw e;
  }
});

// Move folder to a new parent (parent_id = null means root)
router.patch('/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: '无效的文件夹 ID' });
  const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(id);
  if (!folder) return res.status(404).json({ error: '资源不存在' });

  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'name')) {
    const newName = String(req.body?.name || '').trim();
    if (!newName) return res.status(400).json({ error: '名称不能为空' });
    if (newName === folder.name) return res.json({ ok: true, unchanged: true });
    const parentId = folder.parent_id ?? null;
    if (findByNameInParent(db, 'folders', 'parent_id', newName, parentId, id)) {
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
      throw e;
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
  if (findByNameInParent(db, 'folders', 'parent_id', folder.name, newParent, id)) {
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
    throw e;
  }
});

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
  for (const it of order.filter(isReorderItem)) {
    if (it.type === 'file') {
      const f = db.prepare('SELECT folder_id FROM files WHERE id = ?').get(Number(it.id));
      if (!f) return res.status(400).json({ error: `file ${it.id} not found` });
      if ((f.folder_id ?? null) !== pid) {
        return res.status(400).json({ error: `file ${it.id} does not belong to this parent` });
      }
    } else {
      const f = db.prepare('SELECT parent_id FROM folders WHERE id = ?').get(Number(it.id));
      if (!f) return res.status(400).json({ error: `folder ${it.id} not found` });
      if ((f.parent_id ?? null) !== pid) {
        return res.status(400).json({ error: `folder ${it.id} does not belong to this parent` });
      }
    }
  }

  // We separate sort_order between folders and files so the front-end can mix them in one list.
  // Backend uses interleaved indexes for both, which is fine because UI orders by sort_order globally
  // among each type, and we want the user-visible ordering to match the array.
  const updateFile = db.prepare('UPDATE files SET sort_order = ? WHERE id = ?');
  const updateFolder = db.prepare('UPDATE folders SET sort_order = ? WHERE id = ?');
  const tx = db.transaction(() => {
    for (let i = 0; i < order.length; i++) {
      const it = order[i];
      if (!isReorderItem(it)) continue;
      if (it.type === 'file') updateFile.run(i, Number(it.id));
      else updateFolder.run(i, Number(it.id));
    }
  });
  tx();
  res.json({ ok: true });
});

// Delete folder (cascade)
router.delete('/:id', requireAdmin, async (req, res) => {
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
});

export default router;
