import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, createEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { setToken } from '../ui.js';

// IMPROVE-01：BrowsePage 拆成容器 + 数据/拖拽/同步 hook + 页面级展示件后，
// 用这组用例锁住拆分前的对外行为（渲染顺序、请求时序、管理入口可见性）。
const listFolderMock = vi.fn();
const reorderItemsMock = vi.fn();
const moveFileMock = vi.fn();
const syncOssMock = vi.fn();
const createFolderMock = vi.fn();
const apiGetMock = vi.fn();

vi.mock('../api.js', () => ({
  default: { get: (...a) => apiGetMock(...a), post: vi.fn() },
  TOKEN_KEY: 'zyxf_token',
  login: vi.fn(),
  register: vi.fn(),
  listFolder: (...a) => listFolderMock(...a),
  syncOss: (...a) => syncOssMock(...a),
  reorderItems: (...a) => reorderItemsMock(...a),
  moveFile: (...a) => moveFileMock(...a),
  moveFolder: vi.fn(),
  createFolder: (...a) => createFolderMock(...a),
  deleteFolder: vi.fn(),
  deleteFile: vi.fn(),
  renameFolder: vi.fn(),
  renameFile: vi.fn(),
  getFileUrl: vi.fn(),
}));

// 预览/上传弹窗会拉 OSS、IMM 等重依赖，本文件不测它们，用轻量替身。
vi.mock('../components/Preview/index.jsx', () => ({ default: () => <div data-testid="preview" /> }));
vi.mock('../components/UploadDialog.jsx', () => ({ default: () => <div data-testid="upload" /> }));

const { default: BrowsePage } = await import('../pages/BrowsePage.jsx');
const { AuthProvider } = await import('../auth.jsx');

// manual 排序的目录：items 给出「文件在前、文件夹在后」的交错顺序，
// 与 folders/files 两个数组的天然顺序不同——渲染必须以 items 为准（BUG-27）。
const MANUAL_PAYLOAD = {
  folder: { id: 0, name: '首页', parent_id: null },
  breadcrumb: [],
  folders: [
    { id: 1, name: '高等数学', size: 4096, created_at: 1700000000000, type: 'folder', sort_order: 1 },
  ],
  files: [
    { id: 10, name: '物理.pdf', size: 1024, ext: 'pdf', created_at: 1700000000000, type: 'file', sort_order: 0 },
    { id: 11, name: '化学.pdf', size: 2048, ext: 'pdf', created_at: 1700000000000, type: 'file', sort_order: 2 },
  ],
  items: [
    { id: 10, name: '物理.pdf', size: 1024, ext: 'pdf', created_at: 1700000000000, type: 'file', sort_order: 0 },
    { id: 1, name: '高等数学', size: 4096, created_at: 1700000000000, type: 'folder', sort_order: 1 },
    { id: 11, name: '化学.pdf', size: 2048, ext: 'pdf', created_at: 1700000000000, type: 'file', sort_order: 2 },
  ],
};

function renderPage() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>
        <BrowsePage />
      </AuthProvider>
    </MemoryRouter>
  );
}

// 管理员身份：写入 token 并让 /auth/me 返回 admin，等管理入口渲染出来再操作。
async function renderPageAsAdmin() {
  setToken('test-token');
  apiGetMock.mockResolvedValue({ data: { user: { id: 1, username: 'admin', role: 'admin' } } });
  const view = renderPage();
  await screen.findByText('新建文件夹');
  return view;
}

const rows = () => [...document.querySelectorAll('[data-glide-row]')];

function fakeDataTransfer() {
  return { setData: vi.fn(), getData: vi.fn(), effectAllowed: '', dropEffect: '' };
}

// jsdom 没有 DragEvent，RTL 退化成普通 Event —— clientY 必须手动挂上去，
// 否则落点计算拿到 undefined（NaN 比较恒为 false），永远判成「插到行之后」。
function dragEvent(type, el, { dataTransfer, clientY }) {
  const ev = createEvent[type](el, { dataTransfer });
  Object.defineProperty(ev, 'clientY', { value: clientY });
  return ev;
}

beforeEach(() => {
  [
    listFolderMock,
    reorderItemsMock,
    moveFileMock,
    syncOssMock,
    createFolderMock,
    apiGetMock,
  ].forEach((m) => m.mockReset());
  listFolderMock.mockResolvedValue(MANUAL_PAYLOAD);
  localStorage.clear();
});

describe('BrowsePage', () => {
  test('manual 排序下按后端 items 的交错顺序渲染（BUG-27）', async () => {
    renderPage();
    await screen.findByText('物理.pdf');

    expect(rows().map((r) => r.textContent)).toEqual([
      expect.stringContaining('物理.pdf'),
      expect.stringContaining('高等数学'),
      expect.stringContaining('化学.pdf'),
    ]);
  });

  test('后端未给 items 时回退「文件夹在前、文件在后」', async () => {
    const { items, ...noItems } = MANUAL_PAYLOAD;
    listFolderMock.mockResolvedValue(noItems);
    renderPage();
    await screen.findByText('物理.pdf');

    expect(rows().map((r) => r.textContent)).toEqual([
      expect.stringContaining('高等数学'),
      expect.stringContaining('物理.pdf'),
      expect.stringContaining('化学.pdf'),
    ]);
  });

  test('空文件夹显示空状态', async () => {
    listFolderMock.mockResolvedValue({
      folder: { id: 0, name: '首页', parent_id: null },
      breadcrumb: [],
      folders: [],
      files: [],
    });
    renderPage();
    expect(await screen.findByText('此文件夹为空')).toBeInTheDocument();
  });

  test('请求失败显示后端错误消息', async () => {
    listFolderMock.mockRejectedValue({ response: { data: { error: '文件夹不存在' } } });
    renderPage();
    expect(await screen.findByText('文件夹不存在')).toBeInTheDocument();
  });

  test('切换排序会用新字段重新请求；再次点击同一项切换升降序', async () => {
    renderPage();
    await screen.findByText('物理.pdf');
    expect(listFolderMock).toHaveBeenLastCalledWith(0, 'manual', 'asc', expect.anything());

    fireEvent.click(screen.getByRole('button', { name: /名称/ }));
    await waitFor(() => expect(listFolderMock).toHaveBeenLastCalledWith(0, 'name', 'asc', expect.anything()));

    fireEvent.click(screen.getByRole('button', { name: /名称/ }));
    await waitFor(() => expect(listFolderMock).toHaveBeenLastCalledWith(0, 'name', 'desc', expect.anything()));
  });

  test('访客看不到管理入口', async () => {
    renderPage();
    await screen.findByText('物理.pdf');
    expect(screen.queryByText('新建文件夹')).toBeNull();
    expect(screen.queryByText('上传')).toBeNull();
  });

  test('管理员可见管理入口', async () => {
    await renderPageAsAdmin();
    expect(await screen.findByText('上传')).toBeInTheDocument();
  });

  test('把文件拖到文件夹上触发 moveFile', async () => {
    await renderPageAsAdmin();
    const dt = fakeDataTransfer();
    const fileRow = rows()[0]; // 物理.pdf
    const folderRow = rows()[1]; // 高等数学
    fireEvent.dragStart(fileRow, { dataTransfer: dt });
    fireEvent.dragOver(folderRow, { dataTransfer: dt });
    fireEvent.drop(folderRow, { dataTransfer: dt });

    await waitFor(() => expect(moveFileMock).toHaveBeenCalledWith(10, 1));
  });

  // BUG-66：行的主操作原先只有 onClick，键盘用户完全够不到。
  // 主操作 = 进入文件夹（onEnterFolder → navigate(`/folder/<id>`）），
  // 因此把渲染挂在带 `:id` 的路由上，直接断言路由跳到 /folder/1。
  test('行是键盘可达的：Tab 到行后回车/空格可打开文件夹', async () => {
    const loc = { path: null };
    function LocationProbe() {
      loc.path = useLocation().pathname;
      return null;
    }
    listFolderMock.mockResolvedValue(MANUAL_PAYLOAD);
    render(
      <MemoryRouter
        initialEntries={['/']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <AuthProvider>
          <Routes>
            <Route path="/" element={<BrowsePage />} />
            <Route path="/folder/:id" element={<BrowsePage />} />
          </Routes>
          <LocationProbe />
        </AuthProvider>
      </MemoryRouter>
    );
    await screen.findByText('物理.pdf');
    const folderRow = rows().find((r) => r.textContent.includes('高等数学'));
    expect(folderRow).toHaveAttribute('role', 'button');
    expect(folderRow).toHaveAttribute('tabindex', '0');

    listFolderMock.mockClear();
    fireEvent.keyDown(folderRow, { key: 'Enter' });
    // 键盘 Enter 必须等价于点击：容器把行点击接到路由跳转上，跳转后再按 id=1 拉取目录
    // 第 4 个参数是 IMPROVE-54 加的 { signal }，数据层取消用
    await waitFor(() =>
      expect(listFolderMock).toHaveBeenCalledWith(1, 'manual', 'asc', expect.anything())
    );
    expect(loc.path).toBe('/folder/1');
  });

  test('拖到行的上半区触发重排，且顺序基准取自 items（BUG-27）', async () => {
    await renderPageAsAdmin();
    const dt = fakeDataTransfer();
    const [file10, , file11] = rows();
    // 行高 40 + clientY 0 → y 落在上半区 = 插到目标行之前
    file10.getBoundingClientRect = () => ({
      top: 0, left: 0, right: 100, bottom: 40, width: 100, height: 40, x: 0, y: 0,
    });

    fireEvent.dragStart(file11, { dataTransfer: dt });
    fireEvent(file10, dragEvent('dragOver', file10, { dataTransfer: dt, clientY: 0 }));
    fireEvent(file10, dragEvent('drop', file10, { dataTransfer: dt, clientY: 0 }));

    // items 是 [文件10, 文件夹1, 文件11]；把文件11 插到文件10 之前 → [文件11, 文件10, 文件夹1]。
    // 若错误地以 folders+files 为基准，结果会是 [文件夹1, 文件11, 文件10]。
    await waitFor(() =>
      expect(reorderItemsMock).toHaveBeenCalledWith(null, [
        { type: 'file', id: 11 },
        { type: 'file', id: 10 },
        { type: 'folder', id: 1 },
      ])
    );
  });

  test('刷新按钮同步远端，并用 Toast 通知卡提示同步结果（主行短、明细在副行）', async () => {
    syncOssMock.mockResolvedValue({ added: { folders: 1, files: 2 }, removed: { files: 3 } });
    renderPage();
    await screen.findByText('物理.pdf');

    fireEvent.click(screen.getByTitle('刷新（同步远端资料库）'));

    const msg = await screen.findByText('同步完成');
    // 用的是登录/注册页同一个自定义组件（顶部 Toast 通知卡），不再是底部胶囊
    const card = msg.closest('.toast-card');
    expect(card).not.toBeNull();
    expect(card.className).toContain('toast-card--success');
    expect(card).toHaveAttribute('role', 'alert');
    // 明细放副行，主行不会被截断
    expect(card.textContent).toContain('新增 1 个文件夹 / 2 个文件，清理 3 个失效文件');
    // 同步完成后会重载当前文件夹
    await waitFor(() => expect(listFolderMock).toHaveBeenCalledTimes(2));
  });

  test('同步无变化时副行给出「无新增、无清理」', async () => {
    syncOssMock.mockResolvedValue({ added: {}, removed: {} });
    renderPage();
    await screen.findByText('物理.pdf');

    fireEvent.click(screen.getByTitle('刷新（同步远端资料库）'));

    const msg = await screen.findByText('同步完成');
    expect(msg.closest('.toast-card').textContent).toContain('无新增、无清理');
  });

  test('同步失败时同样走 Toast，但类型为 error', async () => {
    syncOssMock.mockRejectedValue({ response: { data: { error: 'OSS 不可用' } } });
    renderPage();
    await screen.findByText('物理.pdf');

    fireEvent.click(screen.getByTitle('刷新（同步远端资料库）'));

    const msg = await screen.findByText('OSS 不可用');
    expect(msg.closest('.toast-card').className).toContain('toast-card--error');
  });
});
