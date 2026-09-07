import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Mock the api module: requestRegisterCode/register become controllable fakes,
// mirroring the UploadDialog test idiom.
const requestRegisterCode = vi.fn();
const register = vi.fn();

vi.mock('../api.js', () => {
  const api = { get: vi.fn(), post: vi.fn() };
  return {
    default: api,
    TOKEN_KEY: 'zyxf_token',
    login: vi.fn(),
    register: (...args) => register(...args),
    requestRegisterCode: (...args) => requestRegisterCode(...args),
  };
});

// Silk 的 WebGL 动效在 jsdom 中无法运行，stub 掉。
vi.mock('../components/Silk.jsx', () => ({ default: () => null }));

const { default: AuthPage } = await import('../pages/AuthPage.jsx');
const { AuthProvider } = await import('../auth.jsx');

function renderPage(initialEntries = ['/register']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <AuthProvider>
        <AuthPage />
      </AuthProvider>
    </MemoryRouter>
  );
}

function fillForm({ username = 'newbie', email = 'stu@example.com', code = '123456', password = 'secret123' } = {}) {
  fireEvent.change(screen.getByLabelText('用户名'), { target: { value: username } });
  fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('邮箱验证码'), { target: { value: code } });
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: password } });
}

describe('AuthPage', () => {
  beforeEach(() => {
    localStorage.clear();
    requestRegisterCode.mockReset();
    register.mockReset();
  });

  test('renders the login form on /login', () => {
    renderPage(['/login']);
    expect(screen.getByText('欢迎回来')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '登录' })).toBeInTheDocument();
    expect(screen.queryByLabelText('邮箱验证码')).not.toBeInTheDocument();
  });

  test('renders the register form on /register', () => {
    renderPage(['/register']);
    expect(screen.getByText('注册账号')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '获取验证码' })).toBeInTheDocument();
  });

  test('switches forms in place via the footer links (no full page remount)', () => {
    renderPage(['/login']);
    fireEvent.click(screen.getByRole('link', { name: '注册账号' }));
    expect(screen.getByText('注册账号')).toBeInTheDocument();
    expect(screen.getByLabelText('邮箱验证码')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: '去登录' }));
    expect(screen.getByText('欢迎回来')).toBeInTheDocument();
  });

  test('code button is disabled until an email is entered', () => {
    renderPage();
    expect(screen.getByRole('button', { name: '获取验证码' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'stu@example.com' } });
    expect(screen.getByRole('button', { name: '获取验证码' })).toBeEnabled();
  });

  test('requests a code and starts the resend cooldown', async () => {
    requestRegisterCode.mockResolvedValue({ ok: true, cooldown: 60 });
    renderPage();
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'stu@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: '获取验证码' }));
    await waitFor(() => expect(requestRegisterCode).toHaveBeenCalledWith('stu@example.com'));
    expect(await screen.findByText(/60s 后重发/)).toBeInTheDocument();
  });

  test('shows the send error message when code request fails', async () => {
    requestRegisterCode.mockRejectedValue({ response: { data: { error: '该邮箱已被注册' } } });
    renderPage();
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'taken@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: '获取验证码' }));
    expect(await screen.findByText('该邮箱已被注册')).toBeInTheDocument();
    // 失败不进入冷却，可立即重试。
    expect(screen.getByRole('button', { name: '获取验证码' })).toBeEnabled();
  });

  test('submits the form and auto-logs in via register()', async () => {
    register.mockResolvedValue({ id: 2, username: 'newbie', role: 'user' });
    renderPage();
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: '注册' }));
    await waitFor(() =>
      expect(register).toHaveBeenCalledWith({
        username: 'newbie',
        email: 'stu@example.com',
        password: 'secret123',
        code: '123456',
      })
    );
    expect(screen.queryByText(/注册失败/)).not.toBeInTheDocument();
  });

  test('shows the backend error message on failed register', async () => {
    register.mockRejectedValue({ response: { data: { error: '验证码错误' } } });
    renderPage();
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: '注册' }));
    expect(await screen.findByText('验证码错误')).toBeInTheDocument();
  });
});
