import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown } from 'lucide-react';
import { ChartTooltip, IconBadge } from '../../components/InsightCards.jsx';

// GitHub 式年度下载热力图（IMPROVE-01：从 DashboardPage 抽出）。自包含，只依赖传入的 rows。
// IMPROVE-52：网格抽成 memo 子组件并改用事件委托——hover 状态原先让 ~365 个单元格
// 整体重渲染，现在只有 tooltip 一小块 React 树随 hover 变化。

const DAY_MS = 86400000;
const ACCENT = '#3d9aff';

/* accent ramp over the field token; level 0 is an empty day */
const HEAT_LEVELS = [
  'var(--field)',
  'rgba(61, 154, 255, 0.35)',
  'rgba(61, 154, 255, 0.55)',
  'rgba(61, 154, 255, 0.78)',
  'var(--accent)',
];

const HEAT_GAP = 5; // px between cells and label rows

/* sqrt-of-max instead of linear so one huge spike (a bulk upload) doesn't
   flatten every other active day into the lightest shade */
const heatLevel = (v, max) =>
  v <= 0 || max <= 0 ? 0 : Math.min(4, Math.ceil(Math.sqrt(v / max) * 4));

const fmtFullDate = (ts) => {
  const d = new Date(ts);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
};

/* daily rows → week columns (Monday-first), padded with invisible cells to
   full weeks on both ends so the grid always starts on a Monday */
function buildWeeks(rows) {
  const byTs = new Map(rows.map((r) => [r.ts, r]));
  const first = rows[0].ts;
  const last = rows.at(-1).ts;
  const gridStart = first - ((new Date(first).getDay() + 6) % 7) * DAY_MS;
  const total = Math.ceil((last - gridStart) / DAY_MS) + 1;
  const padded = total + ((7 - (total % 7)) % 7);
  const cells = Array.from({ length: padded }, (_, i) => {
    const ts = gridStart + i * DAY_MS;
    const r = byTs.get(ts);
    return { ts, inRange: !!r, downloads: r?.downloads ?? 0, uploads: r?.uploads ?? 0 };
  });
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  // label the week each month's 1st falls in (GitHub-style top axis)
  const months = weeks.map((week) => {
    const firstOfMonth = week.find((c) => new Date(c.ts).getDate() === 1);
    return firstOfMonth ? new Date(firstOfMonth.ts).getMonth() : null;
  });
  const max = cells.reduce((m, c) => Math.max(m, c.downloads), 0);
  return { weeks, months, max };
}

// 网格内容（月份轴 + 星期轴 + 单元格）。hover 不经过这里：单元格只带 data-*，
// 交互由外层容器的事件委托处理，props 稳定时整个网格跳过重渲染。
// 注意 memo 边界在「relative w-max」容器**之内**——单元格 offsetLeft/offsetTop 的
// 定位基准是它，tooltip 也挂在这层（见下方外层组件）。
const HeatGrid = memo(function HeatGrid({ visWeeks, months, max, cell, weekdays, monthNames, t }) {
  return (
    <>
      <div className="mb-1 flex" style={{ gap: HEAT_GAP }}>
        {months.map((m, w) => (
          <span
            key={w}
            style={{ width: cell }}
            className="whitespace-nowrap text-[10px] leading-none text-ink-3"
          >
            {m != null ? monthNames[m] : ''}
          </span>
        ))}
      </div>
      <div className="flex" style={{ gap: HEAT_GAP }}>
        <div className="mr-1 flex flex-col" style={{ gap: HEAT_GAP }}>
          {weekdays.map((name, i) => (
            <span
              key={name}
              style={{ height: cell, lineHeight: `${cell}px` }}
              className="text-[10px] text-ink-3"
            >
              {i % 2 === 0 ? name : ''}
            </span>
          ))}
        </div>
        {visWeeks.map((week, w) => (
          <div key={w} className="flex flex-col" style={{ gap: HEAT_GAP }}>
            {week.map((day) =>
              day.inRange ? (
                <span
                  key={day.ts}
                  data-cell=""
                  data-ts={day.ts}
                  style={{
                    width: cell,
                    height: cell,
                    background: HEAT_LEVELS[heatLevel(day.downloads, max)],
                  }}
                  // 悬浮提示原先只有鼠标能触发，键盘/读屏完全拿不到每日数值（a11y）。
                  // 单元格本身进 Tab 顺序，并用 aria-label 直接播报日期与下载数；
                  // 焦点/悬停事件由外层容器统一委托（focusin 会冒泡）。
                  tabIndex={0}
                  role="img"
                  aria-label={t('dashboard.heatmapCell', {
                    date: fmtFullDate(day.ts),
                    count: day.downloads,
                  })}
                  className="rounded-[2px] transition-shadow hover:ring-1 hover:ring-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40"
                />
              ) : (
                <span key={day.ts} style={{ width: cell, height: cell }} />
              )
            )}
          </div>
        ))}
      </div>
    </>
  );
});

export default function ActivityHeatmap({ rows }) {
  const scrollRef = useRef(null);
  const [hover, setHover] = useState(null);
  const [box, setBox] = useState(null); // measured grid viewport { w, h }
  const { t } = useTranslation();
  // 月份轴文案：按下标取用（1 月 = 下标 0）。用整份数组而非按 count 拼接，
  // 以免英文出现 '9m' 这类易误读的写法。
  const monthNames = useMemo(() => t('dashboard.monthShort', { returnObjects: true }), [t]);
  // dictionary weekdays is Sunday-first; rendered per row index (grid is built
  // Monday-first in buildWeeks, so labels may not align perfectly)
  const weekdays = useMemo(() => t('dashboard.weekdays', { returnObjects: true }), [t]);

  const { weeks, months, max } = useMemo(
    () => (rows?.length ? buildWeeks(rows) : { weeks: [], months: [], max: 0 }),
    [rows]
  );

  /* the panel stretches to the grid row height (set by the neighbouring
     allocation card), so the scroll area's own size tells us how big the
     cells can get; re-measure on resize */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !weeks.length || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [weeks.length]);

  const PADX = 24; // px-3 on both sides — matches the p-3 of the other cards
  const PADY = 12; // pb-3 below; the header row provides the top spacing
  const MONTH_H = 14; // month axis row + its mb-1
  const WEEK_LBL = 18; // weekday label column + mr-1

  /* cell size fits the available height first (enlarging beyond GitHub's
     10px to fill the taller panel) but is capped by the width so 53 week
     columns stop just short of overflowing */
  const cell = useMemo(() => {
    if (!box) return 12;
    const byH = (box.h - PADY - MONTH_H - 6 * HEAT_GAP) / 7;
    const byW = (box.w - PADX - WEEK_LBL - (weeks.length - 1) * HEAT_GAP) / weeks.length;
    return Math.max(12, Math.min(22, Math.floor(Math.min(byH, byW))));
  }, [box, weeks.length]);

  /* when even 10px cells overflow the width, drop the oldest weeks from the
     left instead of scrolling — the grid always fits, no scrollbar */
  const { visWeeks, visMonths } = useMemo(() => {
    if (!box || !weeks.length) {
      return { visWeeks: weeks, visMonths: months };
    }
    const avail = box.w - PADX - WEEK_LBL;
    const nFit = Math.min(
      weeks.length,
      Math.max(1, Math.floor((avail + HEAT_GAP) / (cell + HEAT_GAP)))
    );
    if (nFit >= weeks.length) {
      return { visWeeks: weeks, visMonths: months };
    }
    const cutWeeks = weeks.slice(weeks.length - nFit);
    const cutMonths = months.slice(months.length - nFit);
    // the week holding a month's label may have been cut; relabel the first
    // visible column so the axis never starts unannotated
    if (cutMonths[0] == null) {
      const d = cutWeeks[0].find((c) => c.inRange) ?? cutWeeks[0][0];
      cutMonths[0] = new Date(d.ts).getMonth();
    }
    return { visWeeks: cutWeeks, visMonths: cutMonths };
  }, [box, cell, weeks, months]);

  // ts → cell 数据，事件委托时按 data-ts 取回当日数值
  const cellByTs = useMemo(() => {
    const m = new Map();
    for (const week of visWeeks) for (const c of week) if (c.inRange) m.set(c.ts, c);
    return m;
  }, [visWeeks]);

  /* tooltip x is clamped into the grid viewport so the ~150px tooltip never
     spills past the panel edges; it sits above the hovered cell (6px gap)
     and flips below it for the top rows, so the hovered cell itself is
     never covered */
  const showCell = useCallback(
    (el) => {
      const scroll = scrollRef.current;
      if (!scroll) return;
      const day = cellByTs.get(Number(el.dataset.ts));
      if (!day) return;
      const left = Math.min(Math.max(el.offsetLeft + cell / 2, 74), scroll.clientWidth - 74);
      const above = el.offsetTop - 58;
      setHover({
        left,
        top: above >= 0 ? above : el.offsetTop + cell + 6,
        cell: day,
      });
    },
    [cellByTs, cell]
  );

  // 事件委托（IMPROVE-52）：mouseover/focusin 从单元格冒泡到容器，外层统一
  // 定位 tooltip；网格因此可以在 hover 变化时整体跳过重渲染。
  const onOver = useCallback(
    (e) => {
      const el = e.target.closest?.('[data-cell]');
      if (el) showCell(el);
    },
    [showCell]
  );
  const onOut = useCallback((e) => {
    if (e.target.closest?.('[data-cell]')) setHover(null);
  }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-control bg-surface">
      <div className="flex items-center justify-between gap-3 px-3 pb-1.5 pt-3">
        <span className="flex min-w-0 items-center gap-1.5 text-[12px] font-medium text-ink">
          <IconBadge className="bg-accent">
            <ArrowDown className="size-2" strokeWidth={3} />
          </IconBadge>
          {t('dashboard.downloadHeatmap')}
        </span>
        <span className="flex shrink-0 items-center gap-1 text-[10px] text-ink-3">
          {t('dashboard.heatmapLegendLow')}
          {HEAT_LEVELS.map((c) => (
            <span key={c} className="size-[9px] rounded-[2px]" style={{ background: c }} />
          ))}
          {t('dashboard.heatmapLegendHigh')}
        </span>
      </div>
      {weeks.length ? (
        <div
          ref={scrollRef}
          className="flex min-h-0 flex-1 px-3 pb-3"
          onMouseOver={onOver}
          onMouseOut={onOut}
          onFocus={onOver}
          onBlur={onOut}
          onMouseLeave={() => setHover(null)}
        >
          {/* the weeks already fit the viewport (overflow is dropped from the
              left), so the grid just centers in whatever space is left */}
          <div className="relative mx-auto my-auto w-max">
            <HeatGrid
              visWeeks={visWeeks}
              months={visMonths}
              max={max}
              cell={cell}
              weekdays={weekdays}
              monthNames={monthNames}
              t={t}
            />
            {hover && (
              <div
                className="pointer-events-none absolute z-10 -translate-x-1/2"
                style={{ left: `${hover.left}px`, top: `${hover.top}px` }}
              >
                <ChartTooltip
                  time={fmtFullDate(hover.cell.ts)}
                  rows={[
                    { label: t('dashboard.download'), value: String(hover.cell.downloads), color: ACCENT },
                  ]}
                />
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="py-16 text-center text-[12px] text-ink-3">
          {rows ? t('dashboard.noData') : t('common.loading')}
        </div>
      )}
    </div>
  );
}
