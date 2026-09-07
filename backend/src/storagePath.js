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

export function folderPathSegments(db, folderId, parentOverrides = new Map(), nameOverrides = new Map()) {
  if (!folderId) return [];
  const chain = [];
  const seen = new Set();
  let cur = db.prepare('SELECT id, name, parent_id FROM folders WHERE id = ?').get(folderId);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    const name = nameOverrides.has(cur.id) ? nameOverrides.get(cur.id) : cur.name;
    chain.unshift(cleanObjectSegment(name));
    const parent = parentOverrides.has(cur.id) ? parentOverrides.get(cur.id) : cur.parent_id;
    if (!parent) break;
    cur = db.prepare('SELECT id, name, parent_id FROM folders WHERE id = ?').get(parent);
  }
  return chain.filter(Boolean);
}

export function objectKeyForFile(db, folderId, filename, parentOverrides = new Map(), nameOverrides = new Map()) {
  const parts = [
    ossPrefix(),
    ...folderPathSegments(db, folderId, parentOverrides, nameOverrides),
    cleanObjectSegment(filename || path.basename(filename || 'file')),
  ].filter(Boolean);
  return parts.join('/');
}

export function placeholderKeyForFolder(db, folderId, parentOverrides = new Map(), nameOverrides = new Map()) {
  const parts = [ossPrefix(), ...folderPathSegments(db, folderId, parentOverrides, nameOverrides)].filter(Boolean);
  if (!parts.length) return null;
  return `${parts.join('/')}/`;
}

// ---- In-memory map variants (N+1 refactors) ----------------------------------
// These mirror the pure functions above but derive ancestor path segments from a
// preloaded `Map(id -> { name, parent_id })` instead of one query per ancestor.
// The DB-taking functions above keep their exact signatures; the route layer
// uses these variants to avoid re-querying per file/folder.

export function folderPathSegmentsFromMap(folderId, folderMap, parentOverrides = new Map(), nameOverrides = new Map()) {
  if (!folderId) return [];
  const chain = [];
  const seen = new Set();
  let curId = folderId;
  let cur = folderMap.get(folderId);
  while (cur && !seen.has(curId)) {
    seen.add(curId);
    const name = nameOverrides.has(curId) ? nameOverrides.get(curId) : cur.name;
    chain.unshift(cleanObjectSegment(name));
    const parent = parentOverrides.has(curId) ? parentOverrides.get(curId) : cur.parent_id;
    if (!parent) break;
    curId = parent;
    cur = folderMap.get(parent);
  }
  return chain.filter(Boolean);
}

export function objectKeyForFileFromMap(folderId, filename, folderMap, parentOverrides = new Map(), nameOverrides = new Map()) {
  const parts = [
    ossPrefix(),
    ...folderPathSegmentsFromMap(folderId, folderMap, parentOverrides, nameOverrides),
    cleanObjectSegment(filename || path.basename(filename || 'file')),
  ].filter(Boolean);
  return parts.join('/');
}

export function placeholderKeyForFolderFromMap(folderId, folderMap, parentOverrides = new Map(), nameOverrides = new Map()) {
  const parts = [ossPrefix(), ...folderPathSegmentsFromMap(folderId, folderMap, parentOverrides, nameOverrides)].filter(Boolean);
  if (!parts.length) return null;
  return `${parts.join('/')}/`;
}

export function parseOptionalFolderId(value) {
  if (value === null || value === undefined || value === 0 || value === '0' || value === '') {
    return null;
  }
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : NaN;
}
