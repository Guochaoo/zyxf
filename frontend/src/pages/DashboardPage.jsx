import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getStats, getHeatmap } from '../api.js';
import { errMsg, formatSize, timeAgo } from '../utils.js';
import { folderTarget } from '../ui.js';
import FileIcon from '../components/FileIcon.jsx';
import { AnomalyCard, AllocationCard, densifyBySpline } from '../components/InsightCards.jsx';
import { BsArrowClockwise, BsFolder2Open } from 'react-icons/bs';
import { ArrowDown, ArrowUp, BarChart3, HardDrive } from 'lucide-react';
// 页面级子模块（IMPROVE-01）：无状态展示已迁出，页面只保留数据编排。
import ActivityHeatmap from './Dashboard/ActivityHeatmap.jsx';
import { Card, CardHeader, Empty, RangeSwitch } from './Dashboard/primitives.jsx';

/* ============================================================
 * Insight card design system — liveline-style cards
 * ============================================================ */

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

/* ---- List cards (top downloads / recent uploads / top folders) ---- */

function TopDownloads({ items }) {
  const { t } = useTranslation();
  if (!items?.length) return <Empty>{t('dashboard.noData')}</Empty>;
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
            to={folderTarget(f.folder_id)}
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
  const { t } = useTranslation();
  if (!items?.length) return <Empty>{t('dashboard.noData')}</Empty>;
  return (
    <ul className="mt-3 grow space-y-0.5">
      {items.map((f) => (
        <li key={f.id}>
          <Link
            to={folderTarget(f.folder_id)}
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
  const { t } = useTranslation();
  if (!items?.length) return <Empty>{t('dashboard.noData')}</Empty>;
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
              <span className="ml-2 text-ink-3">{t('dashboard.folderCount', { count: f.file_count })}</span>
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

// RangeSwitch / Empty / Card / CardHeader 已迁至 ./Dashboard/primitives.jsx（IMPROVE-01）

/* ============================================================
 * Page
 * ============================================================ */

export default function DashboardPage() {
  const { t } = useTranslation();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState('');
  const [range, setRange] = useState(30);
  // trailing-year activity for the heatmap — intentionally NOT refetched when
  // `range` changes, so the year grid stays put while other cards re-range
  const [heat, setHeat] = useState(null);
  // 区间切换与「已有数据的刷新」不能回到整页 loading：那会把区间切换器从 DOM 里摘掉，
  // 用户在等待期间无法再点一次（BUG-57 的测试就是这样卡住的）。初次加载仍走整页 loading。
  const [switching, setSwitching] = useState(false);
  const loadReqIdRef = useRef(0);

  const load = useCallback(
    (silent = false, r = range) => {
      // 请求序号守卫（BUG-57）：快速连点「7 天 → 30 天」时两个请求并发，若先发的后到，
      // 卡片数据会被旧区间覆盖而切换器高亮新区间；两个 finally 也会让 loading 提前复位。
      const reqId = (loadReqIdRef.current += 1);
      if (silent) setRefreshing(true);
      else {
        setLoading(true);
        setSwitching(true);
      }
      return getStats(r)
        .then((d) => {
          if (reqId !== loadReqIdRef.current) return;
          setStats(d);
          setErr('');
        })
        .catch((e) => {
          if (reqId === loadReqIdRef.current) setErr(errMsg(e, t('dashboard.noData')));
        })
        .finally(() => {
          if (reqId !== loadReqIdRef.current) return;
          setLoading(false);
          setRefreshing(false);
          setSwitching(false);
        });
    },
    [range]
  );

  // 热力图请求序号 + 卸载守卫：它与统计走同一个「刷新」按钮，却漏了 BUG-57 加的守卫——
  // 连点刷新时旧热力图响应后到会把新年份网格盖回去，卸载后还会 setState。
  const heatReqIdRef = useRef(0);
  const heatAliveRef = useRef(true);
  useEffect(() => () => { heatAliveRef.current = false; }, []);

  const loadHeat = () => {
    const reqId = (heatReqIdRef.current += 1);
    return getHeatmap()
      .then((d) => {
        if (!heatAliveRef.current || reqId !== heatReqIdRef.current) return;
        setHeat(d);
      })
      .catch(() => {}); // the heatmap panel renders its own empty state
  };

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
      desc: `${r.count.toLocaleString()} ${t('dashboard.files')} · ${t('dashboard.sizeAndTotal', { size: formatSize(r.size) })}`,
      ...PALETTE[i % PALETTE.length],
    }));
  }, [stats, t]);

  // memoized so AnomalyCard doesn't re-render on unrelated dashboard state
  // (e.g. refreshing toggles) when stats/insights are unchanged.
  const metrics = useMemo(() => {
    if (!stats || !insights) return null;
    const dlDod = pctChange(stats.today_downloads, stats.yesterday_downloads);
    return [
      {
        key: 'downloads',
        label: t('dashboard.download'),
        points: insights.dlPts,
        value: stats.today_downloads,
        thresholdText: t('dashboard.peak', { count: insights.peakDl.downloads }),
        footer: t('dashboard.todayDl', { count: stats.today_downloads }),
        delta: dlDod,
        vsText: t('dashboard.vsYesterday'),
        formatValue: (v) => `${Math.round(v)} ${t('dashboard.times')}`,
        icon: <ArrowDown className="size-2" strokeWidth={3} />,
      },
      {
        key: 'uploads',
        label: t('dashboard.upload'),
        points: insights.upPts,
        value: insights.todayUp,
        thresholdText: t('dashboard.peak', { count: insights.peakUp }),
        footer: t('dashboard.todayUp', { count: insights.todayUp }),
        delta: insights.dodUp,
        vsText: t('dashboard.vsYesterday'),
        formatValue: (v) => `${Math.round(v)} ${t('dashboard.times')}`,
        icon: <ArrowUp className="size-2" strokeWidth={3} />,
      },
    ];
  }, [insights, stats, t]);

  // 只有「首次加载」才整页转圈；后续请求（切换区间/刷新）保留现有卡片，避免布局跳空。
  if (loading && !stats) {
    return (
      <div className="py-24 text-center">
        <div className="mx-auto mb-3 h-5 w-5 animate-spin rounded-full border-2 border-line border-t-transparent" />
        <p className="text-[13px] text-ink-3">{t('common.loading')}</p>
      </div>
    );
  }

  if (err) {
    return <div className="py-24 text-center text-[14px] text-red">{err}</div>;
  }

  if (!stats) {
    return <div className="py-24 text-center text-[14px] text-red">{t('dashboard.noData')}</div>;
  }

  // 用后端返回的真实类型总数算「其余」：type_breakdown 只含前 8 类，
  // 用它的长度推算会在类型超 8 时低估（BUG-24）。
  const shownTypes = Math.min(stats.type_total ?? stats.type_breakdown?.length ?? 0, 6);
  const hiddenTypes = Math.max((stats.type_total ?? 0) - shownTypes, 0);
  const typeExtra = hiddenTypes > 0 ? (
    <span className="pl-1 text-[10.5px] text-ink-3">{t('dashboard.moreTypes', { count: hiddenTypes })}</span>
  ) : null;

  return (
    // Card rhythm: sections are spaced like the cards inside them (gap-3).
    // App.jsx gives the dashboard main a fixed pt-[11px] (no sm breakpoint), so
    // the top offset matches the browse page logo (14px) and never jumps.
    <div className={`space-y-3 transition-opacity duration-150 ${switching ? 'opacity-60' : ''}`}>
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
            <span className="rb-brand-title whitespace-nowrap">{t('dashboard.title')}</span>
          </h1>
        </div>
        <div className="ml-auto flex items-center gap-3 max-[480px]:basis-full max-[480px]:justify-end">
          <RangeSwitch value={range} onChange={setRange} disabled={switching} />
          <button
            type="button"
            onClick={() => {
              load(true);
              loadHeat();
            }}
            disabled={refreshing || switching}
            className="inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-[12px] text-ink shadow-btn transition-colors duration-100 hover:bg-hover disabled:opacity-50"
          >
            <BsArrowClockwise className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            {t('dashboard.refresh')}
          </button>
        </div>
      </header>

      {/* Activity heatmap + file type breakdown */}
      <section className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <ActivityHeatmap rows={heat?.series} />
        </div>

        <div className="lg:col-span-4">
          <AllocationCard title={t('dashboard.typeDist')} segments={typeSegments} extra={typeExtra} />
        </div>
      </section>

      {/* Today snapshot + Top downloads */}
      <section className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <AnomalyCard
          className="lg:col-span-7"
          title={t('common.today')}
          metrics={metrics}
        />

        <Card className="lg:col-span-5">
          <CardHeader
            title={t('dashboard.downloads')}
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
            title={t('dashboard.recentUploads')}
            icon={<ArrowUp className="size-2" strokeWidth={3} />}
            badgeClass="bg-orange"
          />
          <RecentUploads items={stats.recent_uploads} />
        </Card>

        <Card className="flex flex-col lg:col-span-6">
          <CardHeader
            title={t('dashboard.topFolders')}
            icon={<HardDrive className="size-2" strokeWidth={3} />}
            badgeClass="bg-green"
          />
          <TopFolders items={stats.top_folders} />
        </Card>
      </section>
    </div>
  );
}
