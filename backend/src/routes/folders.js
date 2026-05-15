import { Router } from 'express';
import { db } from '../db.js';
import { requireAdmin } from '../auth.js';
import { copyOssObject, deleteOssObjectIfExists, putEmptyOssObject } from '../oss.js';
import { objectKeyForFile, placeholderKeyForFolder } from '../storagePath.js';

const router = Router();

const SORT_FIELDS = {
  name: 'name COLLATE NOCASE',
  size: 'size',
  created_at: 'created_at',
  manual: 'sort_order',
};

function nextSortOrder(table, column, parentId) {
  const sql =
    parentId === null
      ? `SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM ${table} WHERE ${column} IS NULL`
      : `SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM ${table} WHERE ${column} = ?`;
  const stmt = db.prepare(sql);
  const row = parentId === null ? stmt.get() : stmt.get(parentId);
  return row.n;
}
export { nextSortOrder };

function getFolder(id) {
  if (id === 0 || id === '0' || id == null) return { id: 0, name: '根目录', parent_id: null };
  return db.prepare('SELECT * FROM folders WHERE id = ?').get(id);
}

function getBreadcrumb(id) {
  const crumbs = [{ id: 0, name: '根目录' }];
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

// List the contents (subfolders + files) of a folder. id=0 means root.
router.get('/:id/contents', (req, res) => {
  const id = Number(req.params.id) || 0;
  const folder = getFolder(id);
  if (!folder) return res.status(404).json({ error: 'folder not found' });

  const sort = SORT_FIELDS[req.query.sort] || SORT_FIELDS.name;
  const order = req.query.order === 'desc' ? 'DESC' : 'ASC';

  const parentClause = id === 0 ? 'parent_id IS NULL' : 'parent_id = ?';
  const folderClause = id === 0 ? 'folder_id IS NULL' : 'folder_id = ?';
  const args = id === 0 ? [] : [id];

  const folderSortKey = sort === SORT_FIELDS.size ? SORT_FIELDS.name : sort; // size doesn't apply to folders
  // Manual mode: also include id as tiebreaker; non-manual: secondary by name then id
  const tieBreak =
    sort === SORT_FIELDS.manual ? `, id ${order}` : `, name COLLATE NOCASE ASC, id ASC`;
  const folders = db
    .prepare(
      `SELECT id, name, sort_order, created_at FROM folders WHERE ${parentClause} ORDER BY ${folderSortKey} ${order}${tieBreak}`
    )
    .all(...args)
    .map((f) => ({ ...f, type: 'folder' }));

  const files = db
    .prepare(
      `SELECT id, name, size, mime_type, ext, oss_key, sort_order, created_at FROM files WHERE ${folderClause} ORDER BY ${sort} ${order}${tieBreak}`
    )
    .all(...args)
    .map((f) => ({ ...f, type: 'file' }));

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
  if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
  const trimmed = name.trim();
  const pid = parent_id ? Number(parent_id) : null;
  if (pid) {
    const parent = db.prepare('SELECT id FROM folders WHERE id = ?').get(pid);
    if (!parent) return res.status(400).json({ error: 'parent not found' });
  }
  try {
    const so = nextSortOrder('folders', 'parent_id', pid);
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
      return res.status(409).json({ error: 'folder already exists' });
    }
    throw e;
  }
});

// Move folder to a new parent (parent_id = null means root)
router.patch('/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(id);
  if (!folder) return res.status(404).json({ error: 'not found' });

  const raw = req.body?.parent_id;
  const newParent = raw === null || raw === undefined || raw === 0 || raw === '0' ? null : Number(raw);

  if (newParent === id) return res.status(400).json({ error: 'cannot move into itself' });

  if (newParent !== null) {
    const exists = db.prepare('SELECT id FROM folders WHERE id = ?').get(newParent);
    if (!exists) return res.status(400).json({ error: 'target parent not found' });
    // Walk up from newParent; if we hit id, it's a descendant => cycle.
    let cur = newParent;
    const seen = new Set();
    while (cur != null && !seen.has(cur)) {
      if (cur === id) return res.status(400).json({ error: 'cannot move into descendant' });
      seen.add(cur);
      const row = db.prepare('SELECT parent_id FROM folders WHERE id = ?').get(cur);
      cur = row?.parent_id ?? null;
    }
  }

  if (newParent === (folder.parent_id ?? null)) return res.json({ ok: true, unchanged: true });

  try {
    const collectFolders = (folderId, acc) => {
      const row = db.prepare('SELECT id FROM folders WHERE id = ?').get(folderId);
      if (row) acc.push(row.id);
      const subs = db.prepare('SELECT id FROM folders WHERE parent_id = ?').all(folderId);
      for (const sub of subs) collectFolders(sub.id, acc);
    };
    const folderIds = [];
    collectFolders(id, folderIds);
    const files = [];
    for (const folderId of folderIds) {
      files.push(
        ...db
          .prepare('SELECT id, folder_id, name, oss_key FROM files WHERE folder_id = ?')
          .all(folderId)
      );
    }

    const parentOverrides = new Map([[id, newParent]]);
    const fileMoves = files.map((file) => ({
      ...file,
      newKey: objectKeyForFile(db, file.folder_id, file.name, parentOverrides),
    }));
    for (const move of fileMoves) {
      const conflict = db
        .prepare('SELECT id FROM files WHERE oss_key = ? AND id != ?')
        .get(move.newKey, move.id);
      if (conflict) return res.status(409).json({ error: 'target OSS path already exists' });
    }

    const placeholderMoves = folderIds
      .map((folderId) => ({
        oldKey: placeholderKeyForFolder(db, folderId),
        newKey: placeholderKeyForFolder(db, folderId, parentOverrides),
      }))
      .filter((move) => move.oldKey && move.newKey);

    for (const move of fileMoves) {
      if (move.oss_key !== move.newKey) await copyOssObject(move.oss_key, move.newKey);
    }
    for (const move of placeholderMoves) {
      await putEmptyOssObject(move.newKey);
    }

    const so = nextSortOrder('folders', 'parent_id', newParent);
    const updateFolder = db.prepare('UPDATE folders SET parent_id = ?, sort_order = ? WHERE id = ?');
    const updateFile = db.prepare('UPDATE files SET oss_key = ? WHERE id = ?');
    const tx = db.transaction(() => {
      updateFolder.run(newParent, so, id);
      for (const move of fileMoves) updateFile.run(move.newKey, move.id);
    });
    tx();

    for (const move of fileMoves) {
      if (move.oss_key !== move.newKey) {
        await deleteOssObjectIfExists(move.oss_key);
      }
    }
    for (const move of placeholderMoves) {
      if (move.oldKey !== move.newKey) {
        await deleteOssObjectIfExists(move.oldKey);
      }
    }
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
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be an array' });
  const pid = parent_folder_id == null || parent_folder_id === 0 ? null : Number(parent_folder_id);

  // Validate every entry belongs to the claimed parent folder.
  for (const it of order) {
    if (!it || (it.type !== 'file' && it.type !== 'folder') || !it.id) continue;
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
      if (!it || (it.type !== 'file' && it.type !== 'folder') || !it.id) continue;
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
  if (!id) return res.status(400).json({ error: 'invalid id' });
  // Gather all descendant files to clean up OSS objects.
  const collectKeys = (folderId, acc) => {
    const placeholder = placeholderKeyForFolder(db, folderId);
    if (placeholder) acc.push(placeholder);
    const fs = db.prepare('SELECT oss_key FROM files WHERE folder_id = ?').all(folderId);
    for (const f of fs) acc.push(f.oss_key);
    const subs = db.prepare('SELECT id FROM folders WHERE parent_id = ?').all(folderId);
    for (const s of subs) collectKeys(s.id, acc);
  };
  const keys = [];
  collectKeys(id, keys);

  // Delete OSS objects before removing database rows so the two stores stay in sync.
  for (const k of keys) {
    try {
      await deleteOssObjectIfExists(k);
    } catch (e) {
      console.warn('oss delete failed', k, e.message);
      return res.status(502).json({ error: 'oss delete failed' });
    }
  }

  db.prepare('DELETE FROM folders WHERE id = ?').run(id);
  res.json({ ok: true, removed_files: keys.length });
});

export default router;
