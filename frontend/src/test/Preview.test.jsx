import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Preview from '../components/Preview/index.jsx';

// 第一阶段：PDF 内嵌签名 URL、TXT 取回按纯文本渲染，其余类型仍走下载提示。
// 这里守住几条容易写反的行为——取数只对可预览类型发生、URL 失败可重试、
// 文本取回失败要落到「下载」而不是卡在 loading、下载失败就地报错。
const getFileUrlMock = vi.fn();
const downloadFileByIdMock = vi.fn();

vi.mock('../api.js', () => ({
  default: { get: vi.fn(), post: vi.fn() },
  TOKEN_KEY: 'zyxf_token',
  getFileUrl: (...args) => getFileUrlMock(...args),
}));

vi.mock('../utils.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, downloadFileById: (...args) => downloadFileByIdMock(...args) };
});

const pdfFile = { id: 7, name: 'test.pdf', ext: 'pdf', size: 1024 };
const txtFile = { id: 8, name: 'notes.txt', ext: 'txt', size: 20 };
const zipFile = { id: 9, name: 'pack.zip', ext: 'zip', size: 4096 };
const FIND = { timeout: 3000 };

const okText = (text) => ({
  ok: true,
  arrayBuffer: async () => new TextEncoder().encode(text).buffer,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn());
  // jsdom 不实现 Object URL，PdfViewer 依赖它把 PDF 变成可内嵌的 blob:
  URL.createObjectURL = vi.fn(() => 'blob:mock-pdf');
  URL.revokeObjectURL = vi.fn();
});

describe('Preview：PDF 走浏览器原生阅读器', () => {
  test('取回 PDF 后转 blob URL 渲染 iframe（绕开 OSS 的强制下载）', async () => {
    getFileUrlMock.mockResolvedValue({ url: 'https://oss.test/signed.pdf' });
    fetch.mockResolvedValue({ ok: true, blob: async () => ({ type: 'application/pdf' }) });

    render(<Preview file={pdfFile} onClose={() => {}} />);

    const frame = await screen.findByTitle('test.pdf', {}, FIND);
    expect(frame.tagName).toBe('IFRAME');
    expect(frame.getAttribute('src')).toBe('blob:mock-pdf');
    expect(fetch).toHaveBeenCalledWith('https://oss.test/signed.pdf');
  });

  test('取 PDF 失败：提示下载，不卡在 loading', async () => {
    getFileUrlMock.mockResolvedValue({ url: 'https://oss.test/signed.pdf' });
    fetch.mockResolvedValue({ ok: false, status: 403 });

    render(<Preview file={pdfFile} onClose={() => {}} />);

    expect(await screen.findByText('PDF 加载失败，请下载后查看', {}, FIND)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下载文件' })).toBeInTheDocument();
  });

  test('签名 URL 失败：显示错误与「重新加载」，重试成功后渲染 iframe', async () => {
    getFileUrlMock.mockRejectedValueOnce(new Error('signed url down'));
    getFileUrlMock.mockResolvedValue({ url: 'https://oss.test/retry.pdf' });
    fetch.mockResolvedValue({ ok: true, blob: async () => ({ type: 'application/pdf' }) });
    render(<Preview file={pdfFile} onClose={() => {}} />);

    expect(await screen.findByText('signed url down', {}, FIND)).toBeInTheDocument();
    expect(screen.queryByTitle('test.pdf')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));

    expect(await screen.findByTitle('test.pdf', {}, FIND)).toBeInTheDocument();
    await waitFor(() => expect(getFileUrlMock).toHaveBeenCalledTimes(2), FIND);
  });
});

describe('Preview：TXT 取回后按纯文本渲染', () => {
  test('渲染文本内容而不是 iframe', async () => {
    getFileUrlMock.mockResolvedValue({ url: 'https://oss.test/signed.txt' });
    fetch.mockResolvedValue(okText('第一行\n第二行'));

    render(<Preview file={txtFile} onClose={() => {}} />);

    expect(await screen.findByText(/第二行/, {}, FIND)).toBeInTheDocument();
    expect(screen.queryByTitle('notes.txt')).toBeNull();
    expect(fetch).toHaveBeenCalledWith('https://oss.test/signed.txt');
  });

  test('取文本失败：提示下载，不把浮层卡在 loading', async () => {
    getFileUrlMock.mockResolvedValue({ url: 'https://oss.test/signed.txt' });
    fetch.mockResolvedValue({ ok: false, status: 403 });

    render(<Preview file={txtFile} onClose={() => {}} />);

    expect(await screen.findByText('文本加载失败，请下载后查看', {}, FIND)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下载文件' })).toBeInTheDocument();
  });
});

describe('Preview：不可预览类型', () => {
  test('压缩包不发起任何取数请求，直接给出下载提示', () => {
    render(<Preview file={zipFile} onClose={() => {}} />);

    expect(screen.getByText('预览服务出错，暂时无法在线预览')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下载文件' })).toBeInTheDocument();
    expect(getFileUrlMock).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('Preview：下载', () => {
  test('点「下载文件」走 downloadFileById，失败就地显示错误', async () => {
    downloadFileByIdMock.mockRejectedValue(new Error('oss 403'));
    const onClose = vi.fn();
    render(<Preview file={zipFile} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: '下载文件' }));

    await waitFor(() => expect(downloadFileByIdMock).toHaveBeenCalledTimes(1), FIND);
    expect(downloadFileByIdMock.mock.calls[0][0]).toBe(zipFile);
    expect(await screen.findByText('oss 403', {}, FIND)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  test('右上角关闭按钮触发 onClose', () => {
    const onClose = vi.fn();
    render(<Preview file={zipFile} onClose={onClose} />);

    fireEvent.click(screen.getByTitle('关闭'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
