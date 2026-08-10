/**
 * ArrowLeftIcon — 返回上一级（lucide arrow-left）
 *
 * 约定（新图标请遵循）：
 * - viewBox 统一 "0 0 24 24"（来源不同可保留原 viewBox，如 Bootstrap 的 16）
 * - 颜色跟随 currentColor：填充图标用 fill="currentColor"，
 *   线性图标（如本图标）用 stroke="currentColor" fill="none"
 * - 接收 className 控制尺寸（默认 w-4 h-4）
 * - 文件名以 Icon 结尾（如 ArrowLeftIcon.jsx），并在此目录的 index.js 中导出
 */
export default function ArrowLeftIcon({ className = 'w-4 h-4' }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </svg>
  );
}
