// 排序控件（原 BrowsePage.jsx 内联定义，IMPROVE-01 拆分）。
// 滑动指示器的定位依赖真实 DOM 宽度，因此仍由 ref + useSlidingIndicator 驱动。
import { useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowDown01,
  ArrowDown10,
  ArrowDownAZ,
  ArrowDownZA,
  CalendarArrowDown,
  CalendarArrowUp,
} from 'lucide-react';
import { useSlidingIndicator } from '../../hooks/useSlidingIndicator.js';
import { EASE_COLLAPSE } from '../../components/ui.js';

// Direction arrow per sort key ('manual' has none).
const SORT_ARROWS = {
  name: { asc: ArrowDownAZ, desc: ArrowDownZA },
  created_at: { asc: CalendarArrowDown, desc: CalendarArrowUp },
  size: { asc: ArrowDown01, desc: ArrowDown10 },
};

export default function SortControl({ sort, order, onChange }) {
  const listRef = useRef(null);
  const buttonRefs = useRef({});
  const indicator = useSlidingIndicator(listRef, buttonRefs, sort);
  const { t } = useTranslation();
  // Default = admin-controlled manual order. Comes first.
  const sortOptions = useMemo(
    () => [
      { key: 'manual', label: t('browse.defaultSort') },
      { key: 'name', label: t('browse.name') },
      { key: 'created_at', label: t('browse.time') },
      { key: 'size', label: t('browse.size') },
    ],
    [t]
  );

  return (
    <div className="rb-toolbar-btn max-w-full !px-0">
      <div ref={listRef} className="sort-scroll relative flex max-w-full items-center overflow-x-auto text-xs">
        <span
          className="pointer-events-none absolute inset-y-0 rounded-[14px] bg-surface shadow-[inset_0_0_0_1px_var(--line-strong)]"
          style={{
            width: indicator.width,
            transform: `translateX(${indicator.left}px)`,
            opacity: indicator.ready ? 1 : 0,
            transition: `transform 360ms ${EASE_COLLAPSE}, width 360ms ${EASE_COLLAPSE}, opacity 160ms ease`,
          }}
        />
        {sortOptions.map((opt) => {
          const active = sort === opt.key;
          const ArrowIcon = SORT_ARROWS[opt.key]?.[order];
          return (
            <button
              ref={(node) => {
                if (node) buttonRefs.current[opt.key] = node;
              }}
              key={opt.key}
              onClick={() => onChange(opt.key)}
              className={`sort-option relative z-10 flex h-[34px] shrink-0 items-center justify-center bg-transparent px-2.5 transition-colors focus:outline-none ${
                active ? 'sort-option--active' : ''
              } ${opt.key === 'manual' ? '' : 'pr-6'}`}
            >
              <span className="leading-none">{opt.label}</span>
              <span className="absolute right-2 top-1/2 flex w-3 -translate-y-1/2 items-center justify-center">
                {ArrowIcon && (
                  <ArrowIcon
                    className={`w-3.5 h-3.5 transition-opacity ${
                      active && opt.key !== 'manual' ? 'opacity-100' : 'opacity-0'
                    }`}
                  />
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
