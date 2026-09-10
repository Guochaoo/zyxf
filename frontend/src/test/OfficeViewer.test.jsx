import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import OfficeViewer from '../components/Preview/OfficeViewer.jsx';

vi.mock('../api.js', () => ({
  refreshWebofficeToken: vi.fn(),
}));

const SDK_SELECTOR = 'script[data-weboffice-sdk]';
const sdkScripts = () => document.querySelectorAll(SDK_SELECTOR);

// Office 预览依赖外链 SDK（g.alicdn.com）：一次 CDN 抖动/断网之后必须还能恢复，
// 否则本次会话内所有 Office 预览都直接落到「预览服务出错」，只能整页刷新（BUG-60）。
describe('OfficeViewer SDK 加载失败后自恢复（BUG-60）', () => {
  beforeEach(() => {
    delete window.aliyun;
    document.querySelectorAll(SDK_SELECTOR).forEach((el) => el.remove());
  });

  test('首次加载失败 → 重新挂载后重新请求并成功渲染', async () => {
    const token = { url: 'https://imm.test/office', token: 'tok', refresh_token: 'rtok' };

    const first = render(<OfficeViewer wbToken={token} fileId={1} name="a.docx" />);
    await waitFor(() => expect(sdkScripts().length).toBe(1));

    // 模拟 CDN 请求失败：script 触发 error
    sdkScripts()[0].dispatchEvent(new Event('error'));
    await waitFor(() => expect(screen.getByText('预览服务出错，暂时无法在线预览')).toBeInTheDocument());
    // 失败的 script 必须被移除，否则重试会拿到一个已 error 过、不会再 settle 的标签
    expect(sdkScripts().length).toBe(0);

    first.unmount();

    // 用户重试（重新进入预览）：必须重新插入 script，而不是复用被拒绝的模块级 Promise
    window.aliyun = { config: vi.fn(() => ({ setToken: vi.fn() })) };
    const second = render(<OfficeViewer wbToken={token} fileId={1} name="a.docx" />);

    await waitFor(() => expect(window.aliyun.config).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText('预览服务出错，暂时无法在线预览')).toBeNull());
    second.unmount();
  });
});
