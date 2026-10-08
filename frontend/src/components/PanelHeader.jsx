import { ChevronDown, ChevronUp } from 'lucide-react';
import { ICON_BUTTON_CLASS } from './ui.js';

/**
 * 右栏卡片头部：灰底标签行 + 图标操作按钮 + 收起开关。
 * （原由知识图谱与智能对话两张卡片共用；智能对话卡片迁入搜索候选框后
 * 只剩知识图谱一个消费方，保留为独立展示件。）`children`（操作按钮）
 * 只在展开时渲染。
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
    <div className="flex shrink-0 items-center justify-between gap-1 bg-field p-1.5">
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
