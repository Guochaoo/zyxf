import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { showBootError } from '../bootError.js';
import i18n from '../i18n/index.js';

// 白屏兜底界面的要求：面向用户只有「友好文案 + 刷新按钮」，原始错误与堆栈只在开发环境展开；
// 无论哪种环境，原始错误都要进控制台（便于反馈时复制）。
describe('启动失败兜底界面（bootError）', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh');
    document.body.innerHTML = '<div id="root"></div>';
    vi.spyOn(console, 'error').mockImplementation(() => {}); // 兜底本身会打日志，测试里静音
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  const card = () => document.querySelector('[data-boot-error]');

  test('生产环境：只有友好提示与刷新按钮，不出现内部错误细节', () => {
    showBootError(new ReferenceError('saveError is not defined'), { showDetail: false });

    expect(card()).not.toBeNull();
    expect(card()).toHaveTextContent('页面出了点问题');
    expect(card()).toHaveTextContent('刷新页面');
    // 堆栈与内部标识符都不该露给终端用户
    expect(card().querySelector('[data-boot-error-detail]')).toBeNull();
    expect(card().textContent).not.toContain('saveError');
    expect(card().textContent).not.toContain('ReferenceError');
  });

  test('开发环境：额外展开原始错误，便于就地排查', () => {
    showBootError(new ReferenceError('saveError is not defined'), { showDetail: true });

    const detail = card().querySelector('[data-boot-error-detail]');
    expect(detail).not.toBeNull();
    expect(detail.textContent).toContain('saveError');
    expect(card()).toHaveTextContent('启动失败'); // 开发者向的说明行
  });

  test('原始错误始终写进控制台', () => {
    const err = new Error('boom');
    showBootError(err, { showDetail: false });
    expect(console.error).toHaveBeenCalledWith('[boot]', err);
  });

  test('已经渲染出内容的页面不被兜底覆盖（只在白屏时接管）', () => {
    document.getElementById('root').innerHTML = '<div>app</div>';
    showBootError(new Error('late error'), { showDetail: true });

    expect(card()).toBeNull();
    expect(document.getElementById('root').textContent).toContain('app');
  });
});
