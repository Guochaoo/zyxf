// 写路径统一的缓存失效入口：所有「全库快照类」缓存（目录树 / 搜索 / 统计）的
// 失效条件是同一批（增删改文件/文件夹、sync 导入）。集中到一个模块而不是寄居在
// searchService 里，新加缓存类别时只改这里；调用方只 import 这一个名字。
import { invalidateTreeCache } from './treeCache.js';
import { invalidateSearchCache } from './searchService.js';
import { invalidateStatsCache } from './statsCache.js';

export function invalidateLibraryCaches() {
  invalidateTreeCache();
  invalidateSearchCache();
  invalidateStatsCache();
}
