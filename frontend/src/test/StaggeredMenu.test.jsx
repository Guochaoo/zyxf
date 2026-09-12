import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import StaggeredMenu from '../components/StaggeredMenu.jsx';
import { __resetStarsForTest } from '../components/GithubStarButton.jsx';
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
  // 菜单打开会挂载 GitHub Star 按钮并请求 GitHub API——stub 掉，测试不连外网。
  __resetStarsForTest();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ stargazers_count: 7 }) }))
  );
});

afterEach(async () => {
  await i18n.changeLanguage('zh');
  vi.unstubAllGlobals();
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

// GitHub Star 按钮只在菜单打开时挂在开关左侧；star 数来自打开时的一次
// GitHub API 请求（fetch 已在文件级 stub），失败则隐藏数字块、按钮本体保留。
describe('StaggeredMenu GitHub Star 按钮', () => {
  test('打开菜单后出现并显示拉取到的 star 数，关闭后移除', async () => {
    renderMenu();
    expect(document.querySelector('.sm-gh-star')).toBeNull();

    document.querySelector('.sm-toggle').click();
    const star = () => document.querySelector('.sm-gh-star');
    await waitFor(() => expect(star()).not.toBeNull());
    expect(star().getAttribute('href')).toBe('https://github.com/Guochaoo/zyxf');
    expect(star().getAttribute('target')).toBe('_blank');
    await waitFor(() => expect(document.querySelector('.sm-gh-star-num').textContent).toBe('7'));

    document.querySelector('.sm-toggle').click();
    await waitFor(() => expect(star()).toBeNull());
  });

  test('star 数请求失败时隐藏数字块，按钮本体仍在', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    renderMenu();
    document.querySelector('.sm-toggle').click();
    await waitFor(() => expect(document.querySelector('.sm-gh-star')).not.toBeNull());
    expect(document.querySelector('.sm-gh-star-num')).toBeNull();
  });
});

// BUG-106 回归：gsap 加载后开关按钮的每次 hover（pointerover 被 React 合成为
// onPointerEnter）都会触发 ensureGsap→preparePanel。菜单开着时若不跳过预置，
// 面板会被打回屏外、图标/文字复位，而 React 开合态不变——遮罩留存、面板消失。
describe('StaggeredMenu 菜单开着时 hover 开关不重置面板（BUG-106）', () => {
  test('打开动画完成后再次 hover 开关，面板仍在原位', async () => {
    const toggle = () => document.querySelector('.sm-toggle');
    const panel = () => document.getElementById('staggered-menu-panel');

    renderMenu();
    // 复刻真实交互：悬停触发 gsap 预取（此时关闭态，预置合法），再点击打开。
    toggle().dispatchEvent(new Event('pointerover', { bubbles: true }));
    toggle().click();
    // jsdom 里真实 gsap 用 rAF 实时驱动，等打开时间线跑完（全程约 1.9s）。
    await new Promise((r) => setTimeout(r, 2500));
    const t0 = panel().style.transform;
    expect(t0).not.toBe('');

    toggle().dispatchEvent(new Event('pointerover', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 150));

    expect(panel().style.transform).toBe(t0);
    expect(panel().style.opacity).toBe('1');
  }, 15000);
});
