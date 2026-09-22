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

// 行内操作按钮（重命名 / 删除 / 下载共用）。命中区用 ::after 外扩到 28×44（视觉盒与灰底仍是
// 24×24）：按钮只有 24px 见方，而行高 44px，紧贴按钮四边的那圈（含灰框圆角外侧）原先命中的是行
// 本身——点偏一点就落到行的 onClick（文件开预览、文件夹进入），而不是这个按钮。
// 横向各扩 2px 是上限：相邻按钮间距 gap-1 = 4px，各扩一半正好在中线相遇，不会吃掉对方的盒子。
export function RowAction({ title, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="relative p-1 rounded-sm hover:bg-black/5 after:absolute after:content-[''] after:-inset-x-0.5 after:-inset-y-2.5"
    >
      {children}
    </button>
  );
}
