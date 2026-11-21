import { useSyncExternalStore } from 'react';

/**
 * 读取**当前实际生效**的主题（'light' | 'dark'），并随 `<html data-theme>` 变化自动更新。
 *
 * 为什么不用 useTheme()：那个 hook 每个调用点各持一份 state（App 与 SettingsModal 就是
 * 两个独立实例），在设置里切主题不会让别的组件重渲染。而 data-theme 是 useTheme 写入的
 * 唯一事实来源，直接订阅它最省事——画布类组件（liveline 的 axis 配色）必须拿到真实值。
 */

function subscribe(onChange) {
  const root = document.documentElement;
  const observer = new MutationObserver(onChange);
  observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}

function getSnapshot() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

// 没有 DOM 时（SSR / 测试环境）退化为亮色，与 index.html 的默认一致。
function getServerSnapshot() {
  return 'light';
}

export default function useResolvedTheme() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
