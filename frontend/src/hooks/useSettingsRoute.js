// 设置弹窗路由的状态机（IMPROVE-55：从 App.jsx 抽出）。
//
// 设置是「真实路由 /settings」而不是「弹窗 + 历史占位」：系统返回手势/返回键由
// 路由天然接管——/settings/ai → 返回 → /settings（一级列表）→ 返回 → 打开设置
// 前的页面。打开设置时把当前页面记进 history.state.background，弹窗之外照常
// 渲染原页面（弹窗路由的标准做法），布局判断一律基于「背景位置」。
import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import useMediaQuery from './useMediaQuery.js';

export function useSettingsRoute() {
  const location = useLocation();
  const navigate = useNavigate();
  // 手机端点条目 = 进二级页面（push，返回手势才能回到列表）；桌面端只是切右栏
  // （replace 不堆历史）。
  const isMobileSettings = useMediaQuery('(max-width: 640px)');

  const isSettings = location.pathname === '/settings' || location.pathname.startsWith('/settings/');
  const settingsSection = location.pathname.match(/^\/settings\/([\w-]+)/)?.[1] ?? null;
  const background = location.state?.background;
  // 弹窗打开时路径是 /settings，但背后仍是资料库等页面。
  const pageLocation = background ?? location;

  const openSettings = useCallback(() => {
    if (!isSettings) navigate('/settings', { state: { background: location } });
  }, [isSettings, location, navigate]);

  const openSettingsSection = useCallback(
    (id) => {
      navigate(`/settings/${id}`, { replace: !isMobileSettings, state: location.state });
    },
    [isMobileSettings, location.state, navigate]
  );

  // 从任意页面直接落到某个板块（例：对话卡片的齿轮 → 智能对话配置）。
  // 还没在设置里时要把当前页记进 background——直接 navigate('/settings/:id') 不带
  // state 的话，弹窗背后会退回资料库根目录，丢掉当前文件夹。
  const openSettingsAt = useCallback(
    (id) => {
      if (isSettings) {
        openSettingsSection(id);
      } else {
        navigate(`/settings/${id}`, { state: { background: location } });
      }
    },
    [isSettings, openSettingsSection, location, navigate]
  );

  // 手机端二级的「返回」按钮 = 回到一级列表；用 replace，之后一次返回直接回到原页面。
  const backToSettingsList = useCallback(() => {
    navigate('/settings', { replace: true, state: location.state });
  }, [location.state, navigate]);

  // 关闭设置 = 用背景位置替换掉设置条目，历史里不留 /settings 残影。
  const closeSettings = useCallback(() => {
    const bg = location.state?.background;
    navigate(bg ? { pathname: bg.pathname, search: bg.search, hash: bg.hash } : '/', { replace: true });
  }, [location.state, navigate]);

  return {
    isSettings,
    settingsSection,
    pageLocation,
    openSettings,
    openSettingsSection,
    openSettingsAt,
    backToSettingsList,
    closeSettings,
  };
}
