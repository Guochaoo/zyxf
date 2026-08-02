import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('axios', () => {
  const reqHandlers = [];
  const resHandlers = [];
  const instance = {
    interceptors: {
      request: { use: (fn) => reqHandlers.push(fn) },
      response: { use: (fn, errFn) => resHandlers.push({ ok: fn, err: errFn }) },
    },
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  };
  return {
    default: {
      create: () => instance,
      post: vi.fn(), // used by uploadFile for the direct-to-OSS POST
      __instance: instance,
      __reqHandlers: reqHandlers,
      __resHandlers: resHandlers,
    },
  };
});

// Imported after axios is mocked (vi.mock is hoisted above these).
import axios from 'axios';
import api, { TOKEN_KEY, login, uploadFile } from '../api.js';

const instance = axios.__instance;
const reqHandlers = axios.__reqHandlers;
const resHandlers = axios.__resHandlers;

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('request interceptor', () => {
  test('attaches Bearer token when present', () => {
    localStorage.setItem(TOKEN_KEY, 'secret-token');
    const config = { headers: {} };
    reqHandlers[0](config);
    expect(config.headers.Authorization).toBe('Bearer secret-token');
  });

  test('does nothing without a token', () => {
    const config = { headers: {} };
    reqHandlers[0](config);
    expect(config.headers.Authorization).toBeUndefined();
  });
});

describe('response interceptor', () => {
  test('on 401 clears the token and notifies the app', async () => {
    localStorage.setItem(TOKEN_KEY, 'expired');
    const dispatched = [];
    window.addEventListener('auth:expired', () => dispatched.push(1));

    const { err: errFn } = resHandlers[0];
    await errFn({ response: { status: 401 } }).catch(() => {});

    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(dispatched).toHaveLength(1);
  });

  test('non-401 errors keep the token and reject', async () => {
    localStorage.setItem(TOKEN_KEY, 'keep');
    const { err: errFn } = resHandlers[0];
    await expect(errFn({ response: { status: 500 } })).rejects.toMatchObject({
      response: { status: 500 },
    });
    expect(localStorage.getItem(TOKEN_KEY)).toBe('keep');
  });
});

describe('login', () => {
  test('posts credentials to /auth/login', async () => {
    instance.post.mockResolvedValue({ data: { token: 't', user: { id: 1 } } });
    const data = await login('admin', 'pw');
    expect(instance.post).toHaveBeenCalledWith('/auth/login', { username: 'admin', password: 'pw' });
    expect(data.user.id).toBe(1);
  });
});

describe('uploadFile', () => {
  test('gets a policy, uploads to OSS, then registers metadata', async () => {
    const policy = {
      key: 'zyxf-test/a.pdf',
      policy: 'base64',
      OSSAccessKeyId: 'ak',
      signature: 'sig',
      success_action_status: '200',
      host: 'https://oss.test',
    };
    instance.post.mockResolvedValueOnce({ data: policy }).mockResolvedValueOnce({ data: { id: 42 } });
    axios.post.mockResolvedValue({});

    const file = new File(['x'], 'a.pdf', { type: 'application/pdf' });
    const result = await uploadFile({ file, folderId: 1 });

    expect(instance.post).toHaveBeenNthCalledWith(1, '/files/upload-url', {
      filename: 'a.pdf',
      folder_id: 1,
    });
    expect(axios.post).toHaveBeenCalledWith('https://oss.test', expect.any(FormData), expect.anything());
    expect(instance.post).toHaveBeenNthCalledWith(2, '/files', {
      name: 'a.pdf',
      oss_key: 'zyxf-test/a.pdf',
      size: 1,
      mime_type: 'application/pdf',
      folder_id: 1,
    });
    expect(result).toEqual({ id: 42 });
  });

  test('cleans up the orphaned object when registration fails', async () => {
    const policy = {
      key: 'zyxf-test/a.pdf',
      policy: 'p',
      OSSAccessKeyId: 'a',
      signature: 's',
      success_action_status: '200',
      host: 'https://oss.test',
    };
    instance.post.mockResolvedValueOnce({ data: policy }).mockRejectedValueOnce(new Error('boom'));
    axios.post.mockResolvedValue({});

    await expect(uploadFile({ file: new File(['x'], 'a.pdf'), folderId: null })).rejects.toThrow('boom');
    expect(instance.post).toHaveBeenCalledWith('/files/cleanup-upload', { oss_key: 'zyxf-test/a.pdf' });
  });
});
