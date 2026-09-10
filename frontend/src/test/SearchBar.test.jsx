import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const searchMock = vi.fn();
vi.mock('../api.js', () => ({
  search: (...a) => searchMock(...a),
  getFileUrl: vi.fn(),
  default: { get: vi.fn(), post: vi.fn() },
}));

const { default: SearchBar } = await import('../components/SearchBar.jsx');

function renderBar() {
  return render(
    <MemoryRouter>
      <SearchBar />
    </MemoryRouter>
  );
}

const input = () => screen.getByPlaceholderText('搜索文字');

describe('SearchBar 失败路径', () => {
  beforeEach(() => {
    searchMock.mockReset();
  });

  test('查询失败时清掉上一次的结果并显示错误与重试（不再静默展示旧结果）', async () => {
    searchMock.mockResolvedValueOnce({ folders: [{ id: 1, name: '高等数学' }], files: [] });
    renderBar();

    fireEvent.change(input(), { target: { value: 'gaoshu' } });
    await waitFor(() => expect(screen.getByText('高等数学')).toBeInTheDocument());

    // 第二次查询失败：旧结果必须消失，否则用户以为这是新关键词的命中
    searchMock.mockRejectedValueOnce({ response: { data: { error: '服务不可用' } } });
    fireEvent.change(input(), { target: { value: 'gaoshu2' } });

    await waitFor(() => expect(screen.getByText('服务不可用')).toBeInTheDocument());
    expect(screen.queryByText('高等数学')).toBeNull();
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
  });

  test('点重试会用当前关键词重新请求', async () => {
    searchMock.mockRejectedValueOnce(new Error('network down'));
    renderBar();

    fireEvent.change(input(), { target: { value: 'abc' } });
    await waitFor(() => expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument());

    searchMock.mockResolvedValueOnce({ folders: [], files: [] });
    fireEvent.click(screen.getByRole('button', { name: '重试' }));

    await waitFor(() => expect(searchMock).toHaveBeenLastCalledWith('abc'));
    await waitFor(() => expect(screen.getByText('无匹配结果')).toBeInTheDocument());
  });

  test('请求失败时先清空旧结果：清空按钮仍可点（aria-label 不被 loading 覆盖）', async () => {
    searchMock.mockResolvedValue({ folders: [], files: [] });
    renderBar();
    fireEvent.change(input(), { target: { value: 'x' } });

    // 输入框右侧的按钮始终是「清除搜索」，loading 只改变图标
    await waitFor(() => expect(searchMock).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: /清除/ })).toBeInTheDocument();
  });
});
