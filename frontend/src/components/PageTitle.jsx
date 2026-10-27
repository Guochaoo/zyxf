// 独立页左上角的「logo + 页面名」标题块（统计面板 / 公示栏共用）。
//
// 与资料库左栏的品牌行是同一套样式：28px 圆形 logo + `.rb-brand-title`
// （17px / 500 / −0.01em），行高 34px 与左栏品牌行、中列工具栏齐平；
// 页面左上角的位置由 App.jsx 的 main 内边距给出（`px-4 pt-[11px]`）。
//
// 抽成组件而不是各页抄一份：这两个页头此前是同一串类名，抄第三份必然漂移
// （与 components/ui.js 合并 ICON_BUTTON_CLASS 的理由相同）。
export default function PageTitle({ title }) {
  return (
    <header className="mb-5 flex min-h-[34px] items-center">
      <h1 className="flex items-center gap-2">
        <img
          src="/favicon.png"
          alt=""
          aria-hidden="true"
          className="h-7 w-7 rounded-full object-cover"
        />
        <span className="rb-brand-title whitespace-nowrap">{title}</span>
      </h1>
    </header>
  );
}
