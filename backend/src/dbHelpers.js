// Shared pure-DB helpers used by multiple routes.

// Next sort_order for a new row in a parent-ordered table.
// table/column come from fixed call-site literals (never user input).
export function nextSortOrder(db, table, column, parentId) {
  const where = parentId === null ? `${column} IS NULL` : `${column} = ?`;
  const stmt = db.prepare(`SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM ${table} WHERE ${where}`);
  const row = parentId === null ? stmt.get() : stmt.get(parentId);
  return row.n;
}

// Find a row (folders or files) with the same name in the same parent, optionally excluding one id.
export function findByNameInParent(db, table, parentCol, name, parentId, excludeId = null) {
  const normalizedParentId = parentId == null || parentId === 0 ? null : Number(parentId);
  const base =
    normalizedParentId === null
      ? `SELECT id FROM ${table} WHERE name = ? AND ${parentCol} IS NULL`
      : `SELECT id FROM ${table} WHERE name = ? AND ${parentCol} = ?`;
  const sql = excludeId ? `${base} AND id != ?` : base;
  const args = normalizedParentId === null ? [name] : [name, normalizedParentId];
  if (excludeId) args.push(excludeId);
  return db.prepare(sql).get(...args);
}

export function findFileByNameInFolder(db, name, folderId, excludeId = null) {
  return findByNameInParent(db, 'files', 'folder_id', name, folderId, excludeId);
}

// Another file already occupies this OSS key (keys are unique).
export function findOssKeyConflict(db, ossKey, excludeId) {
  return db.prepare('SELECT id FROM files WHERE oss_key = ? AND id != ?').get(ossKey, excludeId);
}
