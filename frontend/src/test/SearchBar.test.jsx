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

    // IMPROVE-54：search 现在带 { signal } 配置（数据层的 AbortController 取消）。
    await waitFor(() => expect(searchMock).toHaveBeenLastCalledWith('abc', expect.anything()));
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

  // IMPROVE-20：后端每类截断 20 条，命中更多时必须说明「只显示了前 N 条」，
  // 否则用户会把 20 当成命中总数而漏掉资料。
  test('结果被截断时提示「仅显示前 N 条」而不是把 20 当总数', async () => {
    const files = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, name: `f${i}.pdf`, ext: 'pdf' }));
    searchMock.mockResolvedValueOnce({ folders: [], files, truncated: true });
    renderBar();
    fireEvent.change(input(), { target: { value: 'gaoshu' } });

    await waitFor(() => expect(screen.getByText('仅显示前 20 条结果')).toBeInTheDocument());
    expect(screen.queryByText('20 个结果')).toBeNull();
  });

  test('未截断时保持原有条数文案', async () => {
    searchMock.mockResolvedValueOnce({ folders: [], files: [{ id: 1, name: 'a.pdf', ext: 'pdf' }], truncated: false });
    renderBar();
    fireEvent.change(input(), { target: { value: 'a' } });

    await waitFor(() => expect(screen.getByText('1 个结果')).toBeInTheDocument());
  });
});
