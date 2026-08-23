import { db } from './db.js';
import { matchScore } from './searchMatch.js';

// 路径命中的减分：名称直接命中的文件永远排在「因所在文件夹命中」的文件之前。
const PATH_PENALTY = 10;

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
  const query = (q || '').trim().toLowerCase();
  if (!query) return { folders: [], files: [] };

  const folders = db.prepare('SELECT id, name, parent_id, created_at FROM folders').all();
  const files = db.prepare('SELECT id, name, folder_id, size, ext, created_at FROM files').all();
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
    .prepare('SELECT id, name FROM folders WHERE parent_id IS NULL OR parent_id = 0 ORDER BY name')
    .all();
}
