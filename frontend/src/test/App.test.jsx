import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App.jsx';
import { AuthProvider } from '../auth.jsx';

// The real SearchBar/StaggeredMenu rely on heavy animation; jsdom cannot run
// them, so stub them with lightweight stand-ins. Nav lives in StaggeredMenu
// on every layout, so the stub renders the menu items.
vi.mock('../components/SearchBar.jsx', () => ({
  default: () => <input aria-label="搜索" placeholder="搜索" />,
}));
vi.mock('../components/StaggeredMenu.jsx', () => ({
  default: ({ items }) => (
    <nav>
      {items.map((it) =>
        it.action ? (
          <button key={it.label} type="button" aria-label={it.ariaLabel} onClick={it.action}>
            {it.label}
          </button>
        ) : (
          <a key={it.label} href={it.link} aria-label={it.ariaLabel}>
            {it.label}
          </a>
        )
      )}
    </nav>
  ),
}));

const emptyFolder = { folder: { id: 0, name: '首页' }, breadcrumb: [], folders: [], files: [] };
const emptyStats = {
  range: 30,
  today_downloads: 0,
  yesterday_downloads: 0,
  downloads_7d: 0,
  downloads_prev_7d: 0,
  total_files: 0,
  total_folders: 0,
  total_size: 0,
  files_added_7d: 0,
  size_added_7d: 0,
  series: [],
  type_breakdown: [],
  top_downloads: [],
  recent_uploads: [],
  top_folders: [],
};

vi.mock('../api.js', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
  TOKEN_KEY: 'zyxf_token',
  login: vi.fn(),
  listFolder: vi.fn(() => Promise.resolve(emptyFolder)),
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
  getStats: vi.fn(() => Promise.resolve(emptyStats)),
  getHeatmap: vi.fn(() => Promise.resolve({ days: 365, series: [] })),
  search: vi.fn(() => Promise.resolve({ folders: [], files: [] })),
  uploadFile: vi.fn(),
}));

const api = (await import('../api.js')).default;
const { TOKEN_KEY } = await import('../api.js');

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

function renderApp(initialPath = '/') {
  return render(
    <MemoryRouter
      initialEntries={[initialPath]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>
  );
}

describe('App', () => {
  test('shows loading while auth is resolving', () => {
    localStorage.setItem(TOKEN_KEY, 't');
    api.get.mockImplementationOnce(() => new Promise(() => {})); // never resolves
    renderApp();
    expect(screen.getByText('加载中...')).toBeInTheDocument();
  });

  test('renders navigation for anonymous visitors', async () => {
    renderApp();
    expect(await screen.findByRole('link', { name: '浏览资料库' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '查看统计仪表盘' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '了解仲英书院学业辅导中心' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '管理员登录' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '退出登录' })).not.toBeInTheDocument();
  });

  test('shows logout for admins', async () => {
    localStorage.setItem(TOKEN_KEY, 't');
    api.get.mockResolvedValue({ data: { user: { id: 1, username: 'admin', role: 'admin' } } });
    renderApp();
    expect(await screen.findByRole('button', { name: '退出登录' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '管理员登录' })).not.toBeInTheDocument();
  });

  test('active nav item matches the route', async () => {
    renderApp('/dashboard');
    expect(await screen.findByText('统计面板')).toBeInTheDocument();
  });

  test('unknown routes redirect home', async () => {
    renderApp('/nope');
    expect(await screen.findByText('此文件夹为空')).toBeInTheDocument();
  });
});
