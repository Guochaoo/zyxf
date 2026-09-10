import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import StaggeredMenu from '../components/StaggeredMenu.jsx';
import i18n from '../i18n/index.js';

// 折叠菜单的按钮文字（打开菜单 / 关闭菜单）来自 t()。它被存进 useState 初值、
// 之后仅由开合动画重建，因此语言切换时必须有一个 effect 把它拉回当前语言——
// 否则切语言后按钮文字停在旧语言，要等点一下菜单或刷新页面才更新。

const items = [
  { label: 'Library', ariaLabel: 'Browse library', link: '/' },
];
const account = { guest: true, name: 'Guest', onLogin: () => {}, onLogout: () => {} };

function renderMenu() {
  return render(
    <MemoryRouter>
      <StaggeredMenu items={items} account={account} displaySocials={false} />
    </MemoryRouter>
  );
}

// jsdom 未实现 innerText，用 textContent（可见的那一行由 CSS 裁剪决定）。
const toggleText = () => document.querySelector('.sm-toggle').textContent.replace(/\s+/g, '').trim();

beforeEach(async () => {
  await i18n.changeLanguage('zh');
});

afterEach(async () => {
  await i18n.changeLanguage('zh');
});

describe('StaggeredMenu 菜单按钮随语言切换更新', () => {
  test('切到英文后按钮文字立即变为 Menu（无需点击或刷新）', async () => {
    renderMenu();
    expect(toggleText()).toBe('菜单');

    await i18n.changeLanguage('en');

    await waitFor(() => expect(toggleText()).toBe('Menu'));
    // 与 aria-label 同源，不应出现「文字旧语言、aria 新语言」的不一致
    expect(document.querySelector('.sm-toggle').getAttribute('aria-label')).toBe('Open menu');
  });

  test('切回中文同样立即生效', async () => {
    await i18n.changeLanguage('en');
    renderMenu();
    expect(toggleText()).toBe('Menu');

    await i18n.changeLanguage('zh');

    await waitFor(() => expect(toggleText()).toBe('菜单'));
    expect(document.querySelector('.sm-toggle').getAttribute('aria-label')).toBe('打开菜单');
  });

  test('语言切换后不残留动画序列（只渲染当前一行）', async () => {
    renderMenu();
    await i18n.changeLanguage('en');
    await waitFor(() => expect(toggleText()).toBe('Menu'));

    // 切换前若进行过开合动画，textLines 会留有多行；effect 应把它收敛为一行，
    // 否则按钮文字会被裁剪/错位。
    const lines = document.querySelectorAll('.sm-toggle-line');
    expect(lines.length).toBe(1);
  });
});

// 关闭态面板只是 opacity:0 + 平移出屏，子项仍在 Tab 顺序里；inert 让可聚焦性与
// aria-hidden 一致（否则键盘能聚焦到完全看不见的「资料库 / 登录」并回车触发）。
describe('StaggeredMenu 关闭态面板不可聚焦', () => {
  test('关闭时 aside 带 inert，打开后移除', async () => {
    renderMenu();
    const panel = () => document.getElementById('staggered-menu-panel');
    expect(panel().hasAttribute('inert')).toBe(true);
    expect(panel().getAttribute('aria-hidden')).toBe('true');

    document.querySelector('.sm-toggle').click();
    await waitFor(() => expect(panel().hasAttribute('inert')).toBe(false));
    expect(panel().getAttribute('aria-hidden')).toBe('false');

    document.querySelector('.sm-toggle').click();
    await waitFor(() => expect(panel().hasAttribute('inert')).toBe(true));
  });
});
