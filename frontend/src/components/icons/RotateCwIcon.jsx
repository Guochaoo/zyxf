/**
 * 统一 SVG 图标目录
 *
 * 约定（新图标请遵循）：
 * - viewBox 统一 "0 0 24 24"（来源不同可保留原 viewBox，如 Bootstrap 的 16）
 * - 颜色跟随 currentColor：填充图标用 fill="currentColor"，
 *   线性图标（如本图标）用 stroke="currentColor" fill="none"
 * - 接收 className 控制尺寸（默认 w-4 h-4）
 * - 文件名以 Icon 结尾（如 SearchIcon.jsx），并在此目录的 index.js 中导出
 */
export default function RotateCwIcon({ className = 'w-4 h-4' }) {
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
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
  );
}
