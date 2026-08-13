import { Liveline } from 'liveline';
import { useEffect, useMemo, useState } from 'react';

/* ─────────────────────────────────────────────────────────
 * INSIGHT CARDS
 * Three card styles (compare / anomaly / allocation) driven
 * by real project data. Visuals keep the liveline design
 * system 1:1: bg-surface cards, inset chart panels, hairline
 * shadows, ink text and pill badges.
 * ───────────────────────────────────────────────────────── */

const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';

const formatPercent = (v) => `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;

/* daily-series x-axis labels: local M/D instead of liveline's HH:MM:SS */
const formatDay = (t) => {
  const d = new Date(t * 1e3);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

function useDarkMode() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const update = () => setDark(root.classList.contains('dark'));
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return dark;
}

function Mono({ children, tone }) {
  return (
    <code className={`font-mono text-[11.5px] ${tone === 'red' ? 'text-red' : 'text-green'}`}>
      {children}
    </code>
  );
}

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
          <span className="insight-chart-tooltip-label"><span className="insight-chart-tooltip-dot" style={{ background: row.color }} />{row.label}</span>
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

/* 1 — compare: 2 series, legend + big deltas + line chart
   props: seriesA / seriesB = { name, delta, sub, color, points },
          windowSecs (time-axis window), formatValue */
export function CompareCard({ seriesA, seriesB, formatValue }) {
  const dark = useDarkMode();
  const [hoverIndex, setHoverIndex] = useState(null);
  const n = seriesA.points.length;
  const windowSecs = Math.max(
    (n - 1) * (seriesA.points[1]?.time - seriesA.points[0]?.time || 7),
    7
  );

  const series = useMemo(
    () => [
      {
        id: seriesA.name,
        label: '',
        data: seriesA.points,
        value: seriesA.points.at(-1)?.value ?? 0,
        color: seriesA.color,
      },
      {
        id: seriesB.name,
        label: '',
        data: seriesB.points,
        value: seriesB.points.at(-1)?.value ?? 0,
        color: seriesB.color,
      },
    ],
    [seriesA, seriesB],
  );

  const legend = [
    {
      name: seriesA.name,
      delta: seriesA.delta,
      sub: seriesA.sub,
      color: seriesA.color,
      tone: seriesA.delta >= 0 ? 'green' : 'red',
    },
    {
      name: seriesB.name,
      delta: seriesB.delta,
      sub: seriesB.sub,
      color: seriesB.color,
      tone: seriesB.delta >= 0 ? 'green' : 'red',
    },
  ];

  return (
    <div className="min-h-[278px] rounded-card bg-surface p-3 shadow-hairline">
      <div className="flex items-center gap-4">
        {legend.map((s) => (
          <div key={s.name} className="flex-1">
            <span className="flex items-center gap-1.5 text-[11.5px] text-ink-2">
              <span className="size-2 rounded-full" style={{ background: s.color }} />
              {s.name}
            </span>
            <span className={`block text-[17px] font-semibold tracking-[-0.01em] tabular-nums ${s.tone === 'red' ? 'text-red' : 'text-green'}`}>
              {formatPercent(s.delta)}
            </span>
            <Mono tone={s.tone}>{s.sub}</Mono>
          </div>
        ))}
      </div>
      <div className="mt-2 overflow-hidden rounded-control bg-inset shadow-hairline">
        <div className="flex items-center justify-between border-b border-line px-2.5 py-1.5">
          <span className="text-[11px] text-ink-3 tabular-nums">
            Trend snapshot
          </span>
          <span className="rounded-full bg-field px-2 py-0.5 text-[10.5px] font-medium text-ink-2">
            Snapshot
          </span>
        </div>
        <div
          className="insight-chart-stage relative h-[166px]"
          onPointerDown={(event) => setHoverIndex(chartIndexFromPointer(event, n))}
          onPointerMove={(event) => setHoverIndex(chartIndexFromPointer(event, n))}
          onPointerLeave={() => setHoverIndex(null)}
          onPointerCancel={() => setHoverIndex(null)}
          onPointerUp={() => setHoverIndex(null)}
        >
          <Liveline
            data={[]}
            value={0}
            series={series}
            theme={dark ? 'dark' : 'light'}
            grid={false}
            pulse={false}
            window={windowSecs}
            paused
            scrub={false}
            cursor="default"
            lineWidth={2.25}
            padding={{ top: 24, right: 0, bottom: 22, left: 0 }}
            formatValue={formatValue}
            formatTime={formatDay}
          />
          <HoverMarker index={hoverIndex} count={n}>
            <ChartTooltip
              time={seriesA.points[hoverIndex]?.date ?? ''}
              rows={[
                { label: seriesA.name, value: formatValue(seriesA.points[hoverIndex]?.value), color: seriesA.color },
                { label: seriesB.name, value: formatValue(seriesB.points[hoverIndex]?.value), color: seriesB.color },
              ]}
            />
          </HoverMarker>
        </div>
      </div>
    </div>
  );
}

/* 2 — anomaly: threshold + big value, metric toggle, line chart
   props: title, metrics = [{ key, label, points, value, thresholdText,
          footer, delta, vsText, formatValue }] (exactly two) */
export function AnomalyCard({ title, metrics }) {
  const dark = useDarkMode();
  const [activeIdx, setActiveIdx] = useState(0);
  const [hoverIndex, setHoverIndex] = useState(null);
  const m = metrics[activeIdx];
  const data = m.points;
  const value = m.value ?? data.at(-1)?.value ?? 0;
  const formatM = m.formatValue ?? ((v) => String(Math.round(v)));
  const windowSecs = Math.max(
    (data.length - 1) * (data[1]?.time - data[0]?.time || 7),
    7
  );

  return (
    <div className="min-h-[278px] rounded-card bg-surface p-3 shadow-hairline">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[12px] font-medium text-ink">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
          {title}
        </span>
        <span className="rounded-full bg-field px-2 py-0.5 text-[10.5px] font-medium text-ink-2">
          Snapshot
        </span>
      </div>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className="text-[17px] font-semibold tracking-[-0.01em] text-ink tabular-nums">
          {m.footer}
        </span>
        <Mono tone={m.delta >= 0 ? 'green' : 'red'}>{formatPercent(m.delta)}</Mono>
        <span className="text-[11px] text-ink-3">{m.vsText}</span>
      </div>
      <div className="mt-2 overflow-hidden rounded-control bg-inset shadow-hairline">
        <div className="flex items-center justify-between border-b border-line px-2.5 py-1.5">
          <span className="text-[11px] text-ink-3 tabular-nums">
            {hoverIndex !== null ? formatM(data[hoverIndex].value) : m.thresholdText}
          </span>
          <span className="flex rounded-full bg-field p-0.5">
            {metrics.map((item, i) => (
              <button
                key={item.key}
                type="button"
                aria-pressed={activeIdx === i}
                onClick={() => setActiveIdx(i)}
                className={`rounded-full px-2 py-0.5 text-[10.5px] font-medium transition-[background-color,color,box-shadow,transform] duration-150 active:scale-[0.96] ${
                  activeIdx === i ? 'bg-surface text-ink shadow-btn' : 'text-ink-3 hover:text-ink-2'
                }`}
              >
                {item.label}
              </button>
            ))}
          </span>
        </div>
        <div
          className="insight-chart-stage relative h-[166px]"
          onPointerDown={(event) => setHoverIndex(chartIndexFromPointer(event, data.length))}
          onPointerMove={(event) => setHoverIndex(chartIndexFromPointer(event, data.length))}
          onPointerLeave={() => setHoverIndex(null)}
          onPointerCancel={() => setHoverIndex(null)}
          onPointerUp={() => setHoverIndex(null)}
        >
          <Liveline
            data={data}
            value={value}
            theme={dark ? 'dark' : 'light'}
            color="#ee5c61"
            grid
            scrub={false}
            fill={false}
            pulse={false}
            momentum={false}
            paused
            window={windowSecs}
            lineWidth={2.25}
            cursor="crosshair"
            padding={{ top: 18, right: 0, bottom: 22, left: 0 }}
            formatValue={formatM}
            formatTime={formatDay}
          />
          <HoverMarker index={hoverIndex} count={data.length}>
            <ChartTooltip
              time={data[hoverIndex]?.date ?? ''}
              rows={[{ label: m.label, value: formatM(data[hoverIndex]?.value), color: 'var(--red)' }]}
            />
          </HoverMarker>
        </div>
      </div>
    </div>
  );
}

/* 3 — allocation: hero number + segmented bar + legend
   props: title, segments = [{ name, label, badge, pct, amount, desc, cls, tone }],
          extra (optional trailing legend node) */
export function AllocationCard({ title, segments, extra }) {
  const [selected, setSelected] = useState(segments[0]?.name ?? null);
  const active = segments.find((segment) => segment.name === selected) ?? segments[0];
  if (!active) return null;

  return (
    <div className="min-h-[278px] rounded-card bg-surface p-3 shadow-hairline">
      <span className="flex items-center gap-1.5 text-[12px] font-medium text-ink">
        <span className={`flex size-3.5 items-center justify-center rounded-full text-[8px] font-bold text-white ${active.cls}`}>
          {active.badge}
        </span>
        {title}
      </span>
      <span className="mt-1 block text-[20px] font-semibold tracking-[-0.01em] text-ink tabular-nums">
        {active.amount}
      </span>
      <div
        className="mt-3 flex h-9 gap-0.5 overflow-hidden rounded-full bg-field p-0.5"
        role="group"
        aria-label="Allocation segments"
      >
        {segments.map((s) => (
          <button
            key={s.name}
            type="button"
            aria-pressed={selected === s.name}
            aria-label={`${s.label}: ${s.pct.toFixed(1)}%`}
            onClick={() => setSelected(s.name)}
            className={`relative h-full overflow-hidden rounded-full ${s.cls} transition-[opacity,transform,box-shadow] duration-300 active:scale-[0.98]`}
            style={{
              width: `${s.pct}%`,
              opacity: selected === s.name ? 1 : 0.58,
              boxShadow: selected === s.name ? 'inset 0 0 0 1px rgba(255,255,255,0.22)' : undefined,
              transitionTimingFunction: EASE,
            }}
          >
            <span
              className="absolute inset-y-1 left-1 rounded-full bg-white/20 transition-[width,opacity] duration-500"
              style={{
                width: selected === s.name ? 'calc(100% - 8px)' : '0%',
                opacity: selected === s.name ? 1 : 0,
                transitionTimingFunction: EASE,
              }}
            />
          </button>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-4 items-center gap-1.5">
        {segments.map((s) => (
          <button
            key={s.name}
            type="button"
            aria-pressed={selected === s.name}
            onClick={() => setSelected(s.name)}
            className={`flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] transition-[background-color,color,transform] duration-150 active:scale-[0.96] ${
              selected === s.name ? 'bg-field text-ink' : 'text-ink-2 hover:bg-hover hover:text-ink'
            }`}
          >
            <span className={`size-1.5 rounded-full ${s.cls}`} />
            {s.name} <span className="tabular-nums">{s.pct.toFixed(1)}%</span>
          </button>
        ))}
        {extra}
      </div>
      <div className="mt-3 min-h-16 rounded-control bg-inset px-2.5 py-2 shadow-hairline">
        <span className={`block text-[11.5px] font-medium ${active.tone}`}>{active.label}</span>
        <span className="mt-1 block text-[11px] leading-relaxed text-ink-3">
          {active.desc}
        </span>
      </div>
    </div>
  );
}
