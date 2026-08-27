// Shared pure-DB helpers used by multiple routes.

// Next sort_order for a new row in a parent-ordered table.
// table/column come from fixed call-site literals (never user input).
export function nextSortOrder(db, table, column, parentId) {
  const where = parentId === null ? `${column} IS NULL` : `${column} = ?`;
  const stmt = db.prepare(`SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM ${table} WHERE ${where}`);
  const row = parentId === null ? stmt.get() : stmt.get(parentId);
  return row.n;
}
