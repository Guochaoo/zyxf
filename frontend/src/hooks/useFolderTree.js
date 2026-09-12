import { getFolderTree } from '../api.js';
import { invalidateResource, useResource } from '../data/resource.js';

/**
 * 整棵文件夹树的模块级共享存储（IMPROVE-24，IMPROVE-56 迁到 data/resource.js）。
 *
 * 侧边栏 FolderTree 与知识图谱 KnowledgeGraph 都要这棵树：同一时刻只有一个在途
 * 请求（后到调用复用同一 Promise）、所有订阅者读同一份快照、'folders-changed'
 * 只注册一次监听。存储本身已由 resource.js 提供，这里只保留对外契约：
 *  - 挂载时有缓存不再重取（revalidateOnMount: false，新鲜度由 folders-changed 保证，
 *    与服务端 30 s 树快照 IMPROVE-15 呼应）；
 *  - 竞态守卫（BUG-82）：只有最新一次响应能写入快照（resource store 内建）。
 */
const TREE_KEY = 'tree';

function treeFetcher(_key, { signal } = {}) {
  return getFolderTree({ signal }).then((d) => ({ tree: d.tree || [], rootFiles: d.files || [] }));
}

// 模块加载时注册一次全局变更监听（原先每个 hook 实例各注册一次）。
// 失效会让挂载中的消费方立即重取（invalidateResource 的内建行为）。
if (typeof window !== 'undefined') {
  window.addEventListener('folders-changed', () => invalidateResource(TREE_KEY));
}

/**
 * 读取整棵文件夹树（含根级文件），并跟随全局 'folders-changed' 自动刷新。
 * 挂载时按需触发加载（并发挂载的多个消费方共享同一个请求）。
 *
 * @returns {{ tree: Array|null, rootFiles: Array, loading: boolean }}
 */
export function useFolderTree() {
  const { data, error, loading } = useResource(TREE_KEY, treeFetcher, { revalidateOnMount: false });
  return {
    tree: data?.tree ?? null,
    rootFiles: data?.rootFiles ?? [],
    // 原初值即 true：还没有任何 entry（首次挂载未起请求）时保持 loading。
    // 失败后 entry 带着 error 停在原地，loading 必须回到 false（不能卡住）。
    loading: loading || (data === undefined && !error),
  };
}

// 仅供测试：清空共享状态，避免用例间互相污染。
export function __resetFolderTreeStore() {
  invalidateResource(TREE_KEY); // 作废在途请求并清缓存
}
