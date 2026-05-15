import path from 'node:path';

export function cleanObjectSegment(name) {
  return String(name || '')
    .normalize('NFC')
    .replace(/[\\/\u0000-\u001f\u007f]/g, '-')
    .trim()
    .replace(/^\.+$/, '_');
}

export function ossPrefix() {
  return (process.env.OSS_KEY_PREFIX || '').replace(/^\/+|\/+$/g, '');
}

export function folderPathSegments(db, folderId, parentOverrides = new Map()) {
  if (!folderId) return [];
  const chain = [];
  const seen = new Set();
  let cur = db.prepare('SELECT id, name, parent_id FROM folders WHERE id = ?').get(folderId);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.unshift(cleanObjectSegment(cur.name));
    const parent = parentOverrides.has(cur.id) ? parentOverrides.get(cur.id) : cur.parent_id;
    if (!parent) break;
    cur = db.prepare('SELECT id, name, parent_id FROM folders WHERE id = ?').get(parent);
  }
  return chain.filter(Boolean);
}

export function objectKeyForFile(db, folderId, filename, parentOverrides = new Map()) {
  const parts = [
    ossPrefix(),
    ...folderPathSegments(db, folderId, parentOverrides),
    cleanObjectSegment(filename || path.basename(filename || 'file')),
  ].filter(Boolean);
  return parts.join('/');
}

export function placeholderKeyForFolder(db, folderId, parentOverrides = new Map()) {
  const parts = [ossPrefix(), ...folderPathSegments(db, folderId, parentOverrides)].filter(Boolean);
  if (!parts.length) return null;
  return `${parts.join('/')}/`;
}

export function findFileByNameInFolder(db, name, folderId, excludeId = null) {
  const normalizedFolderId = folderId == null || folderId === 0 ? null : Number(folderId);
  const base =
    normalizedFolderId === null
      ? 'SELECT id FROM files WHERE name = ? AND folder_id IS NULL'
      : 'SELECT id FROM files WHERE name = ? AND folder_id = ?';
  const sql = excludeId ? `${base} AND id != ?` : base;
  const args = normalizedFolderId === null ? [name] : [name, normalizedFolderId];
  if (excludeId) args.push(excludeId);
  return db.prepare(sql).get(...args);
}
