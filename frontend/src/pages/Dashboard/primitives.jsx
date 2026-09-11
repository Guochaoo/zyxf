import { useTranslation } from 'react-i18next';
import { IconBadge } from '../../components/InsightCards.jsx';

// Dashboard 的通用展示基元：卡片外壳、卡片标题、空态、时间范围切换。
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

export function RangeSwitch({ value, onChange, disabled = false }) {
  const { t } = useTranslation();
  const opts = [
    { v: 7, label: t('dashboard.rangeDays.seven') },
    { v: 30, label: t('dashboard.rangeDays.thirty') },
    { v: 90, label: t('dashboard.rangeDays.ninety') },
  ];
  return (
    <div className="inline-flex rounded-full bg-field p-0.5">
      {opts.map((o) => (
        <button
          key={o.v}
          type="button"
          aria-pressed={value === o.v}
          disabled={disabled}
          onClick={() => onChange(o.v)}
          className={`rounded-full px-3 py-1 text-[12px] transition-[background-color,color,box-shadow,transform] duration-150 enabled:active:scale-[0.96] disabled:opacity-50 ${
            value === o.v ? 'bg-surface text-ink shadow-btn' : 'text-ink-3 hover:text-ink-2'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
