import { useEffect, useRef, useState } from 'react';
import { getFolderTree } from '../api.js';

/**
 * 加载整棵文件夹树（含根级文件），并监听全局 'folders-changed' 事件刷新。
 * 侧边栏 FolderTree 与知识图谱 KnowledgeGraph 共用（原来各自实现了一遍 fetch +
 * alive 守卫 + 事件监听）。
 *
 * 两个实例各自持有一份 state，因此同一次变更仍会各发一次 GET（去重属于 IMPROVE-15/24，
 * 需要模块级缓存，见 docs/ISSUES.md）；这里只保证「同一实例内先发的旧响应不覆盖新响应」。
 *
 * @returns {{ tree: Array|null, rootFiles: Array, loading: boolean }}
 */
export function useFolderTree() {
  const [tree, setTree] = useState(null);
  const [rootFiles, setRootFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  // 请求序号（同 useFolderContents）：重命名后紧接着删除这类连续变更会并发两次
  // /folders/tree，旧请求后到时会把已删/已改名的节点写回目录树。
  const reqIdRef = useRef(0);

  useEffect(() => {
    let alive = true;
    const load = () => {
      const reqId = (reqIdRef.current += 1);
      setLoading(true);
      getFolderTree()
        .then((d) => {
          if (!alive || reqId !== reqIdRef.current) return;
          setTree(d.tree || []);
          setRootFiles(d.files || []);
        })
        .catch(() => {})
        .finally(() => {
          if (alive && reqId === reqIdRef.current) setLoading(false);
        });
    };
    load();
    window.addEventListener('folders-changed', load);
    return () => {
      alive = false;
      // 作废在途请求：卸载后到达的响应不得再写 state
      reqIdRef.current += 1;
      window.removeEventListener('folders-changed', load);
    };
  }, []);

  return { tree, rootFiles, loading };
}
