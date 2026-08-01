import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.mock('../api.js', () => {
  const api = { get: vi.fn(), post: vi.fn() };
  return {
    default: api,
    TOKEN_KEY: 'zyxf_token',
    login: vi.fn(),
  };
});

const api = (await import('../api.js')).default;
const { TOKEN_KEY, login: loginApi } = await import('../api.js');

const { AuthProvider, useAuth } = await import('../auth.jsx');

function renderAuth() {
  return renderHook(() => useAuth(), { wrapper: AuthProvider });
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('AuthProvider', () => {
  test('starts ready with no user when there is no token', async () => {
    const { result } = renderAuth();
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.user).toBeNull();
    expect(result.current.isAdmin).toBe(false);
  });

  test('fetches the profile when a token exists', async () => {
    localStorage.setItem(TOKEN_KEY, 't');
    api.get.mockResolvedValue({ data: { user: { id: 1, username: 'admin', role: 'admin' } } });

    const { result } = renderAuth();
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(api.get).toHaveBeenCalledWith('/auth/me');
    expect(result.current.user.username).toBe('admin');
    expect(result.current.isAdmin).toBe(true);
  });

  test('clears the user when /auth/me fails', async () => {
    localStorage.setItem(TOKEN_KEY, 'bad');
    api.get.mockRejectedValue(new Error('401'));

    const { result } = renderAuth();
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.user).toBeNull();
  });

  test('login stores the token and sets the user', async () => {
    loginApi.mockResolvedValue({ token: 'new-token', user: { id: 2, username: 'u', role: 'admin' } });
    const { result } = renderAuth();
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => {
      await result.current.login('u', 'pw');
    });
    expect(localStorage.getItem(TOKEN_KEY)).toBe('new-token');
    expect(result.current.user.username).toBe('u');
  });

  test('logout clears token and user', async () => {
    localStorage.setItem(TOKEN_KEY, 't');
    api.get.mockResolvedValue({ data: { user: { id: 1, role: 'admin' } } });
    const { result } = renderAuth();
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => result.current.logout());
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(result.current.user).toBeNull();
    expect(result.current.isAdmin).toBe(false);
  });

  test('reacts to the auth:expired event (401 anywhere)', async () => {
    const { result } = renderAuth();
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => {
      window.dispatchEvent(new CustomEvent('auth:expired'));
    });
    expect(result.current.user).toBeNull();
  });
});
