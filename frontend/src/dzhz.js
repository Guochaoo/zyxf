/**
 * 岱宗盒子（xjtu-toolbox）的独立域名。
 *
 * 2026-11-22 起盒子的一切（落地页、两个协议页、排行榜 `/games/`）都在这个域名下；
 * APK 与 stable.json 仍由 ESA 直接回源 OSS（见 docs/DEPLOY.md §4.2.7）。
 * 同一个 bundle 在两个域名下跑，靠这里的判断决定「根路径渲染落地页还是资料库」。
 */
export const DZHZ_HOST = 'dzhz.zyxf.top';

/** 当前页面是否运行在盒子域名上。SSR/测试环境没有 window 时一律 false。 */
export function isDzhzHost() {
  return typeof window !== 'undefined' && window.location.hostname === DZHZ_HOST;
}
