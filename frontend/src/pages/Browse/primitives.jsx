// BrowsePage 的页面级纯展示件（原 BrowsePage.jsx 内联定义，IMPROVE-01 拆分）。
// 只收无状态的外观件：不含数据请求、不碰页面状态。

// 工具栏图标按钮：外层裸 button + 内层 rb-toolbar-btn 固定宽度槽位。
export function ToolbarIconButton({ title, onClick, children }) {
  return (
    <button onClick={onClick} className="p-0" title={title}>
      <span className="rb-toolbar-btn w-[38.5px] p-0">{children}</span>
    </button>
  );
}

// 底部悬浮胶囊横幅（拖拽提示/移动错误/同步结果共用骨架）。
export function FloatingPill({ className = '', bottom = 'bottom-6', role, children }) {
  return (
    <div
      className={`fixed left-1/2 -translate-x-1/2 ${bottom} z-40 text-xs rounded-full shadow-md px-4 py-1.5 ${className}`}
      role={role}
    >
      {children}
    </div>
  );
}

// 行内操作按钮（重命名 / 删除 / 下载共用）。
export function RowAction({ title, onClick, children }) {
  return (
    <button type="button" onClick={onClick} title={title} className="p-1 rounded-sm hover:bg-black/5">
      {children}
    </button>
  );
}
