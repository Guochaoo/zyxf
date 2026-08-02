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
export default function TrashIcon({ className = 'w-4 h-4' }) {
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
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}
