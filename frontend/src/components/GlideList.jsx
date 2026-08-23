import { useEffect, useRef, useState } from 'react';

/**
 * 滑动高亮列表：单一背景高亮条，鼠标悬浮到哪一行就平滑滑动到哪一行。
 * 用法：给列表项加 `data-glide-row` 属性（或用 rowSelector 自定义），其余照常。
 * 高亮用 z-index:-1 垫底，不遮挡行内容；滚动时自动跟随当前悬浮行。
 */
export default function GlideList({
  as: Tag = 'div',
  children,
  className = '',
  highlightClassName = 'bg-hover',
  rowSelector = '[data-glide-row]',
  offsetY = 0,
  ...rest
}) {
  const boxRef = useRef(null);
  const barRef = useRef(null);
  const hoveredRef = useRef(null);
  const [gone, setGone] = useState(true);

  const place = (row) => {
    const bar = barRef.current;
    const box = boxRef.current;
    if (!bar || !box || !row) return;
    const boxRect = box.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    bar.style.top = `${rowRect.top - boxRect.top + offsetY}px`;
    bar.style.left = `${rowRect.left - boxRect.left}px`;
    bar.style.width = `${rowRect.width}px`;
    bar.style.height = `${rowRect.height}px`;
  };

  const moveTo = (row) => {
    hoveredRef.current = row;
    place(row);
    setGone(false);
  };

  const onMouseOver = (e) => {
    const row = e.target.closest?.(rowSelector);
    if (row && boxRef.current?.contains(row) && row !== hoveredRef.current) moveTo(row);
  };

  const onMouseLeave = () => {
    hoveredRef.current = null;
    setGone(true);
  };

  // 尺寸变化（行增删/容器变宽）时，高亮条继续对准当前悬浮行
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const recompute = () => {
      if (hoveredRef.current) place(hoveredRef.current);
    };
    const ro = new ResizeObserver(recompute);
    ro.observe(box);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Tag
      ref={boxRef}
      className={`relative isolate ${className}`}
      onMouseOver={onMouseOver}
      onMouseLeave={onMouseLeave}
      onScroll={() => hoveredRef.current && place(hoveredRef.current)}
      {...rest}
    >
      <span
        ref={barRef}
        aria-hidden
        className={`pointer-events-none absolute -z-10 rounded-[6px] transition-[top,left,width,height,opacity] duration-[180ms] ${highlightClassName}`}
        style={{
          top: 0,
          left: 0,
          width: 0,
          height: 0,
          opacity: gone ? 0 : 1,
          transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      />
      {children}
    </Tag>
  );
}
