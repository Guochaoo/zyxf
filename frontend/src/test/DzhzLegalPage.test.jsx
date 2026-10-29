import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import DzhzLegalPage from '../pages/DzhzLegalPage.jsx';
import legalDoc from '../pages/Dzhz/legalContent.json';
import dzhzHtml from '../pages/Dzhz/content.html?raw';

const { version: LEGAL_VERSION, sections: LEGAL_SECTIONS } = legalDoc;

/* ============================================================
 * 岱宗盒子 · 用户协议与隐私政策（/dzhz/legal）的内容契约。
 *
 * 这里守三件事：
 *   1. 八节正文按 App 的 Eula.kt 顺序逐节渲染（顺序错 = 与 App 内不是同一份）；
 *   2. 页面保留 #terms / #privacy 两个深链锚点；
 *   3. dzhz 页脚只有一个「用户协议与隐私政策」站内入口，不再外链 DeepSeek
 *      （复刻件遗留的地址，主体与著作权都对不上）。
 * ============================================================ */

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/dzhz/legal']}>
      <DzhzLegalPage />
    </MemoryRouter>
  );

describe('岱宗盒子 · 用户协议与隐私政策', () => {
  test('八节正文按 App 的 Eula 顺序渲染', () => {
    renderPage();
    const headings = screen.getAllByRole('heading', { level: 2 });
    expect(headings.map((h) => h.textContent)).toEqual(LEGAL_SECTIONS.map((s) => s.title));
  });

  test('版本号、隐私条款与合规条款都在页面上', () => {
    const { container } = renderPage();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('用户协议与隐私政策');
    expect(container.textContent).toContain(`协议版本：v${LEGAL_VERSION}`);
    expect(container.textContent).toContain(
      '本页与 App 内「设置 → 关于 → 用户协议与隐私政策」的正文一致，协议更新后以应用内展示的版本为准，继续使用本应用即视为接受修改后的条款。'
    );
    expect(container.textContent).toContain('您的账号凭据（用户名和密码）仅加密存储在本地设备中');
    expect(container.textContent).toContain('本应用不提供抢选、抢课、刷分等牟利功能。');
    // 关键句在 App 里是强调样式，搬到网页后不能退化成普通正文
    expect(container.querySelectorAll('strong').length).toBeGreaterThanOrEqual(4);
  });

  test('页面保留 #terms / #privacy 深链锚点', () => {
    const { container } = renderPage();
    expect(container.querySelector('#terms')).toBeTruthy();
    expect(container.querySelector('#privacy')).toBeTruthy();
  });

  test('页脚链到开源协议页', () => {
    const { container } = renderPage();
    expect(container.querySelector('footer a[href="/dzhz/license"]')).toBeTruthy();
  });

  test('dzhz 页脚的两个站内入口：开源协议 / 用户协议与隐私政策', () => {
    expect(dzhzHtml).toContain('href="/dzhz/license">开源协议</a>');
    expect(dzhzHtml).toContain('href="/dzhz/legal">用户协议与隐私政策</a>');
    expect(dzhzHtml).not.toContain('>隐私政策</a>');
    expect(dzhzHtml).not.toContain('>用户协议</a>');
    expect(dzhzHtml).not.toContain('deepseek.com/harness/privacy');
    expect(dzhzHtml).not.toContain('deepseek.com/harness/terms-of-use');
  });
});
