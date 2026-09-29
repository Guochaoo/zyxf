import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AboutPage from '../pages/AboutPage.jsx';
import { AuthProvider } from '../auth.jsx';

// IMPROVE-58 第 5 组：AboutPage 完全没有测试。它依赖 useAuth（管理员才有的「+」标记）、
// framer-motion 的 useInView，以及四张案例卡的图片加载策略（首图 eager/high，
// 其余 lazy——这条是防首屏 LCP 退化的约定，改错没人会发现）。
// jsdom 没有 IntersectionObserver，useInView 会用到。
class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
globalThis.IntersectionObserver = globalThis.IntersectionObserver || IntersectionObserverStub;

const apiGetMock = vi.fn();
vi.mock('../api.js', () => ({
  default: { get: (...args) => apiGetMock(...args), post: vi.fn() },
  TOKEN_KEY: 'zyxf_token',
  login: vi.fn(),
  register: vi.fn(),
}));

const { TOKEN_KEY } = await import('../api.js');

const renderAbout = () =>
  render(
    <MemoryRouter>
      <AuthProvider>
        <AboutPage />
      </AuthProvider>
    </MemoryRouter>
  );

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe('AboutPage 渲染', () => {
  test('头部与行动区文案来自字典', () => {
    renderAbout();
    expect(screen.getByText('我们做了什么')).toBeInTheDocument();
    expect(screen.getByText('资料 · 讲座 · 答疑')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '加入我们' })).toBeInTheDocument();
    expect(screen.getByText(/仲英书院学业辅导中心面向书院同学/)).toBeInTheDocument();
  });

  test('四张案例卡按字典顺序渲染，图片 alt 与分类同源', () => {
    renderAbout();
    const titles = ['期末讲座', '新生导航', '朋辈互助', '资料共建'];
    for (const title of titles) {
      // 案例卡标题 + 同文本的图片 alt（marquee 里另有同名条目，故用 getAllBy）
      expect(screen.getAllByText(title).length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByAltText(title).length).toBe(1);
    }
    expect(screen.getByText('学业支持 · 期末辅导')).toBeInTheDocument();
    expect(screen.getByText('资料库建设 · 知识沉淀')).toBeInTheDocument();
  });

  test('首图 eager + fetchPriority=high，其余 lazy（LCP 约定）', () => {
    renderAbout();
    const first = screen.getAllByAltText('期末讲座')[0];
    expect(first).toHaveAttribute('loading', 'eager');
    expect(first).toHaveAttribute('fetchpriority', 'high');

    const rest = screen.getAllByAltText('新生导航')[0];
    expect(rest).toHaveAttribute('loading', 'lazy');
    expect(rest).toHaveAttribute('fetchpriority', 'auto');
  });

  test('只有 marquee 才有的条目标出现两次（列表复制一份做无缝滚动）', () => {
    renderAbout();
    expect(screen.getAllByText('答疑辅导')).toHaveLength(2);
    expect(screen.getAllByText('学业支持')).toHaveLength(2);
  });

  test('游客看不到管理员的「+」标记', () => {
    renderAbout();
    expect(screen.queryByText('+')).toBeNull();
  });

  test('管理员显示「+」标记（每张卡 + 右下一个）', async () => {
    localStorage.setItem(TOKEN_KEY, 'test-token');
    apiGetMock.mockResolvedValue({ data: { user: { id: 1, username: 'admin', role: 'admin' } } });

    renderAbout();

    await waitFor(() => expect(screen.getAllByText('+')).toHaveLength(5), { timeout: 3000 });
  });
});
