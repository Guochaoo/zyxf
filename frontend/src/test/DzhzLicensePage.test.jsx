import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import DzhzLicensePage from '../pages/DzhzLicensePage.jsx';
import { parseGpl } from '../pages/Dzhz/parseGpl.js';
import licenseText from '../pages/Dzhz/gpl-3.0.txt?raw';
import dzhzHtml from '../pages/Dzhz/content.html?raw';

/* ============================================================
 * 岱宗盒子 · 开源协议（/dzhz/license）的内容契约：
 *   1. 标题是「开源协议」，版式与协议页共用 DocPageShell；
 *   2. 正文重排后必须与 App 仓库 LICENSE 仅差空白（不丢字、不改字），
 *      并且真的按段落 / 章节标题铺开（不是一条 pre-wrap 窄带）；
 *   3. 页脚链回用户协议与隐私政策，dzhz 页脚有「开源协议」入口。
 * ============================================================ */

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/dzhz/license']}>
      <DzhzLicensePage />
    </MemoryRouter>
  );

const normalize = (s) => s.replace(/\s+/g, ' ').trim();

describe('岱宗盒子 · 开源协议', () => {
  test('标题为「开源协议」', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('开源协议');
  });

  test('重排后的正文与 LICENSE 仅差空白', () => {
    // 解析结果拼回去与原文归一化后完全一致：重排只动空白，不动字词
    expect(parseGpl(licenseText).map((block) => block.text).join(' ')).toBe(normalize(licenseText));

    const { container } = renderPage();
    const article = container.querySelector('.legal-document');
    expect(article.textContent).toContain('GNU GENERAL PUBLIC LICENSE');
    expect(article.textContent).toContain('Version 3, 29 June 2007');
    expect(article.textContent).toContain('END OF TERMS AND CONDITIONS');
    expect(
      screen.getByRole('heading', { level: 2, name: '17. Interpretation of Sections 15 and 16.' })
    ).toBeTruthy();
  });

  test('正文按段落 / 章节标题铺开，而不是一条 pre-wrap 窄带', () => {
    const { container } = renderPage();
    const article = container.querySelector('.legal-document');
    expect(article.querySelectorAll('h2').length).toBeGreaterThanOrEqual(20);
    expect(article.querySelectorAll('p').length).toBeGreaterThanOrEqual(100);
  });

  test('页脚链回用户协议与隐私政策', () => {
    const { container } = renderPage();
    expect(container.querySelector('footer a[href="/dzhz/legal"]')).toBeTruthy();
  });

  test('dzhz 页脚的「开源协议」入口存在', () => {
    expect(dzhzHtml).toContain('href="/dzhz/license">开源协议</a>');
  });
});
