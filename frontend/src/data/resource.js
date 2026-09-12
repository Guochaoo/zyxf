// 轻量数据层（IMPROVE-56）：同 key 请求去重 + AbortController 取消 + 内存缓存 +
// 统一失效入口。替代散落在 useFolderContents / DashboardPage / SearchBar /
// Preview / useFolderTree 里各自手写的「reqId 丢弃过期响应」守卫（同一模式重复
// 了五遍）。刻意不引 TanStack Query——本项目连 LLM/IMM 客户端都是零依赖手写。
//
// 形态是「模块级 store + useSyncExternalStore 式订阅」（同 useFolderTree 的既有
// 模式，IMPROVE-24）：请求结果写进 store，挂载中的订阅者各自重渲染，卸载的
// 订阅者自然收不到——从根上消灭「对已卸载组件 setState」这类 BUG（BUG-61 一族）。
//
// 语义：
//  - 同一时刻同 key 只有一个在途请求，后到的调用复用同一 Promise（去重）；
//  - 新请求发出时中止上一个在途请求（连续切目录/切区间不再浪费带宽）；
//  - 只有最新一次请求能写入快照（竞态守卫，等价于原先的 reqId）；
//  - 有缓存数据时挂载/换 key 不再闪 loading（stale-while-revalidate）；
//    需要旧行为（每次都转圈）的场景传 revalidateOnMount: 'silent' 以外的值——
//    默认就是静默刷新；tree 这类「挂载不重取」的场景用 revalidateOnMount: false。
import { useCallback, useEffect, useRef, useState } from 'react';

const entries = new Map(); // key -> { data, error, loading, promise, abort }
const listeners = new Map(); // key -> Set<fn>
const fetchers = new Map(); // key -> 最近一次注册的 fetcher（失效重建时用）

function emit(key) {
  const set = listeners.get(key);
  if (set) for (const fn of set) fn();
}

function setEntry(key, patch) {
  entries.set(key, { ...entries.get(key), ...patch });
  emit(key);
}

/**
 * 发起（或复用）一次请求。返回在途 Promise（命中去重时返回已有的）。
 * - force: 跳过去重，强制重发（刷新按钮）；
 * - silent: 有缓存数据时不置 loading（后台 revalidate，UI 不闪）。
 */
export function fetchResource(key, fetcher, { force = false, silent = false } = {}) {
  const entry = entries.get(key);
  if (!force && entry?.promise) return entry.promise;

  // 请求被替换：中止上一个在途请求（其响应本就会被竞态守卫丢弃）。
  entry?.abort?.abort?.();

  const abort = new AbortController();
  // 竞态守卫：只有「仍是这个 key 的最新请求」才能写快照。新请求/失效会把
  // entry.promise 换成别人，旧响应到达时对不上号即丢弃（等价于原 reqId 方案）。
  const promise = Promise.resolve()
    .then(() => fetcher(key, { signal: abort.signal }))
    .then(
      (data) => {
        if (entries.get(key)?.promise === promise) {
          setEntry(key, { data, error: null, loading: false, promise: null, abort: null });
        }
        return data;
      },
      (err) => {
        if (entries.get(key)?.promise === promise) {
          setEntry(key, { error: err, loading: false, promise: null, abort: null });
        }
        throw err;
      }
    );

  entries.set(key, {
    ...entries.get(key),
    // silent（后台 revalidate）：保留已有 data、不闪 loading。
    loading: silent && entry?.data !== undefined ? (entry?.loading ?? false) : true,
    promise,
    abort,
  });
  emit(key);
  return promise;
}

/**
 * 使缓存失效并让挂载中的消费方立即重取。
 * @param {string} prefix key 前缀（如 'contents:'、'tree'、'stats:'）；空串 = 全部。
 */
export function invalidateResource(prefix = '') {
  for (const key of [...entries.keys()]) {
    if (prefix && !key.startsWith(prefix)) continue;
    const entry = entries.get(key);
    entry?.abort?.abort?.();
    entries.delete(key);
    const fetcher = fetchers.get(key);
    if (fetcher && listeners.get(key)?.size) {
      fetchResource(key, fetcher);
    } else {
      emit(key);
    }
  }
}

/** 测试用：清空整个 store（含在途请求），避免用例间互相污染。 */
export function __resetResourceStore() {
  for (const entry of entries.values()) entry?.abort?.abort?.();
  entries.clear();
  fetchers.clear();
  for (const key of [...listeners.keys()]) emit(key);
}

/**
 * 读取一个资源。key 变化（切目录/切区间）自动重取；同 key 多实例共享请求与数据。
 *
 * @param {string} key 缓存键（必须编码全部请求参数）
 * @param {(key: string, ctx: { signal: AbortSignal }) => Promise<any>} fetcher
 * @param {{ enabled?: boolean, keepPrevious?: boolean, revalidateOnMount?: boolean|'silent', cache?: boolean }} opts
 *   - keepPrevious: 换 key 的加载期保留上一个 key 的数据（Dashboard 切区间）。
 *   - revalidateOnMount: true=有缓存也静默刷新（默认）；false=有缓存不重取（目录树，
 *     依赖 invalidateResource 保鲜）；'silent' 同 true。
 *   - cache: false=不落缓存（搜索——旧关键词的命中列表绝不能展示给新关键词）。
 * @returns {{ data: any, error: Error|null, loading: boolean, reload: () => void }}
 */
export function useResource(key, fetcher, opts = {}) {
  const { enabled = true, keepPrevious = false, revalidateOnMount = true, cache = true } = opts;
  const [, forceRender] = useState(0);
  const rerender = useCallback(() => forceRender((c) => c + 1), []);

  // fetcher 每渲染都是新闭包；effect 只认 key/enabled，经 ref 取最新 fetcher。
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const start = useCallback(
    (mode) => {
      // 错误已写入 entry（error 字段），这里吞掉返回 Promise 的 rejection，
      // 避免「被新请求取代的旧请求」在无人 await 时产生 unhandledrejection。
      fetchResource(key, fetcherRef.current, mode).catch(() => {});
    },
    [key]
  );

  useEffect(() => {
    if (!enabled) return undefined;
    let set = listeners.get(key);
    if (!set) {
      set = new Set();
      listeners.set(key, set);
    }
    set.add(rerender);
    fetchers.set(key, fetcherRef.current);
    return () => {
      set.delete(rerender);
      if (!set.size) listeners.delete(key);
    };
  }, [key, enabled, rerender]);

  // 挂载 / key 变化：决定是否发起请求（去重与缓存判断在 store 内）。
  useEffect(() => {
    if (!enabled) return;
    const entry = entries.get(key);
    if (entry?.promise) {
      rerender(); // 订阅在途请求（另一实例发起的），让本实例拿到同一份数据
      return;
    }
    if (cache && entry && entry.data !== undefined) {
      if (revalidateOnMount === false) {
        rerender(); // 纯缓存：不重取（数据新鲜度由 invalidateResource 保证）
        return;
      }
      start({ silent: true }); // stale-while-revalidate
      return;
    }
    // 无缓存（或上次失败留下的空 entry）：正常取
    start({});
  }, [key, enabled, cache, revalidateOnMount, start, rerender]);

  const entry = enabled ? entries.get(key) : null;
  // keepPrevious：换 key 加载期保留上一个 key 的数据（用 ref 存最近一次非空 data）。
  const prevRef = useRef(undefined);
  if (entry?.data !== undefined) prevRef.current = entry.data;
  const data = entry?.data !== undefined ? entry.data : keepPrevious ? prevRef.current : undefined;
  // key 刚换、effect 还没来得及发请求的一帧里 entry 为 null：按「加载中」处理，
  // 避免消费方用 undefined 数据渲染出空态闪一下。
  const loading = enabled ? (entry ? !!entry.loading : true) : false;
  const error = entry?.error ?? null;
  const reload = useCallback(() => {
    if (enabled) start({ force: true });
  }, [enabled, start]);

  return { data, error, loading, reload };
}
