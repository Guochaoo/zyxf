import path from 'node:path';
import { buildFolderIndex } from './dbHelpers.js';

export function cleanObjectSegment(name) {
  return String(name || '')
    .normalize('NFC')
    .replace(/[\\/\u0000-\u001f\u007f]/g, '-')
    .trim()
    // 纯点段统一换成 `_`：`.` 与 `..` 在 OSS/S3 语义里是「当前目录 / 上级目录」，
    // 直接拼进 key 就能越出 OSS_KEY_PREFIX（`zyxf/../other/x`），而 cleanup-upload 的
    // 前缀校验只是字符串 startsWith → 可删到其它部署（乃至桶根）的对象。
    // 原 `^\.+$` 已包含 `..`，但只处理「整段全是点」；这里保留同义并把含义写清楚。
    .replace(/^\.+$/, '_');
}

export function ossPrefix() {
  return (process.env.OSS_KEY_PREFIX || '').replace(/^\/+|\/+$/g, '');
}

// ---- 唯一实现：Map 版 --------------------------------------------------------
// IMPROVE-18：key 规则只在这里实现一次，DB 版是「现取一遍 folders 建索引」的薄封装；
// 两套实现并行过，改一侧就会让上传落库的 key 与改名/移动算出的 key 不一致。

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

// 现取一次 folders 表 → Map(id -> { name, parent_id })。
function folderMapFor(db) {
  const { folderMap } = buildFolderIndex(db.prepare('SELECT id, name, parent_id FROM folders').all());
  return folderMap;
}

export function folderPathSegments(db, folderId, parentOverrides = new Map(), nameOverrides = new Map()) {
  return folderPathSegmentsFromMap(folderId, folderMapFor(db), parentOverrides, nameOverrides);
}

export function objectKeyForFile(db, folderId, filename, parentOverrides = new Map(), nameOverrides = new Map()) {
  return objectKeyForFileFromMap(folderId, filename, folderMapFor(db), parentOverrides, nameOverrides);
}

export function placeholderKeyForFolder(db, folderId, parentOverrides = new Map(), nameOverrides = new Map()) {
  return placeholderKeyForFolderFromMap(folderId, folderMapFor(db), parentOverrides, nameOverrides);
}

export function parseOptionalFolderId(value) {
  if (value === null || value === undefined || value === 0 || value === '0' || value === '') {
    return null;
  }
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : NaN;
}
