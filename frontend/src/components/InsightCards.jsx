import { Liveline } from 'liveline';
import { useState } from 'react';

/* ─────────────────────────────────────────────────────────
 * INSIGHT CARDS
 * Three card styles (compare / anomaly / allocation) driven
 * by real project data. Visuals keep the liveline design
 * system 1:1: bg-surface cards, inset chart panels, hairline
 * shadows, ink text and pill badges.
 * ───────────────────────────────────────────────────────── */

const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';

// v ?? 0: the tooltip rows evaluate eagerly even when not hovering, so the
// formatter must tolerate undefined points.
const formatPercent = (v) => `${v > 0 ? '+' : ''}${(v ?? 0).toFixed(2)}%`;

/* solid circle + centered white content (icon or letter) */
export function IconBadge({ className = '', color, children }) {
  return (
    <span
      className={`flex size-3.5 shrink-0 items-center justify-center rounded-full text-white ${className}`}
      style={color ? { background: color } : undefined}
    >
      {children}
    </span>
  );
}

/* daily-series x-axis labels: local M/D instead of liveline's HH:MM:SS */
const formatDay = (t) => {
  const d = new Date(t * 1e3);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

function SubLabel({ children, tone }) {
  return (
    <span className={`text-[11.5px] ${tone === 'red' ? 'text-red' : 'text-green'}`}>
      {children}
    </span>
  );
}

/* liveline lays points out by time on a now-anchored axis (not uniformly by
   index), so hover sync uses its onHover callback; only the nearest point by
   time is needed for the tooltip content. */
/* points are time-sorted (see densifyBySpline), so a binary search finds the
   nearest point in O(log n) instead of a per-frame O(n) scan during hover. */
function nearestIndexByTime(points, time) {
  const n = points.length;
  if (n === 0) return -1;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].time < time) lo = mid + 1;
    else hi = mid;
  }
  // points[lo] is the first point at-or-after `time`; pick whichever of the
  // two neighbours is closer.
  if (lo === 0) return 0;
  const before = points[lo - 1];
  const after = points[lo];
  return Math.abs(before.time - time) <= Math.abs(after.time - time) ? lo - 1 : lo;
}

/* liveline reports hover every animation frame; keep state identity stable
   when the pointer barely moved so React can bail out of re-renders. */
function onLivelineHover(setHover) {
  return (p) => {
    if (!p) {
      setHover(null);
      return;
    }
    setHover((prev) =>
      prev && Math.abs(prev.x - p.x) < 0.5 ? prev : { x: p.x, time: p.time }
    );
  };
}

/* liveline draws the line as a monotone cubic spline but positions its hover
   ball by LINEAR interpolation between points — with sparse daily points the
   ball drifts off the curve between dates. Sampling the exact same spline
   densely (hourly) makes the two agree to sub-pixel accuracy while the
   visible curve stays identical. Tangents ported from liveline's drawSpline
   (Fritsch–Carlson monotone cubic); each sample keeps its day's date. */
export function densifyBySpline(points, samplesPerSegment = 24) {
  const n = points.length;
  if (n < 2 || samplesPerSegment < 2) return points;

  const h = new Array(n - 1);
  const delta = new Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    h[i] = points[i + 1].time - points[i].time;
    delta[i] = h[i] === 0 ? 0 : (points[i + 1].value - points[i].value) / h[i];
  }
  const m = new Array(n);
  m[0] = delta[0];
  m[n - 1] = delta[n - 2];
  for (let i = 1; i < n - 1; i++) {
    m[i] = delta[i - 1] * delta[i] <= 0 ? 0 : (delta[i - 1] + delta[i]) / 2;
  }
  for (let i = 0; i < n - 1; i++) {
    if (delta[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
    } else {
      const alpha = m[i] / delta[i];
      const beta = m[i + 1] / delta[i];
      const s2 = alpha * alpha + beta * beta;
      if (s2 > 9) {
        const s = 3 / Math.sqrt(s2);
        m[i] = s * alpha * delta[i];
        m[i + 1] = s * beta * delta[i];
      }
    }
  }

  const out = [];
  for (let i = 0; i < n - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    for (let k = 0; k < samplesPerSegment; k++) {
      const u = k / samplesPerSegment;
      const u2 = u * u;
      const u3 = u2 * u;
      const value =
        (2 * u3 - 3 * u2 + 1) * p0.value +
        (u3 - 2 * u2 + u) * h[i] * m[i] +
        (-2 * u3 + 3 * u2) * p1.value +
        (u3 - u2) * h[i] * m[i + 1];
      // dayValue: the segment's anchor value — tooltips show real daily
      // counts, not spline-interpolated ones.
      out.push({ time: p0.time + u * h[i], value, date: p0.date, dayValue: p0.value });
    }
  }
  out.push({ ...points[n - 1], dayValue: points[n - 1].value });
  return out;
}

export function ChartTooltip({ time, rows }) {
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

/* cursor line + tooltip anchor pinned to a liveline-reported pixel x. The
   cursor stays on the exact x; the anchor clamps inward so the ~132px-wide
   tooltip never overflows the stage at the edges. */
function HoverMarker({ x, children }) {
  if (x == null) return null;
  return (
    <>
      <span className="insight-chart-cursor" style={{ left: `${x}px` }} />
      <span
        className="insight-chart-tooltip-anchor"
        style={{ left: `clamp(76px, ${x}px, calc(100% - 76px))` }}
      >
        {children}
      </span>
    </>
  );
}

/* 2 — anomaly: threshold + big value, metric toggle, line chart
   props: title, metrics = [{ key, label, points, value, thresholdText,
          footer, delta, vsText, formatValue, icon }] (exactly two).
   The chart shows only the selected metric; keying Liveline by the metric
   remounts it on toggle so the entrance reveal animation replays. */
export function AnomalyCard({ title, metrics, className = '' }) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [hover, setHover] = useState(null);
  const m = metrics[activeIdx];
  const data = m.points;
  const hoverIdx = hover ? nearestIndexByTime(data, hover.time) : null;
  const value = m.value ?? data.at(-1)?.value ?? 0;
  const formatM = m.formatValue ?? ((v) => String(Math.round(v)));
  const windowSecs = Math.max(
    (data.length - 1) * (data[1]?.time - data[0]?.time || 7),
    7
  );

  return (
    <div className={`flex min-h-[278px] flex-col rounded-card bg-surface p-3 ${className}`.trim()}>
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[12px] font-medium text-ink">
          <IconBadge className="bg-red">{m.icon}</IconBadge>
          {title}
          {m.label}
        </span>
      </div>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className="text-[17px] font-semibold tracking-[-0.01em] text-ink tabular-nums">
          {m.footer}
        </span>
        <SubLabel tone={m.delta >= 0 ? 'green' : 'red'}>{formatPercent(m.delta)}</SubLabel>
        <span className="text-[11px] text-ink-3">{m.vsText}</span>
      </div>
      <div className="mt-2 flex flex-1 flex-col overflow-hidden rounded-control bg-inset">
        <div className="flex shrink-0 items-center justify-between px-2.5 py-1.5">
          <span className="text-[11px] text-ink-3 tabular-nums">
            {hoverIdx !== null ? formatM(data[hoverIdx].dayValue ?? data[hoverIdx].value) : m.thresholdText}
          </span>
          <span className="flex rounded-full bg-field p-0.5">
            {metrics.map((item, i) => (
              <button
                key={item.key}
                type="button"
                aria-pressed={activeIdx === i}
                onClick={() => {
                  setActiveIdx(i);
                  setHover(null);
                }}
                className={`rounded-full px-2 py-0.5 text-[10.5px] font-medium transition-[background-color,color,box-shadow,transform] duration-150 active:scale-[0.96] ${
                  activeIdx === i ? 'bg-surface text-ink shadow-btn' : 'text-ink-3 hover:text-ink-2'
                }`}
              >
                {item.label}
              </button>
            ))}
          </span>
        </div>
        <div className="insight-chart-stage relative h-[166px] grow min-h-[166px]">
          {/* key by metric: remount on toggle replays the entrance reveal */}
          <Liveline
            key={m.key}
            data={data}
            value={value}
            theme="light"
            color="#ee5c61"
            grid={false}
            scrub
            fill={false}
            pulse={false}
            momentum={false}
            paused
            window={windowSecs}
            lineWidth={2.25}
            cursor="crosshair"
            padding={{ top: 18, right: 8, bottom: 22, left: 8 }}
            formatValue={formatM}
            formatTime={formatDay}
            onHover={onLivelineHover(setHover)}
          />
          <HoverMarker x={hover?.x ?? null}>
            <ChartTooltip
              time={hoverIdx !== null ? data[hoverIdx].date : ''}
              rows={[
                { label: m.label, value: hoverIdx !== null ? formatM(data[hoverIdx].dayValue ?? data[hoverIdx].value) : '', color: 'var(--red)' },
              ]}
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
    <div className="rounded-card bg-surface p-3">
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
      <div className="mt-3 flex items-baseline gap-2 rounded-control bg-inset px-2.5 py-2">
        <span className={`shrink-0 text-[11.5px] font-medium ${active.tone}`}>{active.name}</span>
        <span className="truncate text-[11px] text-ink-3">
          {active.desc}
        </span>
      </div>
    </div>
  );
}
