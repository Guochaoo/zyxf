import { db } from './db.js';
import { matchScore } from './searchMatch.js';
import { invalidateTreeCache } from './treeCache.js';

// 路径命中的减分。名称直接命中的文件永远排在「因所在文件夹命中」的文件之前：名称直接命中最低分
// 为 PINYIN(45)，而路径命中最高分为 PREFIX(100) - PATH_PENALTY。要保证 100 - PATH_PENALTY < 45，
// PATH_PENALTY 必须 > 55，取 60（见 searchMatch.js 的 SCORES：PREFIX=100/SUBSTRING=80/SUBSEQUENCE=60/PINYIN=45）。
const PATH_PENALTY = 60;

// 全库 folders/files 快照的轻量 TTL 缓存（BUG-07）：避免每次搜索都全表加载。
// 只在非 test 环境生效，避免测试插入数据后立刻搜索读到陈旧快照。
const SEARCH_CACHE_TTL_MS = 30 * 1000;
let searchCache = { folders: null, files: null, expiresAt: 0 };

// 查询长度上限。匹配是同步的、且会跑全库（拼音层还是 DP 匹配），所以超长查询既没有
// 意义又会阻塞事件循环——路由层据此直接 400，服务层兜底截断（AI 工具调用走这里）。
export const MAX_QUERY_LEN = 64;

function searchCacheEnabled() {
  return process.env.NODE_ENV !== 'test';
}

function loadFolders() {
  return db.prepare('SELECT id, name, parent_id, created_at FROM folders').all();
}

function loadFiles() {
  return db.prepare('SELECT id, name, folder_id, size, ext, created_at FROM files').all();
}

// 返回带文件夹路径信息的快照。命中缓存时直接复用上次加载的数组（结构与未命中完全一致）。
function getLibrarySnapshot() {
  if (!searchCacheEnabled()) {
    return { folders: loadFolders(), files: loadFiles() };
  }
  const now = Date.now();
  if (searchCache.expiresAt > now && searchCache.folders && searchCache.files) {
    return searchCache;
  }
  searchCache = { folders: loadFolders(), files: loadFiles(), expiresAt: now + SEARCH_CACHE_TTL_MS };
  return searchCache;
}

/** 数据变更（增删改文件/文件夹）后调用，使全库快照缓存失效。 */
export function invalidateSearchCache() {
  searchCache.expiresAt = 0;
  searchCache.folders = null;
  searchCache.files = null;
}

/**
 * 写路径统一入口：让所有「全库快照类」缓存失效。
 * 搜索快照与目录树快照的失效条件是同一批（增删改文件/文件夹、sync 导入），
 * 分开调用迟早会漏一处（树没失效 = 侧边栏显示已删除的节点）。
 */
export function invalidateLibraryCaches() {
  invalidateSearchCache();
  invalidateTreeCache();
}

// 文件夹 id → 不含根的完整路径（如「高数/第一章」）。visited 防御脏数据造成的父级环。
function buildFolderPaths(folders) {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const paths = new Map();
  for (const folder of folders) {
    const parts = [];
    const visited = new Set();
    let cur = folder;
    while (cur && !visited.has(cur.id)) {
      visited.add(cur.id);
      parts.unshift(cur.name);
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
    }
    paths.set(folder.id, parts.join('/'));
  }
  return paths;
}

function rank(items, limit) {
  return items
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .slice(0, limit)
    .map(({ score, ...item }) => item);
}

/**
 * 全库智能检索（名称前缀/子串、汉字缩写、拼音、文件夹路径）。
 * 同时服务 /api/search 路由与 AI 聊天的 search_files 工具。
 */
export function searchLibrary(q, { limit = 20 } = {}) {
  const query = (q || '').trim().toLowerCase().slice(0, MAX_QUERY_LEN);
  if (!query) return { folders: [], files: [] };

  const { folders, files } = getLibrarySnapshot();
  const folderPaths = buildFolderPaths(folders);

  const rankedFolders = rank(
    folders.map((f) => {
      const score = matchScore(query, f.name);
      return score == null ? null : { ...f, type: 'folder', score };
    }),
    limit
  );

  const rankedFiles = rank(
    files.map((f) => {
      const path = f.folder_id ? folderPaths.get(f.folder_id) : '';
      let score = matchScore(query, f.name);
      if (score == null && path) {
        const pathScore = matchScore(query, `${path}/${f.name}`);
        if (pathScore != null) score = pathScore - PATH_PENALTY;
      }
      return score == null ? null : { ...f, type: 'file', folder_path: path || undefined, score };
    }),
    limit
  );

  return { folders: rankedFolders, files: rankedFiles };
}

/** 顶层目录清单（id + 名称），给 AI 的 system prompt 定向用。 */
export function listTopFolders() {
  return db
    .prepare('SELECT id, name FROM folders WHERE parent_id IS NULL ORDER BY name')
    .all();
}
