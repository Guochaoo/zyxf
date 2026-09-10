import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { setToken } from '../ui.js';
import ChatComposer from '../components/ChatComposer.jsx';

// chatStream 由各用例注入实现
const chatStreamMock = vi.fn();
// 服务端 AI 状态：默认「未配置」，使既有用例保持「上传用户配置」的行为
const getChatStatusMock = vi.fn();
// AuthProvider 只在 localStorage 有 token 时调 /auth/me —— 用它模拟已登录用户
const apiGetMock = vi.fn();
vi.mock('../api.js', () => ({
  default: { get: (...args) => apiGetMock(...args), post: vi.fn() },
  TOKEN_KEY: 'zyxf_token',
  login: vi.fn(),
  register: vi.fn(),
  getFileUrl: vi.fn(),
  getChatStatus: (...args) => getChatStatusMock(...args),
  chatStream: (...args) => chatStreamMock(...args),
}));

const { AuthProvider } = await import('../auth.jsx');

// 设置入口改为打开全局设置弹窗，由上层传入回调。
const onOpenSettingsMock = vi.fn();

function renderPanel() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <ChatComposer onOpenSettings={onOpenSettingsMock} />
      </AuthProvider>
    </MemoryRouter>
  );
}

// 已登录场景：写入 token 并让 /auth/me 返回用户，等鉴权落定再操作
// （登录前「服务端未配置 + 已存自带 Key」会禁用输入，见 IMPROVE-10）。
async function renderPanelAuthed() {
  setToken('test-token');
  apiGetMock.mockResolvedValue({ data: { user: { id: 1, username: 'u', role: 'user' } } });
  const view = renderPanel();
  await waitFor(() => expect(screen.getByLabelText('聊天输入')).not.toBeDisabled());
  return view;
}

function typeAndSend(text) {
  fireEvent.change(screen.getByLabelText('聊天输入'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
}

beforeEach(() => {
  chatStreamMock.mockReset();
  getChatStatusMock.mockReset();
  getChatStatusMock.mockResolvedValue({ enabled: false });
  apiGetMock.mockReset();
  onOpenSettingsMock.mockReset();
  localStorage.clear();
});

describe('ChatComposer', () => {
  test('renders the 智能对话 label and welcome state', () => {
    renderPanel();
    expect(screen.getByText('智能对话')).toBeInTheDocument();
    expect(screen.getByText('问我资料在哪，我来帮你找：')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '高数往年题在哪' })).toBeInTheDocument();
    // 垃圾桶在空会话时禁用
    expect(screen.getByRole('button', { name: '清空会话历史' })).toBeDisabled();
  });

  test('streams a reply with the Section style and file cards', async () => {
    chatStreamMock.mockImplementation(async (messages, { onDelta, onFiles }) => {
      expect(messages.at(-1)).toEqual({ role: 'user', content: '高数往年题在哪' });
      onDelta('推荐');
      onDelta('【文件1】');
      onFiles([{ id: 1, name: '高等数学期末版.pdf', type: 'file', folder_path: '高等数学', ext: 'pdf' }]);
    });

    renderPanel();
    typeAndSend('高数往年题在哪');

    await waitFor(() => expect(screen.getByText('推荐【文件1】')).toBeInTheDocument());
    expect(screen.getByText('完成')).toBeInTheDocument();
    expect(screen.getByText('高等数学期末版.pdf')).toBeInTheDocument();
    expect(screen.getByText('PDF')).toBeInTheDocument();
  });

  test('shows the error message when the API fails', async () => {
    chatStreamMock.mockRejectedValue(new Error('AI 功能未配置'));

    renderPanel();
    typeAndSend('你好');

    await waitFor(() => expect(screen.getByText('AI 功能未配置')).toBeInTheDocument());
    expect(screen.getByText('出错')).toBeInTheDocument();
  });

  test('trash button clears the conversation', async () => {
    chatStreamMock.mockImplementation(async () => {});
    renderPanel();
    typeAndSend('hi');
    await waitFor(() =>
      expect(screen.queryByText('问我资料在哪，我来帮你找：')).not.toBeInTheDocument()
    );

    const trash = screen.getByRole('button', { name: '清空会话历史' });
    await waitFor(() => expect(trash).not.toBeDisabled());
    fireEvent.click(trash);
    expect(screen.getByText('问我资料在哪，我来帮你找：')).toBeInTheDocument();
  });

  // 齿轮不再就地展开表单，而是把设置交给上层弹窗（AI 配置项在弹窗内维护）。
  test('齿轮按钮触发上层打开设置弹窗', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'AI 设置' }));
    expect(onOpenSettingsMock).toHaveBeenCalledTimes(1);
    // 面板内不应出现就地编辑的配置表单
    expect(screen.queryByPlaceholderText('sk-…')).toBeNull();
  });

  test('本地已保存配置会随请求下发（服务端未配置时）', async () => {
    localStorage.setItem(
      'zyxf_llm',
      JSON.stringify({ apiKey: 'test-key', baseUrl: 'https://llm.test/v1', model: 'glm-4.6' })
    );
    chatStreamMock.mockImplementation(async () => {});
    await renderPanelAuthed();

    typeAndSend('你好');
    await waitFor(() => expect(chatStreamMock).toHaveBeenCalled());
    const opts = chatStreamMock.mock.calls[0][1];
    expect(opts.llm).toEqual({ apiKey: 'test-key', baseUrl: 'https://llm.test/v1', model: 'glm-4.6' });
  });

  test('本地无配置时不下发 llm 字段', async () => {
    chatStreamMock.mockImplementation(async () => {});
    renderPanel();

    typeAndSend('你好');
    await waitFor(() => expect(chatStreamMock).toHaveBeenCalled());
    expect(chatStreamMock.mock.calls[0][1].llm).toBeUndefined();
  });

  test('服务端已配置 AI 时不再上传用户自带 Key', async () => {
    getChatStatusMock.mockResolvedValue({ enabled: true });
    localStorage.setItem(
      'zyxf_llm',
      JSON.stringify({ apiKey: 'test-key', baseUrl: 'https://llm.test/v1', model: 'glm-4.6' })
    );
    chatStreamMock.mockImplementation(async () => {});
    renderPanel();

    // 等状态接口落定后再发送（真实场景下该请求毫秒级返回）
    await waitFor(() => expect(getChatStatusMock).toHaveBeenCalled());
    typeAndSend('你好');
    await waitFor(() => expect(chatStreamMock).toHaveBeenCalled());
    // 用户 Key 不应出现在请求中（后端已配置时会忽略它）
    expect(chatStreamMock.mock.calls[0][1].llm).toBeUndefined();
  });

  test('服务端未配置 AI 时仍上传用户自带 Key', async () => {
    getChatStatusMock.mockResolvedValue({ enabled: false });
    localStorage.setItem(
      'zyxf_llm',
      JSON.stringify({ apiKey: 'test-key', baseUrl: 'https://llm.test/v1', model: 'glm-4.6' })
    );
    chatStreamMock.mockImplementation(async () => {});
    await renderPanelAuthed();

    await waitFor(() => expect(getChatStatusMock).toHaveBeenCalled());
    typeAndSend('你好');
    await waitFor(() => expect(chatStreamMock).toHaveBeenCalled());
    expect(chatStreamMock.mock.calls[0][1].llm).toEqual({
      apiKey: 'test-key',
      baseUrl: 'https://llm.test/v1',
      model: 'glm-4.6',
    });
  });

  // IMPROVE-10：服务端未配置 AI 时，自带 Key 的路由后端要求登录——前端提前禁用并说明原因。
  test('服务端未配置 + 未登录 + 已存自带 Key：禁用输入并提示登录', async () => {
    getChatStatusMock.mockResolvedValue({ enabled: false });
    localStorage.setItem(
      'zyxf_llm',
      JSON.stringify({ apiKey: 'test-key', baseUrl: 'https://llm.test/v1', model: 'glm-4.6' })
    );
    renderPanel();

    await waitFor(() => expect(screen.getByLabelText('聊天输入')).toBeDisabled());
    expect(screen.getByText('登录后才能使用自带 Key 的 AI 对话')).toBeInTheDocument();
    // 建议词条一并隐藏：否则点了不会有任何反应
    expect(screen.queryByRole('button', { name: '高数往年题在哪' })).toBeNull();
    expect(chatStreamMock).not.toHaveBeenCalled();
  });

  // 未登录但也没有自带 Key 时不拦：那种情况后端返回 503「AI 功能未配置」，
  // 让用户看到真实原因，比提示登录更准确。
  test('服务端未配置 + 未登录 + 无自带 Key：不提示登录', async () => {
    getChatStatusMock.mockResolvedValue({ enabled: false });
    renderPanel();

    await waitFor(() => expect(getChatStatusMock).toHaveBeenCalled());
    expect(screen.getByLabelText('聊天输入')).not.toBeDisabled();
    expect(screen.queryByText('登录后才能使用自带 Key 的 AI 对话')).toBeNull();
  });
});
