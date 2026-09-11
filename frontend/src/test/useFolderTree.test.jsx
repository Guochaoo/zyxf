import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const getFolderTreeMock = vi.fn();
vi.mock('../api.js', () => ({
  getFolderTree: (...a) => getFolderTreeMock(...a),
  default: { get: vi.fn(), post: vi.fn() },
}));

const { useFolderTree, __resetFolderTreeStore } = await import('../hooks/useFolderTree.js');

// IMPROVE-24：侧边栏与知识图谱各挂一个实例，同一次变更原先会发两次完全相同的 GET。
describe('useFolderTree 模块级共享存储', () => {
  beforeEach(() => {
    __resetFolderTreeStore();
    getFolderTreeMock.mockReset();
    getFolderTreeMock.mockResolvedValue({ tree: [{ id: 1, name: '课程' }], files: [] });
  });

  test('两个消费方同时挂载只发一次请求', async () => {
    const a = renderHook(() => useFolderTree());
    const b = renderHook(() => useFolderTree());

    await waitFor(() => expect(a.result.current.tree).toEqual([{ id: 1, name: '课程' }]));
    expect(getFolderTreeMock).toHaveBeenCalledTimes(1);
    // 两个消费方读的是同一份数据
    expect(b.result.current.tree).toEqual(a.result.current.tree);

    a.unmount();
    b.unmount();
  });

  test('一次 folders-changed 只发一次请求，且两个消费方都刷新', async () => {
    const a = renderHook(() => useFolderTree());
    const b = renderHook(() => useFolderTree());
    await waitFor(() => expect(a.result.current.tree).toBeTruthy());
    expect(getFolderTreeMock).toHaveBeenCalledTimes(1);

    getFolderTreeMock.mockResolvedValue({ tree: [{ id: 2, name: '新目录' }], files: [] });
    act(() => {
      window.dispatchEvent(new Event('folders-changed'));
    });

    await waitFor(() => expect(a.result.current.tree).toEqual([{ id: 2, name: '新目录' }]));
    expect(getFolderTreeMock).toHaveBeenCalledTimes(2);
    expect(b.result.current.tree).toEqual([{ id: 2, name: '新目录' }]);

    a.unmount();
    b.unmount();
  });

  // BUG-82：旧响应不得覆盖新快照
  test('先发的旧响应不覆盖后到的新快照', async () => {
    let resolveOld;
    getFolderTreeMock.mockImplementationOnce(
      () => new Promise((res) => { resolveOld = res; })
    );
    const a = renderHook(() => useFolderTree());
    await waitFor(() => expect(getFolderTreeMock).toHaveBeenCalledTimes(1));

    // 第二次请求（变更触发）先返回
    getFolderTreeMock.mockImplementationOnce(() =>
      Promise.resolve({ tree: [{ id: 3, name: '较新' }], files: [] })
    );
    act(() => {
      window.dispatchEvent(new Event('folders-changed'));
    });
    await waitFor(() => expect(a.result.current.tree).toEqual([{ id: 3, name: '较新' }]));

    // 旧请求这时才返回，必须被丢弃
    await act(async () => {
      resolveOld({ tree: [{ id: 9, name: '过期' }], files: [] });
    });
    expect(a.result.current.tree).toEqual([{ id: 3, name: '较新' }]);
    a.unmount();
  });

  test('请求失败不会把 loading 永久卡住', async () => {
    getFolderTreeMock.mockRejectedValueOnce(new Error('network'));
    const a = renderHook(() => useFolderTree());
    await waitFor(() => expect(a.result.current.loading).toBe(false));
    expect(a.result.current.tree).toBeNull();
    a.unmount();
  });
});
