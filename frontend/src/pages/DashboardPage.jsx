import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Liveline } from 'liveline';
import { getStats } from '../api.js';
import { errMsg, formatSize } from '../utils.js';
import FileIcon from '../components/FileIcon.jsx';
import { CompareCard, AnomalyCard, AllocationCard } from '../components/InsightCards.jsx';
import { BsArrowClockwise, BsFolder2Open } from 'react-icons/bs';

/* ============================================================
 * Insight card design system — liveline-style cards
 * ============================================================ */

const DAY_S = 86400; // liveline time axis is in seconds

const ACCENT = '#3d9aff';
const ORANGE = '#f68f3c';

/* daily series rows { date, ts, downloads, uploads } → Liveline points */
const toPoints = (rows, key) =>
  rows.map((d) => ({ time: d.ts / 1000, value: d[key], date: d.date }));

/* daily-series x-axis labels: local M/D instead of liveline's HH:MM:SS */
const formatDay = (t) => {
  const d = new Date(t * 1e3);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

/* week-over-week percent change */
const pctChange = (cur, prev) =>
  prev > 0 ? ((cur - prev) / prev) * 100 : cur > 0 ? 100 : 0;

/* allocation segment palette (orange → accent → green → muted) */
const PALETTE = [
  { cls: 'bg-orange', tone: 'text-orange', color: 'var(--orange)' },
  { cls: 'bg-accent', tone: 'text-accent', color: 'var(--accent)' },
  { cls: 'bg-green', tone: 'text-green', color: 'var(--green)' },
  { cls: 'bg-line-strong', tone: 'text-ink-2', color: 'rgba(23,23,23,0.14)' },
  { cls: 'bg-red', tone: 'text-red', color: 'var(--red)' },
  { cls: 'bg-line', tone: 'text-ink-3', color: 'rgba(23,23,23,0.08)' },
];

function Card({ className = '', children }) {
  return (
    <div className={`rounded-card bg-surface p-3 shadow-hairline ${className}`.trim()}>
      {children}
    </div>
  );
}

function CardHeader({ title, sub, pill }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-[13px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
        {sub && <p className="mt-0.5 text-[11px] text-ink-3">{sub}</p>}
      </div>
      {pill && (
        <span className="shrink-0 rounded-full bg-field px-2 py-0.5 text-[10.5px] font-medium text-ink-2">
          {pill}
        </span>
      )}
    </div>
  );
}

/* ---- pointer-driven chart hover (cursor line + floating tooltip) ---- */

function chartIndexFromPointer(event, pointCount) {
  const rect = event.currentTarget.getBoundingClientRect();
  const progress = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  return Math.round(progress * (pointCount - 1));
}

function ChartTooltip({ time, rows }) {
  return (
    <div className="insight-chart-tooltip">
      <span className="insight-chart-tooltip-time">{time}</span>
      {rows.map((row) => (
        <div key={row.label} className="insight-chart-tooltip-row">
          <span className="insight-chart-tooltip-label">
            <span className="insight-chart-tooltip-dot" style={{ background: row.color }} />
            {row.label}
          </span>
          <strong>{row.value}</strong>
        </div>
      ))}
    </div>
  );
}

function HoverMarker({ index, count, children }) {
  if (index == null) return null;
  const frac = count > 1 ? (index / (count - 1)) * 100 : 0;
  return (
    <>
      <span className="insight-chart-cursor" style={{ left: `${frac}%` }} />
      <span
        className="insight-chart-tooltip-anchor"
        style={{ left: `${Math.min(Math.max(frac, 28), 72)}%` }}
      >
        {children}
      </span>
    </>
  );
}

/* ---- Activity chart: two-series Liveline in an inset panel ---- */

function ActivityChart({ series }) {
  const [hoverIdx, setHoverIdx] = useState(null);
  const dl = toPoints(series, 'downloads');
  const up = toPoints(series, 'uploads');
  const hover = hoverIdx != null ? series[hoverIdx] : null;
  const setHover = (e) => setHoverIdx(chartIndexFromPointer(e, series.length));
  const clearHover = () => setHoverIdx(null);

  return (
    <div className="overflow-hidden rounded-control bg-inset shadow-hairline">
      <div className="flex items-center justify-between border-b border-line px-2.5 py-1.5">
        <span className="text-[11px] text-ink-3 tabular-nums">Trend snapshot</span>
        <span className="rounded-full bg-field px-2 py-0.5 text-[10.5px] font-medium text-ink-2">
          Snapshot
        </span>
      </div>
      <div
        className="insight-chart-stage relative h-[240px]"
        onPointerDown={setHover}
        onPointerMove={setHover}
        onPointerLeave={clearHover}
        onPointerCancel={clearHover}
        onPointerUp={clearHover}
      >
        <Liveline
          data={[]}
          value={0}
          series={[
            { id: 'downloads', label: '', data: dl, value: dl.at(-1)?.value ?? 0, color: ACCENT },
            { id: 'uploads', label: '', data: up, value: up.at(-1)?.value ?? 0, color: ORANGE },
          ]}
          theme="light"
          grid
          badge={false}
          momentum={false}
          pulse={false}
          paused
          window={Math.max((series.length - 1) * DAY_S, DAY_S)}
          scrub={false}
          cursor="default"
          lineWidth={2.25}
          padding={{ top: 18, right: 8, bottom: 18, left: 8 }}
          formatValue={(v) => String(Math.round(v))}
          formatTime={formatDay}
        />
        <HoverMarker index={hoverIdx} count={series.length}>
          {hover && (
            <ChartTooltip
              time={hover.date}
              rows={[
                { label: '下载', value: String(hover.downloads), color: ACCENT },
                { label: '上传', value: String(hover.uploads), color: ORANGE },
              ]}
            />
          )}
        </HoverMarker>
      </div>
    </div>
  );
}

/* ---- Type breakdown: simple list with bars ---- */

function TypeBreakdown({ rows, totalFiles }) {
  if (!rows?.length) return <Empty>暂无文件</Empty>;
  const max = rows[0].count || 1;
  return (
    <ul className="mt-3 space-y-2.5">
      {rows.map((r) => {
        const pct = totalFiles ? (r.count / totalFiles) * 100 : 0;
        return (
          <li key={r.ext}>
            <div className="flex items-center justify-between text-[12px]">
              <span className="inline-flex items-center gap-2 text-ink">
                <FileIcon type="file" ext={r.ext === 'other' ? '' : r.ext} className="h-3.5 w-3.5" />
                <span className="uppercase tracking-wider">{r.ext}</span>
              </span>
              <span className="tabular-nums text-ink-2">
                {r.count.toLocaleString()}
                <span className="ml-2 text-ink-3">{pct.toFixed(1)}%</span>
              </span>
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-field">
              <div
                className="h-full rounded-full bg-accent"
                style={{ width: `${(r.count / max) * 100}%` }}
              />
            </div>
            <div className="mt-1 text-right text-[10px] text-ink-3">{formatSize(r.size)}</div>
          </li>
        );
      })}
    </ul>
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
    <ul className="mt-3 space-y-0.5">
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
    <ul className="mt-3 space-y-2.5">
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

function MiniStat({ label, value, hint }) {
  return (
    <div className="text-right">
      <div className="text-[10px] uppercase tracking-[0.22em] text-ink-3">{label}</div>
      <div className="mt-1 text-[16px] font-medium leading-none text-ink tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-[10px] text-ink-3">{hint}</div>}
    </div>
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

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} 天前`;
  const mo = Math.floor(d / 30);
  return `${mo} 月前`;
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

  const load = (silent = false, r = range) => {
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
  };

  useEffect(() => {
    load(false, range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  /* ---- derived stats for the three insight cards ---- */
  const insights = useMemo(() => {
    if (!stats) return null;
    const series = stats.series || [];
    const totalDl = series.reduce((s, d) => s + d.downloads, 0);
    const totalUp = series.reduce((s, d) => s + d.uploads, 0);
    const peakDl = series.reduce(
      (a, b) => (b.downloads > a.downloads ? b : a),
      series[0] || { downloads: 0, date: '-' }
    );

    // last 8 days for the card charts
    const tail = series.slice(-8);
    const dl8 = toPoints(tail, 'downloads');
    const up8 = toPoints(tail, 'uploads');

    // 7-day uploads vs previous 7-day uploads (from the daily series)
    const up7 = series.slice(-7).reduce((s, d) => s + d.uploads, 0);
    const upPrev7 = series.slice(-14, -7).reduce((s, d) => s + d.uploads, 0);
    const upWOW = pctChange(up7, upPrev7);

    // 7-day downloads vs previous 7-day downloads
    const wow = pctChange(stats.downloads_7d, stats.downloads_prev_7d);

    // today vs yesterday, both metrics
    const todayUp = series.at(-1)?.uploads ?? 0;
    const yUp = series.at(-2)?.uploads ?? 0;
    const dodUp = pctChange(todayUp, yUp);

    // peak day counts over the visible window
    const peakUp = series.reduce((m, d) => Math.max(m, d.uploads), 0);

    return {
      totalDl,
      totalUp,
      peakDl,
      wow,
      upWOW,
      dodUp,
      todayUp,
      peakUp,
      dl8,
      up8,
    };
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

  if (!stats || !insights) return null;

  const fmt = (v) => String(Math.round(v));
  const dlDod = pctChange(stats.today_downloads, stats.yesterday_downloads);
  const typeExtra =
    (stats.type_breakdown?.length ?? 0) > 6 ? (
      <span className="pl-1 text-[10.5px] text-ink-3">+{(stats.type_breakdown?.length ?? 0) - 6} 类</span>
    ) : null;

  return (
    <div className="space-y-8">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2">
            <img
              src="/favicon.png"
              alt=""
              aria-hidden="true"
              className="h-7 w-7 rounded-full object-cover"
            />
            <span className="rb-brand-title whitespace-nowrap">数据概览</span>
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <RangeSwitch value={range} onChange={setRange} />
          <button
            type="button"
            onClick={() => load(true)}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-[12px] text-ink shadow-btn transition-colors duration-100 hover:bg-hover disabled:opacity-50"
          >
            <BsArrowClockwise className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </div>
      </header>

      {/* Insight cards — the three styles, real data */}
      <section className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <CompareCard
          seriesA={{
            name: '下载',
            delta: insights.wow,
            sub: `7日 ${stats.downloads_7d.toLocaleString()} 次`,
            color: ACCENT,
            points: insights.dl8,
          }}
          seriesB={{
            name: '上传',
            delta: insights.upWOW,
            sub: `7日 ${stats.files_added_7d.toLocaleString()} 个`,
            color: ORANGE,
            points: insights.up8,
          }}
          formatValue={fmt}
        />

        <AnomalyCard
          title="今日下载"
          metrics={[
            {
              key: 'downloads',
              label: '下载',
              points: insights.dl8,
              value: stats.today_downloads,
              thresholdText: `峰值 ${insights.peakDl.downloads} 次`,
              footer: `${stats.today_downloads.toLocaleString()} 次下载`,
              delta: dlDod,
              vsText: 'vs 昨日',
              formatValue: (v) => `${Math.round(v)} 次`,
            },
            {
              key: 'uploads',
              label: '上传',
              points: insights.up8,
              value: insights.todayUp,
              thresholdText: `峰值 ${insights.peakUp} 个`,
              footer: `${insights.todayUp.toLocaleString()} 个文件`,
              delta: insights.dodUp,
              vsText: 'vs 昨日',
              formatValue: (v) => `${Math.round(v)} 个`,
            },
          ]}
        />

        <AllocationCard title="文件类型分布" segments={typeSegments} extra={typeExtra} />
      </section>

      {/* Activity chart + Top downloads */}
      <section className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <Card className="lg:col-span-7">
          <div className="mb-3 flex items-end justify-between gap-4">
            <div>
              <h2 className="text-[13px] font-semibold tracking-[-0.01em] text-ink">
                近 {range} 日活动
              </h2>
              <p className="mt-0.5 text-[11px] text-ink-3">下载(蓝) · 上传(橙)</p>
            </div>
            <div className="flex gap-6">
              <MiniStat label="DOWNLOADS" value={insights.totalDl.toLocaleString()} />
              <MiniStat label="UPLOADS" value={insights.totalUp.toLocaleString()} />
              <MiniStat
                label="PEAK"
                value={`${insights.peakDl.downloads}`}
                hint={insights.peakDl.date}
              />
            </div>
          </div>
          <ActivityChart series={stats.series} />
        </Card>

        <Card className="lg:col-span-5">
          <CardHeader title="热门下载 TOP 10" sub="近 30 日下载次数最多" pill="TOP 10" />
          <TopDownloads items={stats.top_downloads} />
        </Card>
      </section>

      {/* Recent uploads + Top folders */}
      <section className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <Card className="lg:col-span-6">
          <CardHeader title="最近上传" sub="最新 8 个文件" pill="LATEST" />
          <RecentUploads items={stats.recent_uploads} />
        </Card>

        <Card className="lg:col-span-6">
          <CardHeader
            title="占用最大的目录 TOP 5"
            sub="按存储体积排序"
            pill={`${stats.total_files.toLocaleString()} 文件 · ${formatSize(stats.total_size)}`}
          />
          <TopFolders items={stats.top_folders} />
        </Card>
      </section>
    </div>
  );
}
