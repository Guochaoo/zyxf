import { useLayoutEffect, useState } from 'react';

// Sliding highlight that follows the active item of a button list:
// measures offsetLeft/offsetWidth of the active element and re-measures on resize.
export function useSlidingIndicator(containerRef, itemRefs, activeKey) {
  const [indicator, setIndicator] = useState({ left: 0, width: 0, ready: false });

  useLayoutEffect(() => {
    const active = activeKey ? itemRefs.current[activeKey] : null;
    const container = containerRef.current;
    if (!active || !container) {
      setIndicator((prev) => ({ ...prev, ready: false }));
      return undefined;
    }

    const updateIndicator = () => {
      setIndicator({
        left: active.offsetLeft,
        width: active.offsetWidth,
        ready: true,
      });
    };

    updateIndicator();
    const resizeObserver = new ResizeObserver(updateIndicator);
    resizeObserver.observe(container);
    resizeObserver.observe(active);

    return () => resizeObserver.disconnect();
  }, [containerRef, itemRefs, activeKey]);

  return indicator;
}
