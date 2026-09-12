// data/resource.js 专属单测（IMPROVE-56 审计跟进：重构核心模块此前零覆盖，
// Dashboard 的旧竞态用例在数据层迁移后也已测不到守卫本体，守护卫的职责收拢到这里）。
// 覆盖：同 key 去重、迟到响应丢弃、换 key 中止在途请求、stale-while-revalidate、
// revalidateOnMount:false、keepPrevious、cache:false、invalidateResource、错误与恢复、enabled:false。
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useResource, invalidateResource, __resetResourceStore } from '../data/resource.js';

beforeEach(() => {
  __resetResourceStore();
});

describe('useResource：请求去重与竞态', () => {
  test('同 key 并发挂载只发一次请求，订阅者共享同一份数据', async () => {
    const fetcher = vi.fn(() => Promise.resolve('A'));
    const a = renderHook(() => useResource('k', fetcher));
    const b = renderHook(() => useResource('k', fetcher));

    await waitFor(() => expect(a.result.current.data).toBe('A'));
    expect(b.result.current.data).toBe('A');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test('同 key 被取代的旧响应不得覆盖新数据，且在途请求被中止', async () => {
    let resolveOld;
    const signals = [];
    const fetcher = vi.fn((_key, { signal }) => {
      signals.push(signal);
      if (signals.length === 1) return new Promise((res) => { resolveOld = res; });
      return Promise.resolve('new');
    });
    const { result } = renderHook(() => useResource('k', fetcher));
    await waitFor(() => expect(signals.length).toBe(1));

    act(() => { result.current.reload(); }); // force 取代旧请求
    await waitFor(() => expect(result.current.data).toBe('new'));

    // 迟到的旧响应：既不能写快照，其连接也应已被中止
    await act(async () => { resolveOld('stale'); });
    expect(result.current.data).toBe('new');
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
  });

  test('key 变化不中止旧请求——其结果落缓存，供返回导航即时呈现', async () => {
    // 设计语义：切 key 只是不再订阅旧请求，并不取消它——旧 key 的响应落缓存，
    // 返回导航才有「即时呈现」。真正的中止发生在同 key 请求被取代时（上一条用例）。
    const resolvers = [];
    const signals = [];
    const fetcher = vi.fn((_key, { signal }) => {
      signals.push(signal);
      return new Promise((res) => resolvers.push(res));
    });
    const { result, rerender } = renderHook(({ id }) => useResource(`item:${id}`, fetcher), {
      initialProps: { id: 1 },
    });
    await waitFor(() => expect(signals.length).toBe(1));

    rerender({ id: 2 });
    await waitFor(() => expect(signals.length).toBe(2));
    expect(signals[0].aborted).toBe(false);
    expect(result.current.data).toBeUndefined(); // 新 key 尚无数据，不得串旧数据

    // 旧请求落地后写入自己的缓存；切回同 key 即时呈现
    await act(async () => { resolvers[0]('old-data'); });
    rerender({ id: 1 });
    await waitFor(() => expect(result.current.data).toBe('old-data'));

    // 收尾：放掉第二个挂起请求，避免悬挂 promise
    await act(async () => { resolvers[1]('new-data'); });
  });
});

describe('useResource：缓存语义', () => {
  test('有缓存时重挂载即时呈现（不闪 loading），并后台静默刷新到新值', async () => {
    let n = 0;
    const fetcher = vi.fn(() => Promise.resolve(`v${++n}`));
    const first = renderHook(() => useResource('k', fetcher));
    await waitFor(() => expect(first.result.current.data).toBe('v1'));
    first.unmount();

    const second = renderHook(() => useResource('k', fetcher));
    // 缓存即时呈现：这一帧没有 loading（浏览返回不再闪转圈的行为基础）
    expect(second.result.current.data).toBe('v1');
    expect(second.result.current.loading).toBe(false);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(second.result.current.data).toBe('v2'));
  });

  test('revalidateOnMount:false 有缓存不重取（目录树语义：靠失效保鲜）', async () => {
    let n = 0;
    const fetcher = vi.fn(() => Promise.resolve(`v${++n}`));
    const first = renderHook(() => useResource('k', fetcher, { revalidateOnMount: false }));
    await waitFor(() => expect(first.result.current.data).toBe('v1'));
    first.unmount();

    const second = renderHook(() => useResource('k', fetcher, { revalidateOnMount: false }));
    expect(second.result.current.data).toBe('v1');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test('cache:false 不落缓存：重挂载重新请求且不呈现旧数据（搜索语义）', async () => {
    let n = 0;
    const fetcher = vi.fn(() => Promise.resolve(`v${++n}`));
    const first = renderHook(() => useResource('k', fetcher, { cache: false }));
    await waitFor(() => expect(first.result.current.data).toBe('v1'));
    first.unmount();

    const second = renderHook(() => useResource('k', fetcher, { cache: false }));
    expect(second.result.current.data).toBeUndefined(); // 旧关键词的命中列表不得展示
    expect(second.result.current.loading).toBe(true);
    await waitFor(() => expect(second.result.current.data).toBe('v2'));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  test('invalidateResource 清缓存并让挂载中的消费方立即重取', async () => {
    let n = 0;
    const fetcher = vi.fn(() => Promise.resolve(`v${++n}`));
    const { result } = renderHook(() => useResource('k', fetcher, { revalidateOnMount: false }));
    await waitFor(() => expect(result.current.data).toBe('v1'));

    act(() => { invalidateResource('k'); });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.data).toBe('v2'));
  });

  test('invalidateResource 后已卸载的 key 缓存清空，下次挂载重取', async () => {
    let n = 0;
    const fetcher = vi.fn(() => Promise.resolve(`v${++n}`));
    const first = renderHook(() => useResource('k', fetcher, { revalidateOnMount: false }));
    await waitFor(() => expect(first.result.current.data).toBe('v1'));
    first.unmount();

    act(() => { invalidateResource('k'); });
    const second = renderHook(() => useResource('k', fetcher, { revalidateOnMount: false }));
    expect(second.result.current.data).toBeUndefined();
    await waitFor(() => expect(second.result.current.data).toBe('v2'));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe('useResource：keepPrevious 与开关', () => {
  test('keepPrevious：换 key 加载期保留上一个 key 的数据（切区间不闪空）', async () => {
    let resolveB;
    const fetcher = vi.fn((key) =>
      key === 'a' ? Promise.resolve('A') : new Promise((res) => { resolveB = res; })
    );
    const { result, rerender } = renderHook(
      ({ k }) => useResource(k, fetcher, { keepPrevious: true }),
      { initialProps: { k: 'a' } }
    );
    await waitFor(() => expect(result.current.data).toBe('A'));

    rerender({ k: 'b' });
    // B 未返回：保留 A 展示、处于加载态（fetcher 在微任务里启动，先等它就绪）
    expect(result.current.data).toBe('A');
    await waitFor(() => expect(result.current.loading).toBe(true));
    await waitFor(() => expect(typeof resolveB).toBe('function'));

    await act(async () => { resolveB('B'); });
    await waitFor(() => expect(result.current.data).toBe('B'));
  });

  test('enabled:false 不发请求', () => {
    const fetcher = vi.fn(() => Promise.resolve('x'));
    const { result } = renderHook(() => useResource('k', fetcher, { enabled: false }));
    expect(result.current.data).toBeUndefined();
    expect(result.current.loading).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('useResource：错误与恢复', () => {
  test('失败写入 error 且 loading 复位，reload 可恢复', async () => {
    const fetcher = vi.fn()
      .mockImplementationOnce(() => Promise.reject(new Error('boom')))
      .mockImplementation(() => Promise.resolve('ok'));
    const { result } = renderHook(() => useResource('k', fetcher));

    await waitFor(() => expect(result.current.error?.message).toBe('boom'));
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeUndefined();

    act(() => { result.current.reload(); });
    await waitFor(() => expect(result.current.data).toBe('ok'));
    expect(result.current.error).toBeNull();
  });
});
