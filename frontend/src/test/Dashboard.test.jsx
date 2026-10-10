import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Heavy animation shell pieces can't run in jsdom.
vi.mock('../components/SearchBar.jsx', () => ({ default: () => <input aria-label="搜索" /> }));
vi.mock('../components/StaggeredMenu.jsx', () => ({ default: () => <nav /> }));

// Real-shaped stats: 850 uploads 5 days ago, 2 downloads 4 days ago (mirrors
// the production dataset after the 8/11 sync), so the rolling-WoW trend lines
// and the raw-count anomaly chart all have non-zero data to chew on. The
// heatmap's trailing-year series mirrors the same spike.
vi.mock('../api.js', () => {
  const DAY = 86400000;
  const d0 = new Date();
  d0.setHours(0, 0, 0, 0);
  const t0 = d0.getTime();
  const makeSeries = (len, dlDay, upDay) =>
    Array.from({ length: len }, (_, k) => {
      const ts = t0 - (len - 1 - k) * DAY;
      const d = new Date(ts);
      const daysAgo = len - 1 - k;
      return {
        date: `${d.getMonth() + 1}/${d.getDate()}`,
        ts,
        downloads: daysAgo === dlDay ? 2 : 0,
        uploads: daysAgo === upDay ? 850 : 0,
      };
    });
  const series = makeSeries(30, 4, 5);
  const heatSeries = makeSeries(365, 4, 5);
  return {
    default: { get: vi.fn(), post: vi.fn() },
    TOKEN_KEY: 'zyxf_token',
    login: vi.fn(),
    listFolder: vi.fn(() => Promise.resolve({ folder: { id: 0, name: '首页' }, breadcrumb: [], folders: [], files: [] })),
    getFolderTree: vi.fn(() => Promise.resolve({ tree: [] })),
    createFolder: vi.fn(),
    deleteFolder: vi.fn(),
    deleteFile: vi.fn(),
    moveFile: vi.fn(),
    renameFile: vi.fn(),
    moveFolder: vi.fn(),
    renameFolder: vi.fn(),
    reorderItems: vi.fn(),
    getFileUrl: vi.fn(),
    getStats: vi.fn(() =>
      Promise.resolve({
        range: 30,
        today_downloads: 0,
        yesterday_downloads: 0,
        downloads_7d: 2,
        downloads_prev_7d: 0,
        total_files: 850,
        total_folders: 58,
        total_size: 5386657716,
        files_added_7d: 850,
        size_added_7d: 5386657716,
        series,
        type_breakdown: [
          { ext: 'pdf', count: 526, size: 4410000000 },
          { ext: 'ppt', count: 126, size: 500000000 },
        ],
        top_downloads: [],
        recent_uploads: [],
        // 后端已按 file_id 去重、按最近一次下载倒序并限 8 条，前端只负责渲染
        recent_downloads: [
          { id: 201, name: '线性代数习题.pdf', ext: 'pdf', size: 2048, folder_id: 3, downloaded_at: t0 - 2 * 3600000 },
          { id: 202, name: '传热学讲义.pdf', ext: 'pdf', size: 4096, folder_id: 4, downloaded_at: t0 - 30 * 3600000 },
        ],
      })
    ),
    getHeatmap: vi.fn(() => Promise.resolve({ days: 365, series: heatSeries })),
    search: vi.fn(() => Promise.resolve({ folders: [], files: [] })),
    uploadFile: vi.fn(),
  };
});

const { AuthProvider } = await import('../auth.jsx');
const { default: App } = await import('../App.jsx');
const { __resetResourceStore } = await import('../data/resource.js');

function renderApp(initialPath = '/dashboard') {
  return render(
    <MemoryRouter initialEntries={[initialPath]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>
  );
}

describe('DashboardPage', () => {
  // IMPROVE-56 审计跟进：resource store 是模块级缓存，不重置的话从第 2 个用例起
  // 测的是「陈旧缓存 + 后台刷新」而非全新挂载。
  beforeEach(() => {
    __resetResourceStore();
  });

  // Regression: the compare card's tooltip rows evaluate formatValue eagerly
  // with undefined points; a non-null-safe formatter crashed the whole tree.
  test('renders with real-shaped stats without crashing', async () => {
    renderApp();
    // the heatmap card is bare now — its month axis proves the year grid rendered
    await waitFor(
      () => expect(screen.getAllByText(/月$/).length).toBeGreaterThan(0),
      { timeout: 3000 }
    );
  });

  // tooltip 横向钳制的上界必须是网格（offsetParent）宽度；取外层 px-3 容器的 clientWidth
  // 会让末列溢出卡片、被 overflow-hidden 切掉。jsdom 没有布局，offset 全靠下面这层桩。
  async function hoverCellAt(offsetLeft) {
    renderApp();
    await waitFor(() => expect(document.querySelector('[data-cell]')).toBeTruthy(), { timeout: 3000 });
    const cell = document.querySelector('[data-cell]');
    const card = cell.closest('.rounded-control');
    Object.defineProperty(cell, 'offsetLeft', { value: offsetLeft, configurable: true });
    Object.defineProperty(cell, 'offsetTop', { value: 48, configurable: true });
    Object.defineProperty(cell, 'offsetParent', { value: { offsetWidth: 660 }, configurable: true });
    fireEvent.mouseOver(cell);
    return card;
  }

  test('热力图 tooltip 末列被钳在网格内，不再溢出卡片', async () => {
    const card = await hoverCellAt(648);
    expect(card.querySelector('.insight-chart-tooltip')).toBeTruthy();
    // 中心 648+6=654 越过上界 → 钳到 660−74=586。
    // 旧实现拿外层滚动容器的 clientWidth（jsdom 里为 0）当上界，这条断言必失败。
    expect(card.querySelector('.pointer-events-none.absolute').style.left).toBe('586px');
  });

  test('热力图 tooltip 首列仍受下界约束', async () => {
    const card = await hoverCellAt(19);
    expect(card.querySelector('.pointer-events-none.absolute').style.left).toBe('74px');
  });

  test('compare card is gone; anomaly and allocation cards render', async () => {
    renderApp();
    await waitFor(() => {
      expect(screen.getByText('今日下载')).toBeInTheDocument();
      expect(screen.getByText('类型分布')).toBeInTheDocument();
      // the removed compare card's series headers must not leak back
      expect(screen.queryByText('7日 2 次')).not.toBeInTheDocument();
      expect(screen.queryByText('7日 850 个')).not.toBeInTheDocument();
    }, { timeout: 3000 });
  });

  test('「热门文件夹」已换成「近期下载」，渲染后端返回的下载文件', async () => {
    renderApp();
    await waitFor(() => expect(screen.getByText('近期下载')).toBeInTheDocument(), { timeout: 3000 });
    // 旧卡片不得残留
    expect(screen.queryByText('热门文件夹')).toBeNull();
    // 列表项：文件名（大小由 formatSize 渲染，随 mock 值变化，不锁具体文本）
    expect(screen.getByText('线性代数习题.pdf')).toBeInTheDocument();
    expect(screen.getByText('传热学讲义.pdf')).toBeInTheDocument();
  });

  test('anomaly toggle switches metric value, unit and title icon', async () => {
    renderApp();
    await waitFor(() => expect(screen.getByText('0 次下载')).toBeInTheDocument(), { timeout: 3000 });

    fireEvent.click(screen.getByRole('button', { name: '上传' }));
    await waitFor(() => expect(screen.getByText('0 次上传')).toBeInTheDocument());
    expect(document.querySelector('.bg-red svg.lucide-arrow-up')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '下载' }));
    await waitFor(() => expect(screen.getByText('0 次下载')).toBeInTheDocument());
    expect(document.querySelector('.bg-red svg.lucide-arrow-down')).toBeTruthy();
  });

  // 标题行只剩品牌块：时间范围切换（近 7/30/90 日）与刷新按钮已移除。
  // 数据改为「挂载时静默 revalidate 保鲜」，这两个控件再出现即为回归。
  test('标题行没有区间切换与刷新按钮', async () => {
    renderApp();
    await waitFor(() => expect(screen.getByText('类型分布')).toBeInTheDocument(), { timeout: 3000 });

    expect(screen.queryByRole('button', { name: '近 7 日' })).toBeNull();
    expect(screen.queryByRole('button', { name: '近 30 日' })).toBeNull();
    expect(screen.queryByRole('button', { name: '近 90 日' })).toBeNull();
    expect(screen.queryByRole('button', { name: '刷新' })).toBeNull();
    expect(screen.getByRole('heading', { name: '统计面板' })).toBeInTheDocument();
  });
});
