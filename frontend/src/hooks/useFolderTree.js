import { useEffect, useSyncExternalStore } from 'react';
import { getFolderTree } from '../api.js';

/**
 * 整棵文件夹树的模块级共享存储（IMPROVE-24，含 IMPROVE-15 的前端去重）。
 *
 * 侧边栏 FolderTree 与知识图谱 KnowledgeGraph 都要这棵树，但它们各自实例化一次 hook：
 * 各持一份 state、各自监听 'folders-changed'，同一次变更会发两次完全相同的
 * GET /api/folders/tree（大库时是实打实的翻倍）。这里把数据提升到模块级：
 *  - 同一时刻只有一个在途请求（后到的调用复用同一个 Promise）；
 *  - 所有订阅者读同一份快照，一次响应触发一次重渲染；
 *  - 'folders-changed' 只在这里监听一次（模块加载时注册）。
 *
 * 竞态守卫（BUG-82）：请求序号递增，只有最新一次响应能写入快照。
 */
let cache = { tree: null, rootFiles: [], loading: true };
let inflight = null;
let reqId = 0;
const listeners = new Set();

function emit() {
  cache = { ...cache }; // 换引用，useSyncExternalStore 才能察觉变化
  for (const l of listeners) l();
}

function loadFolderTree() {
  const id = (reqId += 1);
  cache = { ...cache, loading: true };
  emit();
  inflight = getFolderTree()
    .then((d) => {
      if (id !== reqId) return; // 旧响应：丢弃
      cache = { tree: d.tree || [], rootFiles: d.files || [], loading: false };
      emit();
    })
    .catch(() => {
      if (id !== reqId) return;
      cache = { ...cache, loading: false };
      emit();
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// 模块加载时注册一次全局变更监听（原先每个 hook 实例各注册一次）。
if (typeof window !== 'undefined') {
  window.addEventListener('folders-changed', loadFolderTree);
}

const getSnapshot = () => cache;

/**
 * 读取整棵文件夹树（含根级文件），并跟随全局 'folders-changed' 自动刷新。
 * 挂载时按需触发加载（并发挂载的多个消费方共享同一个请求）。
 * 服务端侧同一份数据已有 30 s 快照（IMPROVE-15），这里负责「不重复发第二次请求」。
 *
 * @returns {{ tree: Array|null, rootFiles: Array, loading: boolean }}
 */
export function useFolderTree() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // 首次挂载才拉取：已有数据（或已有在途请求）时不动，避免第二次挂载重复请求。
  useEffect(() => {
    if (cache.tree === null && !inflight) loadFolderTree();
  }, []);

  return snapshot;
}

// 仅供测试：清空共享状态，避免用例间互相污染。
export function __resetFolderTreeStore() {
  reqId += 1; // 作废在途请求
  inflight = null;
  cache = { tree: null, rootFiles: [], loading: true };
  emit();
}
