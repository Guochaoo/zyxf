import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getStats, getHeatmap } from '../api.js';
import { errMsg, formatSize, timeAgo } from '../utils.js';
import FileIcon from '../components/FileIcon.jsx';
import { AnomalyCard, AllocationCard, ChartTooltip, IconBadge, densifyBySpline } from '../components/InsightCards.jsx';
import { BsArrowClockwise, BsFolder2Open } from 'react-icons/bs';
import { ArrowDown, ArrowUp, BarChart3, HardDrive } from 'lucide-react';

/* ============================================================
 * Insight card design system — liveline-style cards
 * ============================================================ */

const DAY_MS = 86400000;

const ACCENT = '#3d9aff';

/* daily series rows { date, ts, downloads, uploads } → Liveline points.
   Densified to hourly spline samples so liveline's linear hover interpolation
   lands on the drawn curve (see densifyBySpline). */
const toPoints = (rows, key) =>
  densifyBySpline(rows.map((d) => ({ time: d.ts / 1000, value: d[key], date: d.date })));

/* week-over-week percent change */
const pctChange = (cur, prev) =>
  prev > 0 ? ((cur - prev) / prev) * 100 : cur > 0 ? 100 : 0;

/* allocation segment palette — all solid so the white icon badges stay
   readable on every segment (orange → accent → green → red → violet → teal) */
const PALETTE = [
  { cls: 'bg-orange', tone: 'text-orange', color: 'var(--orange)' },
  { cls: 'bg-accent', tone: 'text-accent', color: 'var(--accent)' },
  { cls: 'bg-green', tone: 'text-green', color: 'var(--green)' },
  { cls: 'bg-red', tone: 'text-red', color: 'var(--red)' },
  { cls: 'bg-[#8b5cf6]', tone: 'text-[#8b5cf6]', color: '#8b5cf6' },
  { cls: 'bg-[#14b8a6]', tone: 'text-[#14b8a6]', color: '#14b8a6' },
];

function Card({ className = '', children }) {
  return (
    <div className={`rounded-card bg-surface p-3 ${className}`.trim()}>
      {children}
    </div>
  );
}

function CardHeader({ title, sub, icon, badgeClass }) {
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

/* ---- Activity heatmap: GitHub-style year grid ---- */

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

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

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

function ActivityHeatmap({ rows }) {
  const scrollRef = useRef(null);
  const [hover, setHover] = useState(null);
  const [box, setBox] = useState(null); // measured grid viewport { w, h }

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

  /* tooltip x is clamped into the grid viewport so the ~150px tooltip never
     spills past the panel edges; it sits above the hovered cell (6px gap)
     and flips below it for the top rows, so the hovered cell itself is
     never covered */
  const onCellEnter = (e, day) => {
    const el = e.currentTarget;
    const scroll = scrollRef.current;
    if (!scroll) return;
    const left = Math.min(
      Math.max(el.offsetLeft + cell / 2, 74),
      scroll.clientWidth - 74
    );
    const above = el.offsetTop - 58;
    setHover({
      left,
      top: above >= 0 ? above : el.offsetTop + cell + 6,
      cell: day,
    });
  };

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-control bg-surface">
      <div className="flex items-center justify-between gap-3 px-3 pb-1.5 pt-3">
        <span className="flex min-w-0 items-center gap-1.5 text-[12px] font-medium text-ink">
          <IconBadge className="bg-accent">
            <ArrowDown className="size-2" strokeWidth={3} />
          </IconBadge>
          下载热力图
        </span>
        <span className="flex shrink-0 items-center gap-1 text-[10px] text-ink-3">
          少
          {HEAT_LEVELS.map((c) => (
            <span key={c} className="size-[9px] rounded-[2px]" style={{ background: c }} />
          ))}
          多
        </span>
      </div>
      {weeks.length ? (
        <div
          ref={scrollRef}
          className="flex min-h-0 flex-1 px-3 pb-3"
          onMouseLeave={() => setHover(null)}
        >
          {/* the weeks already fit the viewport (overflow is dropped from the
              left), so the grid just centers in whatever space is left */}
          <div className="relative mx-auto my-auto w-max">
            <div className="mb-1 flex" style={{ gap: HEAT_GAP }}>
              {visMonths.map((m, w) => (
                <span
                  key={w}
                  style={{ width: cell }}
                  className="whitespace-nowrap text-[10px] leading-none text-ink-3"
                >
                  {m != null ? `${m + 1}月` : ''}
                </span>
              ))}
            </div>
            <div className="flex" style={{ gap: HEAT_GAP }}>
              <div className="mr-1 flex flex-col" style={{ gap: HEAT_GAP }}>
                {WEEKDAYS.map((name, i) => (
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
                        style={{
                          width: cell,
                          height: cell,
                          background: HEAT_LEVELS[heatLevel(day.downloads, max)],
                        }}
                        className="rounded-[2px] transition-shadow hover:ring-1 hover:ring-line-strong"
                        onMouseEnter={(e) => onCellEnter(e, day)}
                      />
                    ) : (
                      <span key={day.ts} style={{ width: cell, height: cell }} />
                    )
                  )}
                </div>
              ))}
            </div>
            {hover && (
              <div
                className="pointer-events-none absolute z-10 -translate-x-1/2"
                style={{ left: `${hover.left}px`, top: `${hover.top}px` }}
              >
                <ChartTooltip
                  time={fmtFullDate(hover.cell.ts)}
                  rows={[
                    { label: '下载', value: String(hover.cell.downloads), color: ACCENT },
                  ]}
                />
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="py-16 text-center text-[12px] text-ink-3">
          {rows ? '近一年暂无活动' : '加载中…'}
        </div>
      )}
    </div>
  );
}

/* ---- List cards (top downloads / recent uploads / top folders) ---- */

function TopDownloads({ items }) {
  if (!items?.length) return <Empty>近期暂无下载记录</Empty>;
  const max = items[0].count || 1;
  return (
    <ol className="mt-3 space-y-0.5">
      {items.map((f, i) => (
        <li
          key={f.file_id || `${f.file_name}-${i}`}
          className="group flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-hover"
        >
          <span className="w-5 text-right text-[11px] tabular-nums text-ink-3">{i + 1}</span>
          <FileIcon type="file" ext={f.ext} className="h-4 w-4 shrink-0" />
          <Link
            to={f.folder_id ? `/folder/${f.folder_id}` : '/'}
            className="min-w-0 flex-1 truncate text-[13px] text-ink hover:text-ink-2"
            title={f.file_name}
          >
            {f.file_name}
          </Link>
          <div className="flex w-32 items-center gap-2">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-field">
              <div
                className="h-full rounded-full bg-accent transition-opacity group-hover:opacity-75"
                style={{ width: `${(f.count / max) * 100}%` }}
              />
            </div>
            <span className="w-8 text-right text-[11px] tabular-nums text-ink-2">{f.count}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}

function RecentUploads({ items }) {
  if (!items?.length) return <Empty>暂无上传</Empty>;
  return (
    <ul className="mt-3 grow space-y-0.5">
      {items.map((f) => (
        <li key={f.id}>
          <Link
            to={f.folder_id ? `/folder/${f.folder_id}` : '/'}
            className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-hover"
          >
            <FileIcon type="file" ext={f.ext} className="h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate text-[13px] text-ink" title={f.name}>
              {f.name}
            </span>
            <span className="shrink-0 text-[11px] tabular-nums text-ink-2">{formatSize(f.size)}</span>
            <span className="w-16 shrink-0 text-right text-[11px] text-ink-3">
              {timeAgo(f.created_at)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function TopFolders({ items }) {
  if (!items?.length) return <Empty>暂无目录</Empty>;
  const max = items[0].size || 1;
  return (
    <ul className="mt-3 grow space-y-2.5">
      {items.map((f) => (
        <li key={f.id}>
          <div className="flex items-center justify-between text-[12px]">
            <Link
              to={`/folder/${f.id}`}
              className="inline-flex items-center gap-2 text-ink hover:text-ink-2"
            >
              <BsFolder2Open className="h-3.5 w-3.5 text-ink-2" />
              <span className="truncate">{f.name}</span>
            </Link>
            <span className="tabular-nums text-ink-2">
              {formatSize(f.size)}
              <span className="ml-2 text-ink-3">{f.file_count} 文件</span>
            </span>
          </div>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-field">
            <div
              className="h-full rounded-full bg-orange"
              style={{ width: `${(f.size / max) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function RangeSwitch({ value, onChange }) {
  const opts = [
    { v: 7, label: '7日' },
    { v: 30, label: '30日' },
    { v: 90, label: '90日' },
  ];
  return (
    <div className="inline-flex rounded-full bg-field p-0.5">
      {opts.map((o) => (
        <button
          key={o.v}
          type="button"
          aria-pressed={value === o.v}
          onClick={() => onChange(o.v)}
          className={`rounded-full px-3 py-1 text-[12px] transition-[background-color,color,box-shadow,transform] duration-150 active:scale-[0.96] ${
            value === o.v ? 'bg-surface text-ink shadow-btn' : 'text-ink-3 hover:text-ink-2'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Empty({ children }) {
  return <div className="mt-6 py-8 text-center text-[12px] text-ink-3">{children}</div>;
}

/* ============================================================
 * Page
 * ============================================================ */

export default function DashboardPage() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState('');
  const [range, setRange] = useState(30);
  // trailing-year activity for the heatmap — intentionally NOT refetched when
  // `range` changes, so the year grid stays put while other cards re-range
  const [heat, setHeat] = useState(null);

  const load = useCallback(
    (silent = false, r = range) => {
      if (silent) setRefreshing(true);
      else setLoading(true);
      return getStats(r)
        .then((d) => {
          setStats(d);
          setErr('');
        })
        .catch((e) => setErr(errMsg(e, '加载失败')))
        .finally(() => {
          setLoading(false);
          setRefreshing(false);
        });
    },
    [range]
  );

  const loadHeat = () =>
    getHeatmap()
      .then(setHeat)
      .catch(() => {}); // the heatmap panel renders its own empty state

  useEffect(() => {
    load(false, range);
  }, [load, range]);

  useEffect(() => {
    loadHeat();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- derived stats for the insight cards ---- */
  const insights = useMemo(() => {
    if (!stats) return null;
    const series = stats.series || [];
    const peakDl = series.reduce(
      (a, b) => (b.downloads > a.downloads ? b : a),
      series[0] || { downloads: 0, date: '-' }
    );

    // full selected range for the card charts — follows the 7/30/90 switch
    const dlPts = toPoints(series, 'downloads');
    const upPts = toPoints(series, 'uploads');

    // today vs yesterday for the upload metric
    const todayUp = series.at(-1)?.uploads ?? 0;
    const dodUp = pctChange(todayUp, series.at(-2)?.uploads ?? 0);

    // peak upload count over the visible window
    const peakUp = series.reduce((m, d) => Math.max(m, d.uploads), 0);

    return { peakDl, dodUp, todayUp, peakUp, dlPts, upPts };
  }, [stats]);

  const typeSegments = useMemo(() => {
    if (!stats) return [];
    const rows = (stats.type_breakdown || []).slice(0, 6);
    const total = stats.total_files;
    return rows.map((r, i) => ({
      name: (r.ext || 'other').toUpperCase(),
      label: r.ext || 'other',
      badge: (r.ext || 'o').charAt(0).toUpperCase(),
      pct: total ? (r.count / total) * 100 : 0,
      amount: `${total ? ((r.count / total) * 100).toFixed(1) : 0}%`,
      desc: `${r.count.toLocaleString()} 个文件 · 共 ${formatSize(r.size)}`,
      ...PALETTE[i % PALETTE.length],
    }));
  }, [stats]);

  // memoized so AnomalyCard doesn't re-render on unrelated dashboard state
  // (e.g. refreshing toggles) when stats/insights are unchanged.
  const metrics = useMemo(() => {
    if (!stats || !insights) return null;
    const dlDod = pctChange(stats.today_downloads, stats.yesterday_downloads);
    return [
      {
        key: 'downloads',
        label: '下载',
        points: insights.dlPts,
        value: stats.today_downloads,
        thresholdText: `峰值 ${insights.peakDl.downloads} 次`,
        footer: `${stats.today_downloads.toLocaleString()} 次下载`,
        delta: dlDod,
        vsText: 'vs 昨日',
        formatValue: (v) => `${Math.round(v)} 次`,
        icon: <ArrowDown className="size-2" strokeWidth={3} />,
      },
      {
        key: 'uploads',
        label: '上传',
        points: insights.upPts,
        value: insights.todayUp,
        thresholdText: `峰值 ${insights.peakUp} 次`,
        footer: `${insights.todayUp.toLocaleString()} 次上传`,
        delta: insights.dodUp,
        vsText: 'vs 昨日',
        formatValue: (v) => `${Math.round(v)} 次`,
        icon: <ArrowUp className="size-2" strokeWidth={3} />,
      },
    ];
  }, [insights, stats]);

  if (loading) {
    return (
      <div className="py-24 text-center">
        <div className="mx-auto mb-3 h-5 w-5 animate-spin rounded-full border-2 border-line border-t-transparent" />
        <p className="text-[13px] text-ink-3">加载中…</p>
      </div>
    );
  }

  if (err) {
    return <div className="py-24 text-center text-[14px] text-red">{err}</div>;
  }

  if (!stats) {
    return <div className="py-24 text-center text-[14px] text-red">{err || '暂无数据'}</div>;
  }

  const typeExtra =
    (stats.type_breakdown?.length ?? 0) > 6 ? (
      <span className="pl-1 text-[10.5px] text-ink-3">+{(stats.type_breakdown?.length ?? 0) - 6} 类</span>
    ) : null;

  return (
    // Card rhythm: sections are spaced like the cards inside them (gap-3).
    // App.jsx gives the dashboard main a fixed pt-[11px] (no sm breakpoint), so
    // the top offset matches the browse page logo (14px) and never jumps.
    <div className="space-y-3">
      {/* Header */}
      <header className="mb-5 flex min-h-[34px] flex-wrap items-center gap-4 pr-[110px] max-[480px]:pr-0">
        <div className="flex h-[34px] items-center">
          <h1 className="flex items-center gap-2">
            <img
              src="/favicon.png"
              alt=""
              aria-hidden="true"
              className="h-7 w-7 rounded-full object-cover"
            />
            <span className="rb-brand-title whitespace-nowrap">统计面板</span>
          </h1>
        </div>
        <div className="ml-auto flex items-center gap-3 max-[480px]:basis-full max-[480px]:justify-end">
          <RangeSwitch value={range} onChange={setRange} />
          <button
            type="button"
            onClick={() => {
              load(true);
              loadHeat();
            }}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-[12px] text-ink shadow-btn transition-colors duration-100 hover:bg-hover disabled:opacity-50"
          >
            <BsArrowClockwise className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </div>
      </header>

      {/* Activity heatmap + file type breakdown */}
      <section className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <ActivityHeatmap rows={heat?.series} />
        </div>

        <div className="lg:col-span-4">
          <AllocationCard title="文件类型分布" segments={typeSegments} extra={typeExtra} />
        </div>
      </section>

      {/* Today snapshot + Top downloads */}
      <section className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <AnomalyCard
          className="lg:col-span-7"
          title="今日"
          metrics={metrics}
        />

        <Card className="lg:col-span-5">
          <CardHeader
            title="下载排行"
            icon={<BarChart3 className="size-2" strokeWidth={3} />}
            badgeClass="bg-accent"
          />
          <TopDownloads items={stats.top_downloads} />
        </Card>
      </section>

      {/* Recent uploads + Top folders */}
      <section className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <Card className="flex flex-col lg:col-span-6">
          <CardHeader
            title="最近上传"
            icon={<ArrowUp className="size-2" strokeWidth={3} />}
            badgeClass="bg-orange"
          />
          <RecentUploads items={stats.recent_uploads} />
        </Card>

        <Card className="flex flex-col lg:col-span-6">
          <CardHeader
            title="占用排行"
            icon={<HardDrive className="size-2" strokeWidth={3} />}
            badgeClass="bg-green"
          />
          <TopFolders items={stats.top_folders} />
        </Card>
      </section>
    </div>
  );
}
