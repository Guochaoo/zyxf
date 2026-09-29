import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useItemDragDrop } from '../pages/Browse/useItemDragDrop.js';

// IMPROVE-58 第 5 组：useItemDragDrop 的其余路径。它是拖拽移动/重排的唯一入口，
// 分支密集（自身 guard、非管理员、非 manual 模式下不许落点、文件夹上/中/下三档、
// 文件行上下半、reorder 的顺序基准、失败提示 4 秒自动消失），而 BrowsePage 的集成
// 测试只碰到其中一两条。
const moveFileMock = vi.fn();
const moveFolderMock = vi.fn();
const reorderItemsMock = vi.fn();

vi.mock('../api.js', () => ({
  default: { get: vi.fn(), post: vi.fn() },
  moveFile: (...args) => moveFileMock(...args),
  moveFolder: (...args) => moveFolderMock(...args),
  reorderItems: (...args) => reorderItemsMock(...args),
}));

// 合并视图（manual 模式后端给的顺序基准）：folder1 → file2 → file3
const manualData = {
  items: [
    { type: 'folder', id: 1, name: 'f1' },
    { type: 'file', id: 2, name: 'a.pdf' },
    { type: 'file', id: 3, name: 'b.pdf' },
  ],
};

const rowEvent = ({ clientY = 0, top = 0, height = 100 } = {}) => ({
  clientY,
  currentTarget: { getBoundingClientRect: () => ({ top, height, left: 0, width: 200 }) },
  preventDefault: vi.fn(),
  dataTransfer: { effectAllowed: '', dropEffect: '', setData: vi.fn() },
});

function setup({ isAdmin = true, sort = 'manual', data = manualData, folderId = 0 } = {}) {
  const setSort = vi.fn();
  const refresh = vi.fn();
  const view = renderHook(() =>
    useItemDragDrop({ data, folderId, sort, isAdmin, setSort, refresh })
  );
  return { ...view, setSort, refresh };
}

const startDrag = (result, item, isAdminEvent = rowEvent()) => {
  act(() => {
    result.current.onDragStart(isAdminEvent, item);
  });
  return isAdminEvent;
};

beforeEach(() => {
  vi.clearAllMocks();
  moveFileMock.mockResolvedValue({});
  moveFolderMock.mockResolvedValue({});
  reorderItemsMock.mockResolvedValue({});
});

describe('useItemDragDrop：落点判定', () => {
  test('非管理员：拖拽完全不启用（不 setDragging、不产生 dropZone）', () => {
    const { result } = setup({ isAdmin: false });
    startDrag(result, { type: 'file', id: 2 });
    expect(result.current.dragging).toBeNull();

    act(() => result.current.onRowDragOver(rowEvent({ clientY: 50 }), { type: 'folder', id: 1 }));
    expect(result.current.dropZone).toBeNull();
  });

  test('管理员拖动：dragging 立即可见，dataTransfer 标成 move 并写入 type:id', () => {
    const { result } = setup();
    const e = startDrag(result, { type: 'file', id: 2 });
    expect(result.current.dragging).toEqual({ type: 'file', id: 2 });
    expect(e.dataTransfer.effectAllowed).toBe('move');
    expect(e.dataTransfer.setData).toHaveBeenCalledWith('text/plain', 'file:2');
  });

  test('拖到自己身上：不产生落点（self guard）', () => {
    const { result } = setup();
    startDrag(result, { type: 'file', id: 2 });
    act(() => result.current.onRowDragOver(rowEvent({ clientY: 10 }), { type: 'file', id: 2 }));
    expect(result.current.dropZone).toBeNull();
  });

  test('非 manual 排序：文件行不接受落点，文件夹行只能「移入」', () => {
    const { result } = setup({ sort: 'name' });
    startDrag(result, { type: 'file', id: 3 });

    act(() => result.current.onRowDragOver(rowEvent({ clientY: 10 }), { type: 'file', id: 2 }));
    expect(result.current.dropZone).toBeNull();

    act(() => result.current.onRowDragOver(rowEvent({ clientY: 10 }), { type: 'folder', id: 1 }));
    expect(result.current.dropZone).toEqual({ mode: 'into', targetType: 'folder', id: 1 });
  });

  test('manual 模式下文件夹分三档：上 25% before / 中间 into / 下 25% after', () => {
    const { result } = setup();
    startDrag(result, { type: 'folder', id: 9 });

    act(() => result.current.onRowDragOver(rowEvent({ clientY: 10, height: 100 }), { type: 'folder', id: 1 }));
    expect(result.current.dropZone).toEqual({ mode: 'before', targetType: 'folder', id: 1 });

    act(() => result.current.onRowDragOver(rowEvent({ clientY: 50, height: 100 }), { type: 'folder', id: 1 }));
    expect(result.current.dropZone).toEqual({ mode: 'into', targetType: 'folder', id: 1 });

    act(() => result.current.onRowDragOver(rowEvent({ clientY: 90, height: 100 }), { type: 'folder', id: 1 }));
    expect(result.current.dropZone).toEqual({ mode: 'after', targetType: 'folder', id: 1 });
  });

  test('manual 模式下文件行看指针上下半：before / after', () => {
    const { result } = setup();
    startDrag(result, { type: 'file', id: 3 });

    act(() => result.current.onRowDragOver(rowEvent({ clientY: 20, height: 100 }), { type: 'file', id: 2 }));
    expect(result.current.dropZone).toEqual({ mode: 'before', targetType: 'file', id: 2 });

    act(() => result.current.onRowDragOver(rowEvent({ clientY: 80, height: 100 }), { type: 'file', id: 2 }));
    expect(result.current.dropZone).toEqual({ mode: 'after', targetType: 'file', id: 2 });
  });

  test('离开目标行时落点被清掉（拖到别的行/滚出时不残留高亮）', () => {
    const { result } = setup();
    startDrag(result, { type: 'file', id: 3 });
    act(() => result.current.onRowDragOver(rowEvent({ clientY: 20 }), { type: 'file', id: 2 }));
    expect(result.current.dropZone).not.toBeNull();

    act(() => result.current.onRowDragLeave({ type: 'file', id: 2 }));
    expect(result.current.dropZone).toBeNull();

    // 清掉后再拖回别的行仍能重新建立落点
    act(() => result.current.onRowDragOver(rowEvent({ clientY: 80 }), { type: 'file', id: 2 }));
    expect(result.current.dropZone).toEqual({ mode: 'after', targetType: 'file', id: 2 });
  });

  test('onDragEnd 清空 dragging 与 dropZone', () => {
    const { result } = setup();
    startDrag(result, { type: 'file', id: 2 });
    act(() => result.current.onRowDragOver(rowEvent({ clientY: 10 }), { type: 'file', id: 3 }));
    act(() => result.current.onDragEnd());
    expect(result.current.dragging).toBeNull();
    expect(result.current.dropZone).toBeNull();
  });
});

describe('useItemDragDrop：落点执行', () => {
  test('移入文件夹：文件走 moveFile、广播目录变更并刷新', async () => {
    const { result, refresh } = setup();
    const changed = vi.fn();
    window.addEventListener('folders-changed', changed);

    startDrag(result, { type: 'file', id: 2 });
    await act(async () => {
      await result.current.onRowDrop(rowEvent({ clientY: 50 }), { type: 'folder', id: 1 });
    });

    expect(moveFileMock).toHaveBeenCalledWith(2, 1);
    expect(moveFolderMock).not.toHaveBeenCalled();
    expect(changed).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    window.removeEventListener('folders-changed', changed);
  });

  test('移入文件夹：文件夹走 moveFolder', async () => {
    const { result } = setup();
    startDrag(result, { type: 'folder', id: 9 });
    await act(async () => {
      await result.current.onRowDrop(rowEvent({ clientY: 50 }), { type: 'folder', id: 1 });
    });
    expect(moveFolderMock).toHaveBeenCalledWith(9, 1);
  });

  test('重排（manual）：顺序数组与显示顺序一致，刷新而不改排序', async () => {
    const { result, refresh, setSort } = setup({ sort: 'manual' });
    startDrag(result, { type: 'file', id: 3 });
    // 拖到 file2 的上半 → 插到 file2 之前
    await act(async () => {
      await result.current.onRowDrop(rowEvent({ clientY: 10, height: 100 }), { type: 'file', id: 2 });
    });

    expect(reorderItemsMock).toHaveBeenCalledWith(null, [
      { type: 'folder', id: 1 },
      { type: 'file', id: 3 },
      { type: 'file', id: 2 },
    ]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(setSort).not.toHaveBeenCalled();
  });

  test('非 manual 排序下拖到文件行不产生任何重排请求（落点判定已拦掉）', async () => {
    const { result, refresh, setSort } = setup({ sort: 'name' });
    startDrag(result, { type: 'file', id: 3 });
    await act(async () => {
      await result.current.onRowDrop(rowEvent({ clientY: 90, height: 100 }), { type: 'file', id: 2 });
    });

    // onRowDrop 里的 `sort !== 'manual' → setSort('manual')` 属于防御性分支：
    // computeRowZone 只在 manual 模式下给出 before/after，所以它目前不可达（见 issue 备注）。
    expect(reorderItemsMock).not.toHaveBeenCalled();
    expect(setSort).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  test('manual 模式下文件夹之间重排：文件夹也在同一份顺序基准里', async () => {
    const { result } = setup({
      sort: 'manual',
      data: {
        items: [
          { type: 'folder', id: 1, name: 'f1' },
          { type: 'folder', id: 4, name: 'f2' },
          { type: 'file', id: 2, name: 'a.pdf' },
        ],
      },
    });
    startDrag(result, { type: 'folder', id: 4 });
    await act(async () => {
      await result.current.onRowDrop(rowEvent({ clientY: 5, height: 100 }), { type: 'folder', id: 1 });
    });

    expect(reorderItemsMock).toHaveBeenCalledWith(null, [
      { type: 'folder', id: 4 },
      { type: 'folder', id: 1 },
      { type: 'file', id: 2 },
    ]);
  });

  test('没有合并视图时用 folders+files 拼顺序基准（BUG-27 的显示顺序一致性）', async () => {
    const { result } = setup({
      data: {
        folders: [{ id: 1, name: 'f1' }],
        files: [
          { id: 2, name: 'a.pdf' },
          { id: 3, name: 'b.pdf' },
        ],
      },
    });
    startDrag(result, { type: 'file', id: 2 });
    await act(async () => {
      await result.current.onRowDrop(rowEvent({ clientY: 90, height: 100 }), { type: 'file', id: 3 });
    });

    expect(reorderItemsMock).toHaveBeenCalledWith(null, [
      { type: 'folder', id: 1 },
      { type: 'file', id: 3 },
      { type: 'file', id: 2 },
    ]);
  });

  test('folderId 传 0 时按根目录（null）提交', async () => {
    const { result } = setup({ folderId: 0 });
    startDrag(result, { type: 'file', id: 2 });
    await act(async () => {
      await result.current.onRowDrop(rowEvent({ clientY: 50 }), { type: 'folder', id: 1 });
    });
    expect(moveFileMock).toHaveBeenCalledWith(2, 1);
  });
});

describe('useItemDragDrop：失败提示', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test('接口失败：展示服务端文案，4 秒后自动消失', async () => {
    moveFileMock.mockRejectedValue({ response: { data: { error: '同名文件已存在' } } });
    const { result } = setup();

    startDrag(result, { type: 'file', id: 2 });
    await act(async () => {
      await result.current.onRowDrop(rowEvent({ clientY: 50 }), { type: 'folder', id: 1 });
    });
    expect(result.current.moveError).toBe('同名文件已存在');

    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(result.current.moveError).toBe('');
  });

  test('再次拖放时先清掉上一次的提示', async () => {
    moveFileMock.mockRejectedValueOnce({ response: { data: { error: '第一次失败' } } });
    const { result } = setup();

    startDrag(result, { type: 'file', id: 2 });
    await act(async () => {
      await result.current.onRowDrop(rowEvent({ clientY: 50 }), { type: 'folder', id: 1 });
    });
    expect(result.current.moveError).toBe('第一次失败');

    startDrag(result, { type: 'file', id: 2 });
    await act(async () => {
      await result.current.onRowDrop(rowEvent({ clientY: 50 }), { type: 'folder', id: 1 });
    });
    expect(result.current.moveError).toBe('');
  });
});
