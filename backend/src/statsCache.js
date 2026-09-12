// IMPROVE-53：仪表盘统计的 30 s TTL 缓存（只在非 test 环境启用）。GET /api/stats
// 单请求要跑 ~12 条聚合 SQL（含相关子查询与递归 CTE），每次进仪表盘全量重算不值。
// 与目录树/搜索快照同批失效（写路径统一调 invalidateLibraryCaches()，见 libraryCaches.js）；
// 下载/上传计数变化靠 TTL 自然过期——若在每次下载记账时也失效，缓存会被高频下载打穿，
// 仪表盘 30 s 新鲜度可接受。
const STATS_CACHE_TTL_MS = 30 * 1000;
// key 有两个来源：`stats:<range>`（range 钳制在 7..90，最多 84 个）与 `heatmap:<days>`
// （days 钳制在 31..731，客户端可任意传值）。设上限防止拼 key 的攻击面把 Map 撑大。
const MAX_ENTRIES = 32;
const cache = new Map();

export function statsCacheEnabled() {
  return process.env.NODE_ENV !== 'test';
}

/** 命中缓存则返回同一份 payload 对象（调用方只读），否则返回 null。 */
export function getCachedStats(key) {
  if (!statsCacheEnabled()) return null;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.payload;
  return null;
}

export function setCachedStats(key, payload) {
  if (!statsCacheEnabled()) return;
  if (cache.size >= MAX_ENTRIES) cache.clear();
  cache.set(key, { payload, expiresAt: Date.now() + STATS_CACHE_TTL_MS });
}

export function invalidateStatsCache() {
  cache.clear();
}
