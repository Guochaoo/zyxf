// Shared pure-DB helpers used by multiple routes.

// Group rows into Map(key -> [row, ...]) by a key function. Used by the folder
// tree builders instead of repeating the same has/init/push loop inline.
export function groupByKey(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

// Build a folder index from flat rows: id -> { name, parent_id } plus
// parent_id -> [childId, ...] grouping (root folders are skipped in childrenOf).
export function buildFolderIndex(rows) {
  const folderMap = new Map();
  const childrenOf = new Map();
  for (const f of rows) {
    folderMap.set(f.id, { name: f.name, parent_id: f.parent_id });
    if (f.parent_id == null) continue;
    if (!childrenOf.has(f.parent_id)) childrenOf.set(f.parent_id, []);
    childrenOf.get(f.parent_id).push(f.id);
  }
  return { folderMap, childrenOf };
}

// Next sort_order for a new row in a parent-ordered table.
// table/column come from fixed call-site literals (never user input).
export function nextSortOrder(db, table, column, parentId) {
  const where = parentId === null ? `${column} IS NULL` : `${column} = ?`;
  const stmt = db.prepare(`SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM ${table} WHERE ${where}`);
  const row = parentId === null ? stmt.get() : stmt.get(parentId);
  return row.n;
}

// Does a folder with this id exist? Shared by the "parent folder must exist"
// checks in folders/files routes.
export function folderExists(db, id) {
  return !!db.prepare('SELECT id FROM folders WHERE id = ?').get(id);
}

// Same-name sibling check: a row in `table` with `name` under the same parent
// (parentId === null means root), optionally excluding one id (rename/move
// self-checks). table/parentColumn come from fixed call-site literals.
export function findSibling(db, table, { name, parentColumn, parentId, excludeId = null }) {
  const where = parentId === null ? `${parentColumn} IS NULL` : `${parentColumn} = ?`;
  const args = parentId === null ? [] : [parentId];
  return db
    .prepare(
      `SELECT id FROM ${table} WHERE name = ? AND ${where}${excludeId != null ? ' AND id != ?' : ''}`
    )
    .get(name, ...args, ...(excludeId != null ? [excludeId] : []));
}

// SQLite UNIQUE constraint violation predicate (shared 409 fallback).
export function isUniqueError(e) {
  return String(e.message).includes('UNIQUE');
}
