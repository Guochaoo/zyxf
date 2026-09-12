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
        top_folders: [],
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

  // BUG-57：区间切换的竞态防护（数据层键隔离 + 迟到响应守卫）。
  // 审计修正：旧写法 mockReset 摧毁工厂默认实现（乱序运行会让后续用例崩），
  // 且迟到响应在键切换前就落地、根本测不到竞态。改为数据层下真正可达的时序：
  // 7 日响应在当前键上迟到落地必须生效；回 30 日后七日数据不得串键。
  test('过期响应不覆盖新区间统计', async () => {
    const { getStats } = await import('../api.js');
    getStats.mockClear();

    const base = (range, today) => ({
      range,
      today_downloads: today,
      yesterday_downloads: 0,
      downloads_7d: 0,
      downloads_prev_7d: 0,
      total_files: 10,
      total_folders: 2,
      total_size: 100,
      files_added_7d: 1,
      size_added_7d: 1,
      series: [],
      type_breakdown: [],
      top_downloads: [],
      recent_uploads: [],
      top_folders: [],
    });

    let resolveSeven;
    // 按序三次调用：①首屏 30 日立即返回；②切 7 日后挂起（模拟慢响应）；
    // ③回 30 日的后台 revalidate 返回新值。once 队列耗尽后工厂默认实现仍在，
    // --sequence.shuffle 乱序不会影响其他用例。
    getStats.mockImplementationOnce(() => Promise.resolve(base(30, 111)));
    getStats.mockImplementationOnce(() => new Promise((res) => { resolveSeven = res; }));
    getStats.mockImplementationOnce(() => Promise.resolve(base(30, 999)));

    renderApp();
    await waitFor(() => expect(screen.getByText('111 次下载')).toBeInTheDocument(), { timeout: 3000 });

    fireEvent.click(screen.getByRole('button', { name: '近 7 日' }));
    await waitFor(() => expect(getStats).toHaveBeenCalledTimes(2));

    // 迟到的 7 日响应：它仍属于当前键（stats:7），必须生效——
    // 不能因为「响应晚」被误判为过期丢弃；期间 keepPrevious 保持 30 日旧值展示。
    resolveSeven(base(7, 222));
    await waitFor(() => expect(screen.getByText('222 次下载')).toBeInTheDocument());

    // 回 30 日：命中缓存先呈现（瞬时），后台 revalidate 落地后换 999；
    // 七日数据不得串到 30 日视图。
    fireEvent.click(screen.getByRole('button', { name: '近 30 日' }));
    await waitFor(() => expect(screen.getByText('999 次下载')).toBeInTheDocument(), { timeout: 3000 });
    expect(screen.queryByText('222 次下载')).toBeNull();
    expect(screen.queryByText('111 次下载')).toBeNull();
    expect(screen.getByRole('button', { name: '近 30 日' })).toHaveAttribute('aria-pressed', 'true');
  });
});
