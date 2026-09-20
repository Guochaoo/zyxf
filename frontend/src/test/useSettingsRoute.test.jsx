import { describe, test, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
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
