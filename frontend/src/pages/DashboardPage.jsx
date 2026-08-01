import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getStats } from '../api.js';
import { errMsg, formatSize } from '../utils.js';
import FileIcon from '../components/FileIcon.jsx';
import BorderGlow from '../components/BorderGlow.jsx';
import {
  BsArrowDownRight,
  BsArrowUpRight,
  BsArrowClockwise,
  BsCloudUpload,
  BsDownload,
  BsFolder2Open,
  BsHdd,
} from 'react-icons/bs';

// Shared BorderGlow defaults for all dashboard cards (dark theme).
const GLOW_DEFAULTS = {
  backgroundColor: '#6496f3',
  borderRadius: 16,
  edgeSensitivity: 35,
  glowRadius: 28,
  glowIntensity: 0.8,
  coneSpread: 25,
  glowColor: '230 90 65',
  colors: ['#62ff3b', '#e5ff00', '#38e8ff'],
  fillOpacity: 0.4,
};

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

  const insights = useMemo(() => {
    if (!stats) return null;
    const series = stats.series || [];
    const totalDl = series.reduce((s, d) => s + d.downloads, 0);
    const totalUp = series.reduce((s, d) => s + d.uploads, 0);
    const peakDl = series.reduce(
      (a, b) => (b.downloads > a.downloads ? b : a),
      series[0] || { downloads: 0, date: '-' }
    );
    const wow =
      stats.downloads_prev_7d > 0
        ? ((stats.downloads_7d - stats.downloads_prev_7d) / stats.downloads_prev_7d) * 100
        : stats.downloads_7d > 0
          ? 100
          : 0;
    const dod =
      stats.yesterday_downloads > 0
        ? ((stats.today_downloads - stats.yesterday_downloads) / stats.yesterday_downloads) * 100
        : stats.today_downloads > 0
          ? 100
          : 0;
    return { totalDl, totalUp, peakDl, wow, dod };
  }, [stats]);

  if (loading) {
    return (
      <div className="py-24 text-center">
        <div className="mx-auto mb-3 w-5 h-5 animate-spin rounded-full border-2 border-white/30 border-t-transparent" />
        <p className="text-[13px] text-white/45">加载中…</p>
      </div>
    );
  }

  if (err) {
    return <div className="py-24 text-center text-[14px] text-rose-300">{err}</div>;
  }

  if (!stats) return null;

  const cards = [
    {
      label: 'TODAY',
      title: '今日下载',
      value: stats.today_downloads.toLocaleString(),
      icon: BsDownload,
      delta: insights?.dod,
      deltaHint: '较昨日',
    },
    {
      label: '7-DAY',
      title: '7 日下载',
      value: stats.downloads_7d.toLocaleString(),
      icon: BsDownload,
      delta: insights?.wow,
      deltaHint: '较上周',
    },
    {
      label: 'NEW 7D',
      title: '7 日新增文件',
      value: stats.files_added_7d.toLocaleString(),
      icon: BsCloudUpload,
      sub: formatSize(stats.size_added_7d),
    },
    {
      label: 'STORAGE',
      title: '存储占用',
      value: formatSize(stats.total_size),
      icon: BsHdd,
      sub: `${stats.total_files.toLocaleString()} 文件 · ${stats.total_folders.toLocaleString()} 目录`,
    },
  ];

  return (
    <div className="space-y-8">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-white/40">Overview</p>
          <h1 className="mt-1.5 text-[30px] font-semibold leading-none tracking-tight text-white">
            数据概览
          </h1>
          <p className="mt-2 text-[13px] text-white/55">仲英学辅资料库 · 实时运营指标</p>
        </div>
        <div className="flex items-center gap-3">
          <RangeSwitch value={range} onChange={setRange} />
          <button
            type="button"
            onClick={() => load(true)}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3.5 py-1.5 text-[12px] text-white/60 shadow-sm transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
          >
            <BsArrowClockwise className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </div>
      </header>

      {/* KPI grid */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((c) => (
          <KpiCard key={c.label} {...c} />
        ))}
      </section>

      {/* Activity chart + Type breakdown */}
      <section className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <BorderGlow {...GLOW_DEFAULTS} className="lg:col-span-8" innerClassName="p-6">
          <div className="mb-5 flex items-end justify-between gap-4">
            <div>
              <h2 className="text-[15px] font-medium text-white">近 {range} 日活动</h2>
              <p className="mt-1 text-[12px] text-white/45">下载(实线) · 上传(虚线)</p>
            </div>
            {insights && (
              <div className="flex gap-6">
                <MiniStat label="DOWNLOADS" value={insights.totalDl.toLocaleString()} />
                <MiniStat label="UPLOADS" value={insights.totalUp.toLocaleString()} />
                <MiniStat
                  label="PEAK"
                  value={`${insights.peakDl.downloads}`}
                  hint={insights.peakDl.date}
                />
              </div>
            )}
          </div>
          <ActivityChart series={stats.series} />
        </BorderGlow>

        <BorderGlow {...GLOW_DEFAULTS} className="lg:col-span-4" innerClassName="p-6">
          <h2 className="text-[15px] font-medium text-white">文件类型分布</h2>
          <p className="mt-1 text-[12px] text-white/45">按文件数排序 · 显示前 8 类</p>
          <TypeBreakdown rows={stats.type_breakdown} totalFiles={stats.total_files} />
        </BorderGlow>
      </section>

      {/* Top downloads + Recent uploads */}
      <section className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <BorderGlow {...GLOW_DEFAULTS} className="lg:col-span-7" innerClassName="p-6">
          <h2 className="text-[15px] font-medium text-white">热门下载 TOP 10</h2>
          <p className="mt-1 text-[12px] text-white/45">近 30 日下载次数最多</p>
          <TopDownloads items={stats.top_downloads} />
        </BorderGlow>

        <BorderGlow {...GLOW_DEFAULTS} className="lg:col-span-5" innerClassName="p-6">
          <h2 className="text-[15px] font-medium text-white">最近上传</h2>
          <p className="mt-1 text-[12px] text-white/45">最新 8 个文件</p>
          <RecentUploads items={stats.recent_uploads} />
        </BorderGlow>
      </section>

      {/* Top folders */}
      <BorderGlow {...GLOW_DEFAULTS} innerClassName="p-6">
        <h2 className="text-[15px] font-medium text-white">占用最大的目录 TOP 5</h2>
        <p className="mt-1 text-[12px] text-white/45">按存储体积排序</p>
        <TopFolders items={stats.top_folders} />
      </BorderGlow>
    </div>
  );
}

// ============================================================
// Sub-components
// ============================================================

function RangeSwitch({ value, onChange }) {
  const opts = [
    { v: 7, label: '7日' },
    { v: 30, label: '30日' },
    { v: 90, label: '90日' },
  ];
  return (
    <div className="inline-flex rounded-full border border-white/10 bg-white/[0.06] p-0.5 shadow-sm">
      {opts.map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(o.v)}
          className={`rounded-full px-3 py-1 text-[12px] transition-colors ${
            value === o.v
              ? 'bg-white/15 text-white'
              : 'text-white/45 hover:text-white'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function KpiCard({ label, title, value, icon: Icon, delta, deltaHint, sub }) {
  return (
    <BorderGlow {...GLOW_DEFAULTS} glowRadius={20} innerClassName="group p-5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-[0.2em] text-white/40">{label}</span>
        <Icon className="w-4 h-4 text-white/30 transition-colors group-hover:text-white/60" />
      </div>
      <div className="mt-7 text-[32px] font-semibold leading-none tracking-tight text-white tabular-nums">
        {value}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-[12px] text-white/45">{title}</span>
        {typeof delta === 'number' ? (
          <span
            className={`inline-flex items-center gap-0.5 text-[11px] tabular-nums ${
              delta >= 0 ? 'text-emerald-300/90' : 'text-rose-300/90'
            }`}
            title={deltaHint}
          >
            {delta >= 0 ? (
              <BsArrowUpRight className="w-3 h-3" />
            ) : (
              <BsArrowDownRight className="w-3 h-3" />
            )}
            {Math.abs(delta).toFixed(0)}%
          </span>
        ) : sub ? (
          <span className="truncate text-[11px] text-white/40">{sub}</span>
        ) : null}
      </div>
    </BorderGlow>
  );
}

function MiniStat({ label, value, hint }) {
  return (
    <div className="text-right">
      <div className="text-[10px] uppercase tracking-[0.22em] text-white/40">{label}</div>
      <div className="mt-1 text-[16px] font-medium leading-none text-white tabular-nums">
        {value}
      </div>
      {hint && <div className="mt-1 text-[10px] text-white/35">{hint}</div>}
    </div>
  );
}

function ActivityChart({ series }) {
  const [hoverIdx, setHoverIdx] = useState(null);
  const W = 720;
  const H = 260;
  const PAD_L = 40;
  const PAD_R = 16;
  const PAD_T = 16;
  const PAD_B = 32;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const data = series || [];
  const maxV = Math.max(...data.map((d) => Math.max(d.downloads, d.uploads)), 4);
  const step = data.length > 1 ? innerW / (data.length - 1) : 0;
  const ptsDl = data.map((d, i) => ({
    x: PAD_L + step * i,
    y: PAD_T + innerH - (d.downloads / maxV) * innerH,
    ...d,
  }));
  const ptsUp = data.map((d, i) => ({
    x: PAD_L + step * i,
    y: PAD_T + innerH - (d.uploads / maxV) * innerH,
    ...d,
  }));
  const linePath = (pts) =>
    pts.map((p, i) => (i === 0 ? `M${p.x},${p.y}` : `L${p.x},${p.y}`)).join(' ');
  const areaPath = (pts) =>
    pts.length
      ? `${linePath(pts)} L${pts[pts.length - 1].x},${PAD_T + innerH} L${pts[0].x},${PAD_T + innerH} Z`
      : '';
  const yTicks = [0, 0.5, 1];
  // sparse x labels: ~6 evenly spaced
  const xLabelEvery = Math.max(1, Math.ceil(data.length / 7));

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-[280px] w-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id="dl-area-v2" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgba(255,255,255,0.08)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0)" />
          </linearGradient>
        </defs>

        {yTicks.map((t) => {
          const y = PAD_T + innerH * t;
          const v = Math.round(maxV * (1 - t));
          return (
            <g key={t}>
              <line
                x1={PAD_L}
                x2={W - PAD_R}
                y1={y}
                y2={y}
                stroke="rgba(255,255,255,0.06)"
                strokeDasharray={t === 1 ? '0' : '2 4'}
              />
              <text
                x={PAD_L - 10}
                y={y + 3}
                fontSize="10"
                textAnchor="end"
                fill="rgba(255,255,255,0.35)"
              >
                {v}
              </text>
            </g>
          );
        })}

        {ptsDl.length > 1 && (
          <>
            <path d={areaPath(ptsDl)} fill="url(#dl-area-v2)" />
            <path
              d={linePath(ptsDl)}
              fill="none"
              stroke="#e5e5e5"
              strokeWidth="1.5"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            <path
              d={linePath(ptsUp)}
              fill="none"
              stroke="#10b981"
              strokeWidth="1.4"
              strokeDasharray="3 3"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </>
        )}

        {ptsDl.map((p, i) => {
          const active = hoverIdx === i;
          const showLabel = i % xLabelEvery === 0 || i === ptsDl.length - 1;
          return (
            <g key={p.date + i}>
              {active && (
                <line
                  x1={p.x}
                  x2={p.x}
                  y1={PAD_T}
                  y2={PAD_T + innerH}
                  stroke="rgba(255,255,255,0.15)"
                  strokeDasharray="2 3"
                />
              )}
              {active && (
                <>
                  <circle cx={p.x} cy={p.y} r="4" fill="#0a0a0a" stroke="#e5e5e5" strokeWidth="1.5" />
                  <circle
                    cx={ptsUp[i].x}
                    cy={ptsUp[i].y}
                    r="3.5"
                    fill="#0a0a0a"
                    stroke="#10b981"
                    strokeWidth="1.5"
                  />
                </>
              )}
              {showLabel && (
                <text
                  x={p.x}
                  y={H - 10}
                  fontSize="10"
                  textAnchor="middle"
                  fill="rgba(255,255,255,0.35)"
                >
                  {p.date}
                </text>
              )}
              <rect
                x={p.x - step / 2}
                y={PAD_T}
                width={step || innerW}
                height={innerH}
                fill="transparent"
                onMouseEnter={() => setHoverIdx(i)}
                onMouseLeave={() => setHoverIdx((c) => (c === i ? null : c))}
              />
            </g>
          );
        })}
      </svg>

      {/* Floating tooltip (HTML for nicer formatting) */}
      {hoverIdx != null && ptsDl[hoverIdx] && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-lg border border-white/10 bg-neutral-900 px-3 py-2 text-[11px] text-white shadow-lg"
          style={{
            left: `${(ptsDl[hoverIdx].x / W) * 100}%`,
            top: `${(ptsDl[hoverIdx].y / H) * 100 - 2}%`,
          }}
        >
          <div className="text-white/45 text-[10px] uppercase tracking-wider">
            {ptsDl[hoverIdx].date}
          </div>
          <div className="mt-1 flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-1.5 rounded-full bg-white" />
              下载 {ptsDl[hoverIdx].downloads}
            </span>
            <span className="inline-flex items-center gap-1.5 text-emerald-400">
              <span className="w-3 h-1.5 rounded-full bg-emerald-500" />
              上传 {ptsUp[hoverIdx].uploads}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function TypeBreakdown({ rows, totalFiles }) {
  if (!rows?.length) return <Empty>暂无文件</Empty>;
  const max = rows[0].count || 1;
  return (
    <ul className="mt-5 space-y-3">
      {rows.map((r) => {
        const pct = totalFiles ? (r.count / totalFiles) * 100 : 0;
        return (
          <li key={r.ext}>
            <div className="flex items-center justify-between text-[12px]">
              <span className="inline-flex items-center gap-2 text-white/80">
                <FileIcon type="file" ext={r.ext === 'other' ? '' : r.ext} className="w-3.5 h-3.5" />
                <span className="uppercase tracking-wider">{r.ext}</span>
              </span>
              <span className="tabular-nums text-white/55">
                {r.count.toLocaleString()}
                <span className="ml-2 text-white/30">{pct.toFixed(1)}%</span>
              </span>
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className="h-full rounded-full bg-white/60"
                style={{ width: `${(r.count / max) * 100}%` }}
              />
            </div>
            <div className="mt-1 text-right text-[10px] text-white/35">{formatSize(r.size)}</div>
          </li>
        );
      })}
    </ul>
  );
}

function TopDownloads({ items }) {
  if (!items?.length) return <Empty>近期暂无下载记录</Empty>;
  const max = items[0].count || 1;
  return (
    <ol className="mt-5 space-y-2">
      {items.map((f, i) => (
        <li
          key={f.file_id || `${f.file_name}-${i}`}
          className="group flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-white/[0.04]"
        >
          <span className="w-5 text-right text-[11px] tabular-nums text-white/35">{i + 1}</span>
          <FileIcon type="file" ext={f.ext} className="w-4 h-4 shrink-0" />
          <Link
            to={f.folder_id ? `/folder/${f.folder_id}` : '/'}
            className="min-w-0 flex-1 truncate text-[13px] text-white/85 hover:text-white"
            title={f.file_name}
          >
            {f.file_name}
          </Link>
          <div className="flex w-32 items-center gap-2">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className="h-full rounded-full bg-white/60 group-hover:bg-white/80"
                style={{ width: `${(f.count / max) * 100}%` }}
              />
            </div>
            <span className="w-8 text-right text-[11px] tabular-nums text-white/70">{f.count}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}

function RecentUploads({ items }) {
  if (!items?.length) return <Empty>暂无上传</Empty>;
  return (
    <ul className="mt-5 space-y-1">
      {items.map((f) => (
        <li key={f.id}>
          <Link
            to={f.folder_id ? `/folder/${f.folder_id}` : '/'}
            className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-white/[0.04]"
          >
            <FileIcon type="file" ext={f.ext} className="w-4 h-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate text-[13px] text-white/85" title={f.name}>
              {f.name}
            </span>
            <span className="shrink-0 text-[11px] tabular-nums text-white/40">
              {formatSize(f.size)}
            </span>
            <span className="w-16 shrink-0 text-right text-[11px] text-white/35">
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
    <ul className="mt-5 space-y-3">
      {items.map((f) => (
        <li key={f.id}>
          <div className="flex items-center justify-between text-[12px]">
            <Link
              to={`/folder/${f.id}`}
              className="inline-flex items-center gap-2 text-white/85 hover:text-white"
            >
              <BsFolder2Open className="w-3.5 h-3.5 text-white/45" />
              <span className="truncate">{f.name}</span>
            </Link>
            <span className="tabular-nums text-white/55">
              {formatSize(f.size)}
              <span className="ml-2 text-white/30">{f.file_count} 文件</span>
            </span>
          </div>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className="h-full rounded-full bg-white/60"
              style={{ width: `${(f.size / max) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Empty({ children }) {
  return <div className="mt-6 py-8 text-center text-[12px] text-white/35">{children}</div>;
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
