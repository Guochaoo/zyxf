// Confirm the footer attribution renders with both the zh and en labels,
// and that the link points at the retained licence text.
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '../i18n/index.js';

const { AuthProvider } = await import('../auth.jsx');

// 审计：原先 stub 全局 fetch 是死代码（页面走 axios/XHR），且不 mock api 模块时
// 每次运行都向 jsdom 默认 origin 发真实请求、靠连接失败进错误态。改为标准 mock。
vi.mock('../api.js', () => ({
  default: { get: vi.fn(), post: vi.fn() },
  TOKEN_KEY: 'zyxf_token',
  listFolder: vi.fn(() =>
    Promise.resolve({ folder: { id: 0, name: '首页' }, breadcrumb: [], folders: [], files: [] })
  ),
  getFolderTree: vi.fn(() => Promise.resolve({ tree: [], files: [] })),
  createFolder: vi.fn(),
  deleteFolder: vi.fn(),
  deleteFile: vi.fn(),
  renameFile: vi.fn(),
  renameFolder: vi.fn(),
  getFileUrl: vi.fn(),
}));
const { default: BrowsePage } = await import('../pages/BrowsePage.jsx');

function renderAt(path) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <BrowsePage />
        </AuthProvider>
      </MemoryRouter>
    </I18nextProvider>
  );
}

describe('页脚字体署名', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh');
  });

  test('首页页脚有 OPPO Sans 署名，且链接指向保留的授权协议', async () => {
    renderAt('/');
    const link = await screen.findByRole('link', { name: 'OPPO Sans' });
    expect(link).toHaveAttribute('href', '/licenses/OPPO-Sans-4.0-License.txt');
    // 与备案号同行
    expect(screen.getByRole('link', { name: /陕ICP备/ })).toBeInTheDocument();
  });

  test('英文界面下显示 Font（不露中文）', async () => {
    await i18n.changeLanguage('en');
    renderAt('/');
    expect(await screen.findByText('Font')).toBeInTheDocument();
  });
});
