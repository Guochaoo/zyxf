import { useCallback, useEffect, useState } from 'react';
import useMediaQuery from './useMediaQuery.js';
import { getTheme, setTheme as persistTheme } from '../ui.js';

/**
 * 界面主题状态管理（亮色/暗色/跟随系统，三档）。
 *
 * - theme：用户选择，取值 'light' | 'dark' | 'system'（持久化到 localStorage）。
 * - resolved：实际应用到界面的主题，取值 'light' | 'dark'（system 时按系统媒体查询解析）。
 * - setTheme：更新用户选择并持久化。
 *
 * 通过给 <html> 设置 data-theme 属性驱动 CSS 变量切换（见 index.css [data-theme='dark']）。
 */
export default function useTheme() {
  const [theme, setThemeState] = useState(() => {
    const stored = getTheme();
    return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
  });
  const systemDark = useMediaQuery('(prefers-color-scheme: dark)');

  const resolved = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', resolved);
    // <body> 在 index.html 带 bg-white，暗色下覆盖为页面底色，防止白底泄漏。
    document.body.style.backgroundColor = resolved === 'dark' ? '#161616' : '#f8f8f8';
  }, [resolved]);

  const setTheme = useCallback((value) => {
    if (value === 'light' || value === 'dark' || value === 'system') {
      setThemeState(value);
      persistTheme(value);
    }
  }, []);

  return { theme, setTheme, resolved };
}
