import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Preview from '../components/Preview/index.jsx';

// 在线预览下线后，浮层的职责只剩「提示无法在线预览 + 下载」：它不再取签名 URL
// 或 WebOffice 凭证。这里守住三件事——不再发请求、下载走带 download=1 的签名
// URL（限流与记账都在后端那条路径上）、失败要就地报错而不是静默。
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Preview：统一回退为下载提示', () => {
  test('打开即显示预览失败提示与下载按钮，且不发起任何取数请求', () => {
    render(<Preview file={pdfFile} onClose={() => {}} />);

    expect(screen.getByText('预览服务出错，暂时无法在线预览')).toBeInTheDocument();
    expect(screen.getByText('test.pdf')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下载文件' })).toBeInTheDocument();
    expect(getFileUrlMock).not.toHaveBeenCalled();
  });

  test('点「下载文件」走 downloadFileById（内部用 download=1 的签名 URL）', async () => {
    downloadFileByIdMock.mockResolvedValue(undefined);
    render(<Preview file={pdfFile} onClose={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: '下载文件' }));

    await waitFor(() => expect(downloadFileByIdMock).toHaveBeenCalledTimes(1));
    expect(downloadFileByIdMock.mock.calls[0][0]).toBe(pdfFile);
    // 第二个参数是 api 的 getFileUrl：下载链路必须复用同一签名入口
    expect(typeof downloadFileByIdMock.mock.calls[0][1]).toBe('function');
  });

  test('下载失败就地显示错误，不关闭浮层', async () => {
    downloadFileByIdMock.mockRejectedValue(new Error('oss 403'));
    const onClose = vi.fn();
    render(<Preview file={pdfFile} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: '下载文件' }));

    expect(await screen.findByText('oss 403')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  test('右上角关闭按钮触发 onClose', () => {
    const onClose = vi.fn();
    render(<Preview file={pdfFile} onClose={onClose} />);

    fireEvent.click(screen.getByTitle('关闭'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
