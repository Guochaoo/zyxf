/**
 * 岱宗盒子（xjtu-toolbox）的独立域名。
 *
 * 2026-11-22 起盒子的一切（落地页、两个协议页、排行榜 `/games/`）都在这个域名下；
 * APK 与 stable.json 仍由 ESA 直接回源 OSS（见 docs/DEPLOY.md §4.2.7）。
 * 同一个 bundle 在两个域名下跑，靠这里的判断决定「根路径渲染落地页还是资料库」。
 */
export const DZHZ_HOST = 'dzhz.zyxf.top';
export const MAIN_HOST = 'zyxf.top';

/** 当前页面是否运行在盒子域名上。SSR/测试环境没有 window 时一律 false。 */
export function isDzhzHost() {
  return typeof window !== 'undefined' && window.location.hostname === DZHZ_HOST;
}

// 盒子域名只认这几个页面（含 /dzhz… 旧路径，保住历史分享的链接）。
const DZHZ_ALLOWED = new Set(['/', '/legal', '/license', '/dzhz', '/dzhz/legal', '/dzhz/license']);

/**
 * 盒子域名上的这个路径该不该整页跳回主站。
 *
 * 两个域名共用同一份 dist 与 nginx 的 SPA 回退，所以资料库、统计、设置这些路由
 * 在盒子域名上也能打开（游客态）——那不是我们想要的入口。这里把它们判出来，
 * 由 App 整页 `location.replace` 到主站同一路径。
 *
 * 纯函数、只看 pathname，方便单测（用到 window 的部分留在 App 里）。
 */
export function isDzhzPathBlocked(pathname) {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  return !DZHZ_ALLOWED.has(normalized);
}
