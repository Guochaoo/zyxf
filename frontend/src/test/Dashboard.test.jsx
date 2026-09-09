import { describe, test, expect, vi } from 'vitest';
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
});
