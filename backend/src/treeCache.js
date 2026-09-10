// 「整库目录树」的轻量 TTL 缓存（IMPROVE-15）。
//
// GET /api/folders/tree 每次都要两条无 WHERE 的全表 SELECT，再在内存里递归建出含全库每个
// 文件节点的整棵树；侧边栏与知识图谱各挂一次，进站/上传/删除/拖拽排序都会各触发一遍。
// 这里加一层与 searchService 同款的短 TTL 快照（只在非 test 环境启用，避免测试插入数据后
// 立刻读到旧树），由既有的写路径统一调用 invalidateTreeCache() 失效。
//
// 注意：不要在这里缓存「某个目录的内容列表」——那是每次进目录都要最新数据的路径。
const TREE_CACHE_TTL_MS = 30 * 1000;
let cache = { payload: null, expiresAt: 0 };

export function treeCacheEnabled() {
  return process.env.NODE_ENV !== 'test';
}

/** 命中缓存则返回同一份 payload 对象（调用方只读），否则返回 null。 */
export function getCachedTree() {
  if (!treeCacheEnabled()) return null;
  if (cache.payload && cache.expiresAt > Date.now()) return cache.payload;
  return null;
}

export function setCachedTree(payload) {
  if (!treeCacheEnabled()) return;
  cache = { payload, expiresAt: Date.now() + TREE_CACHE_TTL_MS };
}

export function invalidateTreeCache() {
  cache = { payload: null, expiresAt: 0 };
}
