// IMPROVE-15：整库目录树的 30 s TTL 快照（只在非 test 环境启用），写路径统一调
// invalidateLibraryCaches() 失效。只缓存整树；「某个目录的内容列表」每次进目录都要最新。
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
