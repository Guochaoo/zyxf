import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Preview from '../components/Preview/index.jsx';

// IMPROVE-58 第 5 组：Preview 自身没有测试。它的取数是「签名 URL + WebOffice 凭证」
// 并行发起、失败语义**不对称**（URL 失败致命可重试，凭证失败只降级），这条不对称
// 一旦写反（比如把凭证失败也当致命）整页预览会白屏，而单测里没有任何断言守着。
const getFileUrlMock = vi.fn();
const getWebofficeTokenMock = vi.fn();

vi.mock('../api.js', () => ({
  default: { get: vi.fn(), post: vi.fn() },
  TOKEN_KEY: 'zyxf_token',
  getFileUrl: (...args) => getFileUrlMock(...args),
  getWebofficeToken: (...args) => getWebofficeTokenMock(...args),
}));

// 把 viewer 换成探针：只暴露 Preview 交给它的 props，避免把 OfficeViewer 的
// 外链脚本加载引进用例。
vi.mock('../components/Preview/Body.jsx', () => ({
  default: ({ kind, signedUrl, wbToken, fileId }) => (
    <div
      data-testid="preview-body"
      data-kind={kind}
      data-url={signedUrl ?? ''}
      data-wb={wbToken ? 'yes' : 'no'}
      data-file={fileId}
    />
  ),
}));

const { __resetResourceStore } = await import('../data/resource.js');

const pdfFile = { id: 7, name: 'test.pdf', ext: 'pdf', size: 1024 };
const wbToken = { url: 'https://imm.test/office/test.pdf', token: 'tk', refresh_token: 'rt' };

beforeEach(() => {
  vi.clearAllMocks();
  __resetResourceStore();
});

const renderPreview = () => render(<Preview file={pdfFile} onClose={() => {}} />);
// 取数都走 Promise.allSettled，断言必须等异步落地；高负载机器上 1s 默认超时会抖，统一放宽
const FIND = { timeout: 3000 };

describe('Preview 取数：URL 失败致命、凭证失败降级', () => {
  test('签名 URL 失败 → 显示错误与「重新加载」，不渲染 viewer', async () => {
    getFileUrlMock.mockRejectedValue(new Error('signed url down'));
    getWebofficeTokenMock.mockResolvedValue(wbToken);

    renderPreview();

    expect(await screen.findByText('signed url down', {}, FIND)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新加载' })).toBeInTheDocument();
    expect(screen.queryByTestId('preview-body')).toBeNull();
  });

  test('凭证失败只降级：viewer 仍渲染，且 wbToken 传空、不显示错误', async () => {
    getFileUrlMock.mockResolvedValue({ url: 'https://oss.test/signed' });
    getWebofficeTokenMock.mockRejectedValue(new Error('imm 502'));

    renderPreview();

    const body = await screen.findByTestId('preview-body', {}, FIND);
    expect(body.dataset.wb).toBe('no');
    expect(body.dataset.url).toBe('https://oss.test/signed');
    expect(screen.queryByText('imm 502')).toBeNull();
    expect(screen.queryByRole('button', { name: '重新加载' })).toBeNull();
  });

  test('两者都成功：viewer 拿到 URL 与凭证，kind 由扩展名派生', async () => {
    getFileUrlMock.mockResolvedValue({ url: 'https://oss.test/signed' });
    getWebofficeTokenMock.mockResolvedValue(wbToken);

    renderPreview();

    const body = await screen.findByTestId('preview-body', {}, FIND);
    expect(body.dataset.wb).toBe('yes');
    expect(body.dataset.file).toBe('7');
    expect(body.dataset.kind).toBeTruthy();
  });

  test('致命失败后点「重新加载」会重取并渲染（失败态可恢复）', async () => {
    getFileUrlMock.mockRejectedValueOnce(new Error('transient'));
    getFileUrlMock.mockResolvedValue({ url: 'https://oss.test/retry-ok' });
    getWebofficeTokenMock.mockRejectedValue(new Error('imm 502'));

    renderPreview();

    expect(await screen.findByText('transient', {}, FIND)).toBeInTheDocument();
    expect(getFileUrlMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));

    const body = await screen.findByTestId('preview-body', {}, FIND);
    expect(body.dataset.url).toBe('https://oss.test/retry-ok');
    await waitFor(() => expect(getFileUrlMock).toHaveBeenCalledTimes(2), { timeout: 3000 });
  });

  test('URL 未就绪时下载按钮禁用，重取成功后可用', async () => {
    getFileUrlMock.mockRejectedValueOnce(new Error('transient'));
    getFileUrlMock.mockResolvedValue({ url: 'https://oss.test/late' });
    getWebofficeTokenMock.mockRejectedValue(new Error('imm 502'));

    renderPreview();

    expect(await screen.findByText('transient', {}, FIND)).toBeInTheDocument();
    expect(screen.getByTitle('下载')).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
    await waitFor(() => expect(screen.getByTitle('下载')).not.toBeDisabled(), { timeout: 3000 });
  });
});
