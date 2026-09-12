import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App.jsx';
import { AuthProvider } from '../auth.jsx';

const { __resetResourceStore } = await import('../data/resource.js');

// The real SearchBar/StaggeredMenu rely on heavy animation; jsdom cannot run
// them, so stub them with lightweight stand-ins. Nav lives in StaggeredMenu
// on every layout, so the stub renders the menu items.
vi.mock('../components/SearchBar.jsx', () => ({
  default: () => <input aria-label="搜索" placeholder="搜索" />,
}));
vi.mock('../components/StaggeredMenu.jsx', () => ({
  default: ({ items, account, onOpenSettings }) => (
    <nav>
      {onOpenSettings && (
        <button type="button" aria-label="设置" onClick={onOpenSettings}>
          设置
        </button>
      )}
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
      {account?.guest && (
        <button type="button" aria-label="登录" onClick={account.onLogin}>
          登录
        </button>
      )}
      {account && !account.guest && (
        <button type="button" aria-label="退出登录" onClick={account.onLogout}>
          退出登录
        </button>
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
  // IMPROVE-56 审计跟进：resource store 是模块级缓存，不重置的话从第 2 个用例起测的是「陈旧缓存 + 后台刷新」而非全新挂载。
  __resetResourceStore();
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
    expect(screen.getByRole('button', { name: '登录' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '退出登录' })).not.toBeInTheDocument();
  });

  test('shows logout for admins', async () => {
    localStorage.setItem(TOKEN_KEY, 't');
    api.get.mockResolvedValue({ data: { user: { id: 1, username: 'admin', role: 'admin' } } });
    renderApp();
    expect(await screen.findByRole('button', { name: '退出登录' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '登录' })).not.toBeInTheDocument();
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


// 设置是真实路由 /settings（手机端二级页面 = /settings/:section），
// 所以系统返回手势由路由天然接管，且弹窗打开时背后仍是原页面。
describe('App · 设置路由', () => {
  test('打开设置会切到 /settings，并在原页面之上渲染设置（背后页面不卸载）', async () => {
    // 预置一份完整配置，走「使用自定义配置」态，字段才会渲染
    localStorage.setItem(
      'zyxf_llm',
      JSON.stringify({ apiKey: 'sk-1', baseUrl: 'https://llm.test/v1', model: 'glm-4.6' })
    );
    renderApp();
    expect(await screen.findByText('此文件夹为空')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '设置' }));

    // 设置界面出现：板块列表 + 默认板块内容
    expect(screen.getByRole('button', { name: '账户信息' })).toBeInTheDocument();
    expect(screen.getByLabelText('API Key')).toBeInTheDocument();
    // 背后仍是资料库页面（背景位置照常渲染）
    expect(screen.getByText('此文件夹为空')).toBeInTheDocument();
  });

  test('直接访问 /settings 也能打开设置，且背后渲染资料库而不是被重定向', async () => {
    renderApp('/settings');
    expect(screen.getByRole('button', { name: '智能对话配置' })).toBeInTheDocument();
    expect(await screen.findByText('此文件夹为空')).toBeInTheDocument();
  });

  test('/settings/:section 深链直接进入对应板块', async () => {
    renderApp('/settings/appearance');
    expect(await screen.findByText('字体和语言')).toBeInTheDocument();
  });

  test('关闭设置后回到原页面（历史里不留 /settings 残影）', async () => {
    renderApp();
    fireEvent.click(await screen.findByRole('button', { name: '设置' }));
    expect(screen.getByRole('button', { name: '账户信息' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '关闭' }));

    expect(screen.queryByRole('button', { name: '账户信息' })).toBeNull();
    expect(screen.getByText('此文件夹为空')).toBeInTheDocument();
  });
});