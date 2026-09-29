import { describe, test, expect, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigationType } from 'react-router-dom';
import { useSettingsRoute } from '../hooks/useSettingsRoute.js';

// openSettingsAt：从任意页面直接落到某个板块（对话卡片的齿轮 → 智能对话配置）。
// 关键点是 background 必须一起记——否则弹窗背后会退回资料库根目录，丢掉当前文件夹。
function setup(initialEntries) {
  const wrapper = ({ children }) => (
    <MemoryRouter
      initialEntries={initialEntries}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      {children}
    </MemoryRouter>
  );
  return renderHook(() => ({ route: useSettingsRoute(), location: useLocation() }), { wrapper });
}

describe('useSettingsRoute · openSettingsAt', () => {
  test('从普通页面直接进板块时，把当前页记进 background', () => {
    const { result } = setup(['/folder/5']);
    act(() => result.current.route.openSettingsAt('ai'));

    expect(result.current.location.pathname).toBe('/settings/ai');
    expect(result.current.location.state.background.pathname).toBe('/folder/5');
    // 板块 id 已落到路由上，弹窗据此渲染右侧板块
    expect(result.current.route.settingsSection).toBe('ai');
  });

  test('已在设置里时只切板块，background 保持原样', () => {
    const { result } = setup([{ pathname: '/settings', state: { background: { pathname: '/folder/5' } } }]);
    act(() => result.current.route.openSettingsAt('appearance'));

    expect(result.current.location.pathname).toBe('/settings/appearance');
    expect(result.current.location.state.background.pathname).toBe('/folder/5');
  });
});

// 手机端（≤640px）与桌面端的导航语义不同：手机点条目 = 进二级页面（push，系统返回手势
// 才能回到列表），桌面只是切右栏（replace，不堆历史）。上面的桌面用例只锁了 background，
// 没锁住 push/replace 本身——这里用 useNavigationType 把两者区分开。
const realMatchMedia = window.matchMedia;
function mockMobile() {
  window.matchMedia = (query) => ({
    matches: query.includes('max-width: 640px'),
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() {
      return false;
    },
  });
}
afterEach(() => {
  window.matchMedia = realMatchMedia;
});

function setupNav(initialEntries) {
  const wrapper = ({ children }) => (
    <MemoryRouter
      initialEntries={initialEntries}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      {children}
    </MemoryRouter>
  );
  return renderHook(
    () => ({ route: useSettingsRoute(), location: useLocation(), navigationType: useNavigationType() }),
    { wrapper }
  );
}

describe('useSettingsRoute · 手机端 push/replace 分支', () => {
  test('手机端从一级点条目进二级用 push，背景页一路保留', () => {
    mockMobile();
    const { result } = setupNav(['/folder/5']);
    act(() => result.current.route.openSettings());
    expect(result.current.location.pathname).toBe('/settings');
    expect(result.current.navigationType).toBe('PUSH');

    act(() => result.current.route.openSettingsSection('ai'));

    expect(result.current.location.pathname).toBe('/settings/ai');
    // push 而非 replace：历史里留着 /settings，一次返回就回到一级列表
    expect(result.current.navigationType).toBe('PUSH');
    expect(result.current.location.state.background.pathname).toBe('/folder/5');
    expect(result.current.route.settingsSection).toBe('ai');
  });

  test('桌面端点条目只切右栏，用 replace 不堆 /settings/:id', () => {
    const { result } = setupNav([{ pathname: '/settings', state: { background: { pathname: '/folder/5' } } }]);
    act(() => result.current.route.openSettingsSection('appearance'));

    expect(result.current.location.pathname).toBe('/settings/appearance');
    expect(result.current.navigationType).toBe('REPLACE');
  });

  test('手机端二级「返回」用 replace 回到一级列表，背景页不丢（含 search）', () => {
    mockMobile();
    const { result } = setupNav([
      { pathname: '/settings/ai', state: { background: { pathname: '/folder/5', search: '?page=2' } } },
    ]);
    act(() => result.current.route.backToSettingsList());

    expect(result.current.location.pathname).toBe('/settings');
    expect(result.current.navigationType).toBe('REPLACE');
    expect(result.current.location.state.background).toEqual({ pathname: '/folder/5', search: '?page=2' });
  });
});

describe('useSettingsRoute · 打开与关闭', () => {
  test('openSettings 把当前页记进 background，已在设置里时不覆盖', () => {
    const { result } = setupNav(['/folder/9']);
    act(() => result.current.route.openSettings());

    expect(result.current.location.pathname).toBe('/settings');
    expect(result.current.location.state.background.pathname).toBe('/folder/9');
    // 弹窗打开时路径是 /settings，布局判断必须回落到背景位置
    expect(result.current.route.pageLocation.pathname).toBe('/folder/9');
    expect(result.current.route.settingsSection).toBeNull();

    act(() => result.current.route.openSettings());
    expect(result.current.location.pathname).toBe('/settings');
    expect(result.current.location.state.background.pathname).toBe('/folder/9');
  });

  test('关闭设置用 replace 回到背景位置（保留 search/hash），历史不留 /settings 残影', () => {
    const { result } = setupNav([
      {
        pathname: '/settings/ai',
        search: '?tab=1',
        state: { background: { pathname: '/folder/5', search: '?page=2', hash: '#files' } },
      },
    ]);
    act(() => result.current.route.closeSettings());

    expect(result.current.location.pathname).toBe('/folder/5');
    expect(result.current.location.search).toBe('?page=2');
    expect(result.current.location.hash).toBe('#files');
    expect(result.current.navigationType).toBe('REPLACE');
  });

  test('直接访问 /settings（无 background）时关闭设置回到根目录', () => {
    const { result } = setupNav(['/settings']);
    expect(result.current.route.isSettings).toBe(true);
    // 没有背景位置时 pageLocation 就是设置自身（不能取到 undefined 而崩掉布局）
    expect(result.current.route.pageLocation.pathname).toBe('/settings');

    act(() => result.current.route.closeSettings());

    expect(result.current.location.pathname).toBe('/');
  });
});
