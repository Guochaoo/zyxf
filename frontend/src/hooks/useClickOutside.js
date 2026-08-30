import { useEffect, useRef } from 'react';

/**
 * 点击外部收起：enabled 为 true 时监听 document 的 mousedown，
 * 点击目标不在任何一个 ref 内则触发 onOutside。
 * 所有 ref 已挂载才参与判定——浮层未渲染时 ref.current 为 null，视为未开启。
 * onOutside 通过 ref 转发，无需保持引用稳定。
 */
export function useClickOutside(enabled, onOutside, ...refs) {
  const cbRef = useRef(onOutside);
  cbRef.current = onOutside;

  useEffect(() => {
    if (!enabled) return undefined;
    const onDocMouseDown = (e) => {
      if (refs.every((r) => r.current && !r.current.contains(e.target))) {
        cbRef.current();
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
    // refs 是稳定的 useRef 对象；enabled 变化时才重绑监听。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...refs]);
}
