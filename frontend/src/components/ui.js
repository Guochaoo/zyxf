// 共享的前端 UI 常量/小组件（图标按钮样式等），供多个组件复用。

// 头部图标按钮（globe / maximize / 设置 / 清空等）共用样式。
// 原 ChatComposer 的 HEADER_BTN_CLASS 与 KnowledgeGraph 的 ACTION_BTN_CLASS
// 是同一串类名，合并到这里防止两处漂移。
export const ICON_BUTTON_CLASS =
  'flex size-6 items-center justify-center rounded-[6px] text-ink-3 transition-colors duration-100 hover:bg-hover hover:text-ink-2 disabled:opacity-40 disabled:hover:bg-transparent';
