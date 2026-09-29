import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import FolderTree from '../components/FolderTree.jsx';
import { __resetFolderTreeStore } from '../hooks/useFolderTree.js';

// IMPROVE-58 第 5 组：FolderTree 渲染。它是左栏唯一入口，expand/activePath/返回 null
// 三条路径此前都没有断言（useFolderTree.test.jsx 只覆盖取数 hook）。
const getFolderTreeMock = vi.fn();
vi.mock('../api.js', () => ({
  default: { get: vi.fn(), post: vi.fn() },
  getFolderTree: (...args) => getFolderTreeMock(...args),
}));

const TREE = [
  {
    id: 2,
    name: '高数',
    children: [
      { id: 5, name: '期中', children: [], files: [{ id: 51, name: 'mid.pdf', ext: 'pdf' }] },
    ],
    files: [],
  },
  { id: 3, name: '线代', children: [], files: [{ id: 31, name: 'la.pdf', ext: 'pdf' }] },
];
const ROOT_FILES = [{ id: 99, name: 'root.pdf', ext: 'pdf' }];

const renderTree = (currentId = 0) =>
  render(
    <MemoryRouter>
      <FolderTree currentId={currentId} />
    </MemoryRouter>
  );

beforeEach(() => {
  vi.clearAllMocks();
  __resetFolderTreeStore();
  getFolderTreeMock.mockResolvedValue({ tree: TREE, files: ROOT_FILES });
});

describe('FolderTree 渲染与展开', () => {
  test('树与根级文件都为空时不渲染（返回 null）', async () => {
    getFolderTreeMock.mockResolvedValue({ tree: [], files: [] });
    const { container } = renderTree();
    await waitFor(() => expect(getFolderTreeMock).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });

  test('根为当前文件夹（currentId=0）时默认展开：顶层文件夹与根级文件可见', async () => {
    renderTree(0);

    expect(await screen.findByText('高数')).toBeInTheDocument();
    expect(screen.getByText('线代')).toBeInTheDocument();
    expect(screen.getByText('root.pdf')).toBeInTheDocument();
    // 根节点自己标成当前页
    expect(screen.getByText('首页').closest('[aria-current="page"]')).not.toBeNull();
  });

  test('折叠的分支：先只显示本级，点「展开 X」才出现子内容，再点「收起 X」收回', async () => {
    renderTree(0);

    await screen.findByText('高数');
    expect(screen.queryByText('期中')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '展开 高数' }));
    expect(screen.getByText('期中')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '收起 高数' }));
    expect(screen.queryByText('期中')).toBeNull();
  });

  test('带文件的文件夹同样可展开（expandable = 有子目录 或 有文件）', async () => {
    renderTree(0);

    await screen.findByText('线代');
    expect(screen.queryByText('la.pdf')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '展开 线代' }));
    expect(screen.getByText('la.pdf')).toBeInTheDocument();
  });

  test('键盘 Enter / 空格也能展开（role=button 的 onKeyDown）', async () => {
    renderTree(0);

    const toggle = await screen.findByRole('button', { name: '展开 高数' });
    fireEvent.keyDown(toggle, { key: 'Enter' });
    expect(screen.getByText('期中')).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole('button', { name: '收起 高数' }), { key: ' ' });
    expect(screen.queryByText('期中')).toBeNull();
  });

  test('当前文件夹高亮，且其祖先链自动展开（深链 /folder/:id 也能看到自己在哪）', async () => {
    renderTree(5);

    // 树到达后，根节点由 effect 展开；**祖先链**的展开是紧随其后的另一次 state 更新
    // （activePath 变化 → effect → setExpanded）。两条断言都必须 await：高负载下
    // 同步 getByText 会抢在那次更新之前跑，表现为「找不到『期中』」的假失败。
    expect(await screen.findByText('高数', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(await screen.findByText('期中', {}, { timeout: 3000 })).toBeInTheDocument();

    const current = screen.getByText('期中').closest('[aria-current="page"]');
    expect(current).not.toBeNull();
    // 非当前的节点是链接（可点进对应文件夹）
    expect(screen.getByText('高数').closest('a')).toHaveAttribute('href', '/folder/2');
    expect(screen.getByText('首页').closest('a')).toHaveAttribute('href', '/');
  });
});
