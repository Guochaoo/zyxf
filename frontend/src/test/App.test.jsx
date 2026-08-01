import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App.jsx';
import { AuthProvider } from '../auth.jsx';

// The real Grainient/SearchBar/StaggeredMenu rely on WebGL or heavy
// animation; jsdom has neither, so stub them with lightweight stand-ins.
vi.mock('../components/Grainient.jsx', () => ({ default: () => null }));
vi.mock('../components/SearchBar.jsx', () => ({
  default: () => <input aria-label="搜索" placeholder="搜索" />,
}));
vi.mock('../components/StaggeredMenu.jsx', () => ({ default: () => null }));

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
    <MemoryRouter initialEntries={[initialPath]}>
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

  test('active nav highlight follows the route', async () => {
    renderApp('/dashboard');
    await waitFor(() => expect(screen.getByText('仲英学辅资料库')).toBeInTheDocument());
    const statsLink = screen.getByRole('link', { name: '查看统计仪表盘' });
    expect(statsLink.className).toContain('is-active');
  });

  test('unknown routes redirect home', async () => {
    renderApp('/nope');
    await waitFor(() => expect(screen.getByText('仲英学辅资料库')).toBeInTheDocument());
    const browseLink = screen.getByRole('link', { name: '浏览资料库' });
    expect(browseLink.className).toContain('is-active');
  });
});
