import { ChevronDown, ChevronUp } from 'lucide-react';
import { ICON_BUTTON_CLASS } from './ui.js';

/**
 * Right-rail card header: gray label row + icon action buttons + collapse
 * toggle. Shared by KnowledgeGraph and ChatComposer so the two card headers
 * never drift apart. `children` (action buttons) render only when expanded.
 */
export default function PanelHeader({
  title,
  collapsed,
  onToggleCollapsed,
  expandTitle,
  collapseTitle,
  children,
}) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-1 bg-[#EFEFEF] p-1.5">
      <span className="shrink-0 px-2 py-[3px] text-[13px] font-medium text-ink">{title}</span>
      <div className="flex shrink-0 items-center gap-1">
        {!collapsed && children}
        <button
          type="button"
          onClick={onToggleCollapsed}
          title={collapsed ? expandTitle : collapseTitle}
          aria-label={collapsed ? expandTitle : collapseTitle}
          aria-expanded={!collapsed}
          className={ICON_BUTTON_CLASS}
        >
          {collapsed ? (
            <ChevronDown className="h-[15px] w-[15px]" />
          ) : (
            <ChevronUp className="h-[15px] w-[15px]" />
          )}
        </button>
      </div>
    </div>
  );
}
