import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AiSearchCard from '../components/AiSearchCard.jsx';

// 纯展示件：请求状态由 useAiSearch 提供，这里只验证「按 status 换形态」与回调接线。
// 端到端的流式链路（真实 hook + chatStream）在 SearchBar.test.jsx 里覆盖。
function renderCard(overrides = {}, props = {}) {
  const ai = {
    status: 'idle',
    text: '',
    items: null,
    error: '',
    loginRequired: false,
    run: vi.fn(),
    reset: vi.fn(),
    ...overrides,
  };
  const onOpenItem = vi.fn();
  const view = render(<AiSearchCard query="高数" ai={ai} onOpenItem={onOpenItem} {...props} />);
  return { ai, onOpenItem, ...view };
}

describe('AiSearchCard', () => {
  test('入口态：点一下就用当前关键词发起检索', () => {
    const { ai } = renderCard();
    fireEvent.click(screen.getByRole('button', { name: /AI 搜索更多结果/ }));
    expect(ai.run).toHaveBeenCalledWith('高数');
  });

  test('关键词为空时入口不可点', () => {
    renderCard({}, { query: '   ' });
    expect(screen.getByRole('button', { name: /AI 搜索更多结果/ })).toBeDisabled();
  });

  // IMPROVE-10：服务端未配置 + 未登录 + 自带 Key 时后端要求登录，入口直接换成提示。
  test('需要登录时入口改成提示且不可点', () => {
    const { ai } = renderCard({ loginRequired: true });
    expect(screen.getByText('登录后才能使用自带 Key 的 AI 搜索')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button'));
    expect(ai.run).not.toHaveBeenCalled();
  });

  test('查找中：状态文案 + 流光泛光 + 已到达的正文', () => {
    const { container } = renderCard({ status: 'loading', text: '正在检索资料库' });
    expect(screen.getByText('AI 搜索正在查找…')).toBeInTheDocument();
    expect(container.querySelector('.rb-ai-card__halo')).toBeTruthy();
    expect(screen.getByText('正在检索资料库')).toBeInTheDocument();
  });

  test('完成态：剥掉【文件N】编号、列出命中条目，点条目回调出去', () => {
    const { onOpenItem, container } = renderCard({
      status: 'done',
      text: '可能想找：【文件1】',
      items: [
        { id: 7, name: '高等数学期末版.pdf', type: 'file', ext: 'pdf', folder_path: '高等数学' },
        { id: 3, name: '线性代数', type: 'folder' },
      ],
    });

    expect(screen.getByText('AI 搜索')).toBeInTheDocument();
    expect(screen.getByText('可能想找：')).toBeInTheDocument();
    expect(container.querySelector('.rb-ai-card__halo')).toBeNull(); // 完成态不再泛光

    fireEvent.click(screen.getByRole('button', { name: /高等数学期末版\.pdf/ }));
    expect(onOpenItem).toHaveBeenCalledWith(expect.objectContaining({ id: 7, type: 'file' }));

    fireEvent.click(screen.getByRole('button', { name: /线性代数/ }));
    expect(onOpenItem).toHaveBeenCalledWith(expect.objectContaining({ id: 3, type: 'folder' }));
  });

  test('完成但没有任何命中：给出空态', () => {
    renderCard({ status: 'done', text: '', items: [] });
    expect(screen.getByText('AI 没有找到相关资料')).toBeInTheDocument();
  });

  test('失败：给出错误、重试与设置入口', () => {
    const { ai } = renderCard({ status: 'error', error: 'AI 功能未配置' });
    expect(screen.getByText('AI 功能未配置')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /重试/ }));
    expect(ai.run).toHaveBeenCalledWith('高数');
  });
});
