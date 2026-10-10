import { IconBadge } from '../../components/InsightCards.jsx';

// Dashboard 的通用展示基元：卡片外壳、卡片标题、空态。
// 无数据依赖，供页面与各卡片复用（IMPROVE-01：页面级子模块拆分的第一步）。

export function Card({ className = '', children }) {
  return <div className={`rounded-card bg-surface p-3 ${className}`.trim()}>{children}</div>;
}

export function CardHeader({ title, sub, icon, badgeClass }) {
  return (
    <div>
      <h2 className="flex items-center gap-1.5 text-[13px] font-semibold tracking-[-0.01em] text-ink">
        {icon && <IconBadge className={badgeClass}>{icon}</IconBadge>}
        {title}
      </h2>
      {sub && <p className="mt-0.5 text-[11px] text-ink-3">{sub}</p>}
    </div>
  );
}

export function Empty({ children }) {
  return <div className="mt-6 py-8 text-center text-[12px] text-ink-3">{children}</div>;
}
