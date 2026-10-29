import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import DzhzLicensePage from '../pages/DzhzLicensePage.jsx';
import licenseText from '../pages/Dzhz/gpl-3.0.txt?raw';
import dzhzHtml from '../pages/Dzhz/content.html?raw';

/* ============================================================
 * 岱宗盒子 · 开源协议（/dzhz/license）的内容契约：
 *   1. 标题是「开源协议」，版式与协议页共用 DocPageShell；
 *   2. 正文与 App 仓库 LICENSE 逐字一致（不删行、不改缩进）；
 *   3. 页脚链回用户协议与隐私政策，dzhz 页脚有「开源协议」入口。
 * ============================================================ */

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/dzhz/license']}>
      <DzhzLicensePage />
    </MemoryRouter>
  );

describe('岱宗盒子 · 开源协议', () => {
  test('标题为「开源协议」', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('开源协议');
  });

  test('正文与 App 仓库的 LICENSE 逐字一致', () => {
    const { container } = renderPage();
    const raw = container.querySelector('.legal-document [lang="en"]');
    expect(raw).toBeTruthy();
    expect(raw.textContent).toBe(licenseText);
    expect(raw.textContent).toContain('GNU GENERAL PUBLIC LICENSE');
    expect(raw.textContent).toContain('Version 3, 29 June 2007');
    expect(raw.textContent).toContain('END OF TERMS AND CONDITIONS');
  });

  test('页脚链回用户协议与隐私政策', () => {
    const { container } = renderPage();
    expect(container.querySelector('footer a[href="/dzhz/legal"]')).toBeTruthy();
  });

  test('dzhz 页脚的「开源协议」入口存在', () => {
    expect(dzhzHtml).toContain('href="/dzhz/license">开源协议</a>');
  });
});
