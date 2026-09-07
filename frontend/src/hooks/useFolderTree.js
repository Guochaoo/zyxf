import { useEffect, useState } from 'react';
import { getFolderTree } from '../api.js';

/**
 * 加载整棵文件夹树（含根级文件），并监听全局 'folders-changed' 事件刷新。
 * 侧边栏 FolderTree 与知识图谱 KnowledgeGraph 共用（原来各自实现了一遍
 * fetch + alive 守卫 + 事件监听，同一变更会触发两次相同的 GET /folders/tree）。
 *
 * @returns {{ tree: Array|null, rootFiles: Array, loading: boolean }}
 */
export function useFolderTree() {
  const [tree, setTree] = useState(null);
  const [rootFiles, setRootFiles] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = () => {
      setLoading(true);
      getFolderTree()
        .then((d) => {
          if (!alive) return;
          setTree(d.tree || []);
          setRootFiles(d.files || []);
        })
        .catch(() => {})
        .finally(() => alive && setLoading(false));
    };
    load();
    window.addEventListener('folders-changed', load);
    return () => {
      alive = false;
      window.removeEventListener('folders-changed', load);
    };
  }, []);

  return { tree, rootFiles, loading };
}
