/*
 * Waterfall — SVG timeline view of the selected trace's spans.
 *
 * Layout: one row per span (24px tall). Lanes follow the depth-first
 * preorder index from computeTreeOrder (already applied upstream in
 * grouping.ts). Bar X / width derive from (Timestamp, Duration) projected
 * onto the (minStart, maxEnd) range of the trace.
 *
 * Hover: ancestors light up (glow-medium); non-ancestors dim to 0.4.
 * Selection: 2px magenta left-edge indicator + persistent glow-strong.
 * Running detection (status empty AND end-time within nowMs - 1s): pulse
 * via the data-running attribute — per-style adaptation lives in
 * Waterfall.css. Pulse never fires on completed spans.
 *
 * Cross-process edge celebration: for each cross-process (claude_code.tool
 * → codex_exec across ServiceName boundaries) edge between two spans in
 * THIS waterfall, fire a one-time GSAP sweep on first appearance, then
 * leave a permanent ligature. The crossProcessStore (zustand + localStorage)
 * persists the "celebrated" set across reloads.
 *
 * Determinism: no Math.random / Date.now in layout. nowMs is passed in
 * from the parent (same source the rest of the app uses).
 */

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import gsap from "gsap";
import { spanRowId, type SpanRow } from "../lib/grouping";
import { parseTimestamp } from "../lib/grouping";
import { familyToAccentVar, spanNameToFamily } from "../lib/spanFamily";
import { buildEdgeKey, useCrossProcessStore } from "../lib/crossProcessStore";
import { bestContrastTextOn } from "../lib/bestContrast";
import { isSubagent, subagentType } from "../lib/isSubagent";
import "./Waterfall.css";

export interface WaterfallProps {
  spans: SpanRow[];
  selectedSpanId: string | null;
  onSelect: (spanId: string) => void;
  nowMs: number;
  emptyMessage?: string;
  /** Override container width for tests / fixed-size renders. */
  widthOverride?: number;
}

const ROW_HEIGHT = 24;
const BAR_HEIGHT = 16;
const BAR_Y_OFFSET = (ROW_HEIGHT - BAR_HEIGHT) / 2;
const TIME_AXIS_HEIGHT = 24;
const LEFT_GUTTER = 0;
const RIGHT_PAD = 8;
const MIN_BAR_WIDTH = 1;
const DEFAULT_WIDTH = 640;

interface BarLayout {
  span: SpanRow;
  spanId: string;
  rowIndex: number;
  x: number;
  y: number;
  width: number;
  family: string;
  accent: string;
  ancestors: Set<string>;
  isRunning: boolean;
  /**
   * True when the span's Timestamp couldn't be parsed and the bar is
   * a synthetic minimum-width fallback so the row stays selectable
   * (matching CollapsibleTraceList row count). Codex round-4 P1
   * 2026-05-30.
   */
  noTimestamp: boolean;
}

interface CrossEdge {
  key: string;
  parentSpanId: string;
  childSpanId: string;
  // Geometry derived from the two bar layouts.
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  midX: number;
  pathD: string;
}

export function Waterfall({
  spans,
  selectedSpanId,
  onSelect,
  nowMs,
  emptyMessage,
  widthOverride,
}: WaterfallProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [measuredWidth, setMeasuredWidth] = useState<number>(
    widthOverride ?? DEFAULT_WIDTH,
  );
  const [hoveredSpanId, setHoveredSpanId] = useState<string | null>(null);

  useLayoutEffect(() => {
    if (widthOverride) {
      setMeasuredWidth(widthOverride);
      return;
    }
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      if (w > 0) setMeasuredWidth(w);
    };
    update();
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(update);
      ro.observe(el);
      return () => ro.disconnect();
    }
    return undefined;
  }, [widthOverride, spans.length]);

  const innerWidth = Math.max(0, measuredWidth - LEFT_GUTTER - RIGHT_PAD);

  const layout = useMemo(
    () => buildLayout(spans, innerWidth, nowMs),
    [spans, innerWidth, nowMs],
  );

  const ancestorSet = useMemo(() => {
    if (!hoveredSpanId) return null;
    const bar = layout.bars.find((b) => b.spanId === hoveredSpanId);
    return bar?.ancestors ?? null;
  }, [layout.bars, hoveredSpanId]);

  if (spans.length === 0) {
    return (
      <section aria-label="Waterfall" style={emptyPaneStyle}>
        <p style={emptyTextStyle}>
          {emptyMessage ?? "// select a trace to load its waterfall"}
        </p>
      </section>
    );
  }

  // Reserve height for ONLY the bars that actually got laid out — a span
  // whose Timestamp didn't parse is silently dropped by buildLayout, and
  // reserving a row for it leaves a phantom empty band at the bottom of
  // the SVG with no matching bar.
  const totalHeight =
    TIME_AXIS_HEIGHT + layout.bars.length * ROW_HEIGHT + BAR_Y_OFFSET;

  return (
    <section
      aria-label="Waterfall"
      style={paneStyle}
      ref={containerRef}
      data-testid="voi-waterfall"
    >
      <div style={svgWrapperStyle}>
        <svg
          className="voi-waterfall"
          width={measuredWidth}
          height={totalHeight}
          viewBox={`0 0 ${measuredWidth} ${totalHeight}`}
          role="img"
          aria-label="Trace waterfall"
        >
          <TimeAxis
            innerWidth={innerWidth}
            durationMs={layout.durationMs}
            originX={LEFT_GUTTER}
            height={TIME_AXIS_HEIGHT}
            totalHeight={totalHeight}
          />
          {layout.bars.map((bar) => (
            <WaterfallBar
              key={bar.spanId}
              bar={bar}
              selected={bar.spanId === selectedSpanId}
              hovered={bar.spanId === hoveredSpanId}
              dimmed={
                // Skip the dim entirely when the hovered span has no
                // ancestors (i.e. the root). The old behavior dimmed
                // every other bar in the trace because the "is
                // ancestor of hover?" predicate is vacuously false
                // for a root's empty ancestor set — hovering the top
                // of the call tree should reveal it, not hide it.
                hoveredSpanId !== null &&
                hoveredSpanId !== bar.spanId &&
                ancestorSet !== null &&
                ancestorSet.size > 0 &&
                !ancestorSet.has(bar.spanId)
              }
              ancestorHighlight={
                ancestorSet !== null && ancestorSet.has(bar.spanId)
              }
              onSelect={onSelect}
              onHoverStart={() => setHoveredSpanId(bar.spanId)}
              onHoverEnd={() =>
                setHoveredSpanId((cur) =>
                  cur === bar.spanId ? null : cur,
                )
              }
            />
          ))}
          <CrossProcessEdges edges={layout.crossEdges} />
        </svg>
      </div>
    </section>
  );
}

interface LayoutResult {
  bars: BarLayout[];
  durationMs: number;
  crossEdges: CrossEdge[];
}

function buildLayout(
  spans: SpanRow[],
  innerWidth: number,
  nowMs: number,
): LayoutResult {
  if (spans.length === 0 || innerWidth <= 0) {
    return { bars: [], durationMs: 0, crossEdges: [] };
  }

  const spanById = new Map<string, SpanRow>();
  for (const s of spans) {
    spanById.set(s.SpanId, s);
  }

  // Compute trace window.
  let minStart = Number.POSITIVE_INFINITY;
  let maxEnd = Number.NEGATIVE_INFINITY;
  const starts = new Map<string, number>();
  for (const s of spans) {
    const t = parseTimestamp(s.Timestamp);
    if (t === null) continue;
    const end = t + s.Duration / 1_000_000;
    starts.set(spanRowId(s), t);
    if (t < minStart) minStart = t;
    if (end > maxEnd) maxEnd = end;
  }
  if (!Number.isFinite(minStart) || !Number.isFinite(maxEnd)) {
    return { bars: [], durationMs: 0, crossEdges: [] };
  }
  const traceDuration = Math.max(1, maxEnd - minStart);
  const scale = innerWidth / traceDuration;

  // Resolve ancestor chains (transitive parents).
  const ancestorChain = new Map<string, Set<string>>();
  for (const s of spans) {
    const id = spanRowId(s);
    const chain = new Set<string>();
    let parentId = s.ParentSpanId;
    const guard = new Set<string>();
    while (parentId && parentId !== "0000000000000000") {
      const parent = spanById.get(parentId);
      if (!parent) break;
      const parentRowId = spanRowId(parent);
      if (guard.has(parentRowId)) break;
      guard.add(parentRowId);
      chain.add(parentRowId);
      parentId = parent.ParentSpanId;
    }
    ancestorChain.set(id, chain);
  }

  const bars: BarLayout[] = [];
  // Pass 1: render every span with a parseable Timestamp at its real X.
  // Pass 2 (below the forEach) emits a fallback "no-timestamp" bar for
  // every dropped span so the click-to-select contract from the trace
  // list stays bidirectional — without this, a malformed-Timestamp span
  // would appear in CollapsibleTraceList (which iterates trace.spans
  // unconditionally) but be unreachable from the waterfall. Codex
  // round-4 P1 2026-05-30.
  spans.forEach((span) => {
    const id = spanRowId(span);
    const startMs = starts.get(id);
    if (startMs === undefined) return;
    const family = spanNameToFamily(span.SpanName);
    const accent = familyToAccentVar(family);
    const rawX = (startMs - minStart) * scale;
    const naturalWidth = (span.Duration / 1_000_000) * scale;
    const rawWidth = Math.max(MIN_BAR_WIDTH, naturalWidth);
    // Two distinct overflow cases — handle them differently so the
    // bar's X never lies about when the span started:
    //
    //  1. Tiny natural width (< MIN_BAR_WIDTH) at trace-end → the
    //     MIN_BAR_WIDTH floor would push the right edge past the inner
    //     axis. Shift X left enough to fit the 1px floor. Original X
    //     bug-budget here was already 1px.
    //  2. Wide natural width whose right edge exceeds innerWidth →
    //     DON'T shift X (would falsify the bar's start). Cap width to
    //     fit the axis instead; the right edge clamps, the left edge
    //     stays aligned with the TimeAxis tick.
    let clampedX = rawX;
    let visibleWidth = rawWidth;
    if (naturalWidth < MIN_BAR_WIDTH && rawX + rawWidth > innerWidth) {
      clampedX = Math.max(0, innerWidth - rawWidth);
    } else if (rawX + rawWidth > innerWidth) {
      visibleWidth = Math.max(MIN_BAR_WIDTH, innerWidth - rawX);
    }
    const endMs = startMs + span.Duration / 1_000_000;
    const isRunning =
      isStatusUnset(span.StatusCode) && endMs > nowMs - 1000;
    // Lane index = position in `bars`, NOT the source spans-array index.
    // A dropped span (unparseable Timestamp) would otherwise leave a
    // phantom empty lane where its source index would have sat.
    const laneIndex = bars.length;
    bars.push({
      span,
      spanId: id,
      rowIndex: laneIndex,
      x: LEFT_GUTTER + clampedX,
      y: TIME_AXIS_HEIGHT + laneIndex * ROW_HEIGHT + BAR_Y_OFFSET,
      width: visibleWidth,
      family,
      accent,
      ancestors: ancestorChain.get(id) ?? new Set(),
      isRunning,
      noTimestamp: false,
    });
  });

  // Fallback pass for spans whose Timestamp failed to parse — render a
  // minimum-width bar at x=0 so the row is still clickable and the bar
  // count matches CollapsibleTraceList. data-no-timestamp="true" gives
  // the consumer a hook for a tooltip + reduced-opacity treatment so
  // the operator can tell at a glance that the bar's geometry is
  // synthetic. Lane index continues from the valid-bar count.
  for (const span of spans) {
    const id = spanRowId(span);
    if (starts.has(id)) continue;
    const family = spanNameToFamily(span.SpanName);
    const accent = familyToAccentVar(family);
    const laneIndex = bars.length;
    bars.push({
      span,
      spanId: id,
      rowIndex: laneIndex,
      x: LEFT_GUTTER,
      y: TIME_AXIS_HEIGHT + laneIndex * ROW_HEIGHT + BAR_Y_OFFSET,
      width: MIN_BAR_WIDTH,
      family,
      accent,
      ancestors: ancestorChain.get(id) ?? new Set(),
      isRunning: false,
      noTimestamp: true,
    });
  }

  // Cross-process edges: parent span has different ServiceName than child
  // span and BOTH are present in the waterfall.
  const crossEdges: CrossEdge[] = [];
  const barBySpanId = new Map<string, BarLayout>();
  for (const b of bars) {
    barBySpanId.set(b.span.SpanId, b);
  }
  for (const b of bars) {
    const parentSpanId = b.span.ParentSpanId;
    if (!parentSpanId || parentSpanId === "0000000000000000") continue;
    const parentBar = barBySpanId.get(parentSpanId);
    if (!parentBar) continue;
    if (parentBar.span.ServiceName === b.span.ServiceName) continue;
    // Skip cross-edges touching a synthetic no-timestamp bar — its X is
    // a fallback, not a real start, so the ligature would point at the
    // wrong column. Codex round-4 P1 2026-05-30.
    if (parentBar.noTimestamp || b.noTimestamp) continue;
    const x1 = parentBar.x + parentBar.width;
    const y1 = parentBar.y + BAR_HEIGHT / 2;
    const x2 = b.x;
    const y2 = b.y + BAR_HEIGHT / 2;
    const midX = (x1 + x2) / 2;
    // Smooth horizontal bezier so the ligature doesn't slice through
    // unrelated rows.
    const pathD = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
    crossEdges.push({
      key: buildEdgeKey(b.span.TraceId, parentSpanId, b.span.SpanId),
      parentSpanId,
      childSpanId: b.span.SpanId,
      x1,
      y1,
      x2,
      y2,
      midX,
      pathD,
    });
  }

  return { bars, durationMs: traceDuration, crossEdges };
}

function isStatusUnset(code: string): boolean {
  const c = code.toUpperCase();
  return c === "" || c === "STATUS_CODE_UNSET" || c === "UNSET";
}

interface WaterfallBarProps {
  bar: BarLayout;
  selected: boolean;
  hovered: boolean;
  dimmed: boolean;
  ancestorHighlight: boolean;
  onSelect: (spanId: string) => void;
  onHoverStart: () => void;
  onHoverEnd: () => void;
}

function WaterfallBar({
  bar,
  selected,
  hovered,
  dimmed,
  ancestorHighlight,
  onSelect,
  onHoverStart,
  onHoverEnd,
}: WaterfallBarProps) {
  const glow: "soft" | "medium" | "strong" =
    selected || hovered ? "strong" : ancestorHighlight ? "medium" : "soft";

  const label = bar.span.SpanName;
  const showLabel = bar.width > 40;
  const sub = isSubagent(bar.span);
  // Show the actual subagent_type (e.g. "[BASH]", "[UI-IMPLEMENTER]") so
  // this label agrees with the CollapsibleTraceList badge instead of
  // printing a generic "[SUBAGENT]" the operator can't correlate.
  const subLabel = sub ? `[${subagentType(bar.span).toUpperCase()}]` : "";
  // The subagent suffix needs ~80px of bar width to render without crowding
  // the main label; below that, skip it entirely (per spec).
  const showSubagent = sub && bar.width >= 80;
  // Reserve space proportional to the actual label length (~6.5px per
  // mono char @ 10px) so a long subagent_type doesn't overrun the bar.
  const subReserve = showSubagent ? Math.min(bar.width / 2, subLabel.length * 6.5 + 8) : 0;
  const truncatedLabel = truncateLabel(label, bar.width - subReserve);
  // Pick a label fill that reads against the bar's family color. The 3
  // bright-neon accent families resolve to dark `--bg`; everything else
  // (only the muted accent or unknown vars) falls back to `--text`. This
  // is the headline contrast fix — no more white labels on neon fills.
  const labelColorVar = bestContrastTextOn(bar.accent);
  const labelFill = `var(${labelColorVar})`;

  const titleText = bar.noTimestamp
    ? `${label} — no timestamp (rendered as synthetic minimum-width bar)`
    : label;
  const ariaLabel = bar.noTimestamp
    ? `${bar.span.SpanName} — depth ${bar.span.depth} — no timestamp`
    : `${bar.span.SpanName} — depth ${bar.span.depth}`;

  return (
    <g
      data-span-id={bar.spanId}
      data-depth={bar.span.depth}
      data-row-index={bar.rowIndex}
      data-selected={selected ? "true" : "false"}
      data-subagent={sub ? "true" : "false"}
      data-no-timestamp={bar.noTimestamp ? "true" : "false"}
      onMouseEnter={onHoverStart}
      onMouseLeave={onHoverEnd}
      onFocus={onHoverStart}
      onBlur={onHoverEnd}
      onClick={() => onSelect(bar.spanId)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(bar.spanId);
        }
      }}
      tabIndex={0}
      role="button"
      aria-label={ariaLabel}
      // Single-select semantic — aria-current, not aria-pressed. Codex
      // round-4 P1 2026-05-30.
      aria-current={selected ? "true" : undefined}
      style={{ cursor: "pointer", outline: "none" }}
    >
      {/* Native SVG tooltip with full span name (no truncation). */}
      <title>{titleText}</title>
      <rect
        className="voi-waterfall-bar"
        x={bar.x}
        y={bar.y}
        width={bar.width}
        height={BAR_HEIGHT}
        rx={2}
        ry={2}
        fill={bar.accent}
        style={{ color: bar.accent }}
        data-glow={glow}
        data-dimmed={dimmed ? "true" : "false"}
        data-running={bar.isRunning ? "true" : "false"}
        data-selected={selected ? "true" : "false"}
      />
      {selected ? (
        <rect
          className="voi-waterfall-selection-edge"
          x={bar.x}
          y={bar.y}
          width={2}
          height={BAR_HEIGHT}
        />
      ) : null}
      {showLabel ? (
        <text
          className="voi-waterfall-label"
          x={bar.x + 6}
          y={bar.y + BAR_HEIGHT / 2 + 3}
          style={{ fill: labelFill }}
        >
          {truncatedLabel}
        </text>
      ) : null}
      {showSubagent ? (
        <text
          className="voi-waterfall-subagent"
          x={bar.x + bar.width - 4}
          y={bar.y + BAR_HEIGHT / 2 + 3}
          style={{ fill: labelFill }}
          textAnchor="end"
        >
          {subLabel}
        </text>
      ) : null}
    </g>
  );
}

interface TimeAxisProps {
  innerWidth: number;
  durationMs: number;
  originX: number;
  height: number;
  totalHeight: number;
}

function TimeAxis({
  innerWidth,
  durationMs,
  originX,
  height,
  totalHeight,
}: TimeAxisProps) {
  if (innerWidth <= 0 || durationMs <= 0) return null;
  const ticks = computeTickPositions(durationMs);

  return (
    <g aria-hidden="true">
      {ticks.map(({ ms, major }, idx) => {
        const x = originX + (ms / durationMs) * innerWidth;
        return (
          <g key={`tick-${idx}-${ms}`}>
            <line
              className={`voi-waterfall-tick${major ? " voi-waterfall-tick--major" : ""}`}
              x1={x}
              x2={x}
              y1={height - 6}
              y2={totalHeight}
            />
            {major ? (
              <text
                className="voi-waterfall-tick-label"
                x={x + 2}
                y={height - 8}
              >
                {formatTickMs(ms)}
              </text>
            ) : null}
          </g>
        );
      })}
    </g>
  );
}

interface TickPos {
  ms: number;
  major: boolean;
}

function computeTickPositions(durationMs: number): TickPos[] {
  if (durationMs <= 0) return [];
  // Aim for ~10 major ticks; choose a "nice" step (1/2/5 × 10^n).
  const targetMajors = 10;
  const rawStep = durationMs / targetMajors;
  const exp = Math.floor(Math.log10(rawStep));
  const base = Math.pow(10, exp);
  const candidates = [1, 2, 5, 10];
  let majorStep = base;
  for (const c of candidates) {
    if (c * base >= rawStep) {
      majorStep = c * base;
      break;
    }
  }
  const minorStep = majorStep / 5;
  const ticks: TickPos[] = [];
  let cursor = 0;
  // Avoid runaway loops on degenerate inputs.
  const maxIterations = 2000;
  let iterations = 0;
  while (cursor <= durationMs && iterations < maxIterations) {
    const isMajor = Math.abs(cursor % majorStep) < 1e-6;
    ticks.push({ ms: cursor, major: isMajor });
    cursor += minorStep;
    iterations += 1;
  }
  return ticks;
}

function formatTickMs(ms: number): string {
  if (ms === 0) return "0";
  if (ms >= 1000) {
    const seconds = ms / 1000;
    return seconds % 1 === 0 ? `${seconds}s` : `${seconds.toFixed(1)}s`;
  }
  return `${Math.round(ms)}ms`;
}

function truncateLabel(label: string, widthPx: number): string {
  // Conservative char width estimate (mono ~ 6.5px @ 11px font-size).
  const maxChars = Math.max(2, Math.floor((widthPx - 12) / 6.5));
  if (label.length <= maxChars) return label;
  return `${label.slice(0, Math.max(1, maxChars - 1))}…`;
}

interface CrossProcessEdgesProps {
  edges: CrossEdge[];
}

function CrossProcessEdges({ edges }: CrossProcessEdgesProps) {
  const pathRefs = useRef<Map<string, SVGPathElement>>(new Map());
  const markCelebrated = useCrossProcessStore((s) => s.markCelebrated);
  const hydrate = useCrossProcessStore((s) => s.hydrate);
  // celebratedSet drives the static data-state attribute in the render
  // path. The SWEEP effect must NOT depend on it — otherwise the first
  // edge's onComplete (which calls markCelebrated) flips the set
  // identity, the effect cleanup .kill()s every other in-flight tween,
  // and the partially-drawn edges freeze at whatever stroke-dashoffset
  // they happened to reach. Inside the effect we read the latest set
  // via useCrossProcessStore.getState() so the sweep is decoupled from
  // store churn entirely.
  const celebratedSet = useCrossProcessStore((s) => s.celebrated);
  const hydrated = useCrossProcessStore((s) => s.hydrated);

  // Hydrate on mount — pure read in render is safe (no set() in selector
  // any more); hydration runs in an effect so React's rules aren't violated.
  useEffect(() => {
    hydrate();
  }, [hydrate]);

  // Track which edges are mid-sweep OR have completed in THIS mount to
  // avoid firing duplicate tweens when the spans array updates (e.g.
  // polling adds new spans, mutating layout.crossEdges into a new array
  // reference). Persistence across mounts is handled by the zustand
  // store. The Map records the tween so we can let it run (don't .kill)
  // when the effect re-runs because of an unrelated edges-array
  // reference change.
  //
  // Why a tween-tracking Map and not the previous "added before
  // gsap.to" guard: the prior version inserted edge.key into a Set
  // BEFORE creating the tween and then killed in-flight tweens in the
  // effect cleanup. A poll commit landing during the 0.6s sweep window
  // (guaranteed on mount: doFetch resolves a few hundred ms in) flipped
  // the edges identity, cleanup killed the tween, onComplete never
  // fired, but the key was already in the Set — so the next effect run
  // skipped re-launching, leaving the path stuck at the killed-
  // mid-flight stroke-dashoffset with data-state="sweep" until the
  // user navigated away. Codex round-4 P0 2026-05-30.
  const sweptThisMountRef = useRef<Map<string, gsap.core.Tween | "done">>(
    new Map(),
  );

  useEffect(() => {
    // Don't drive sweeps until hydration finishes — otherwise we may fire
    // for an edge the store hasn't loaded as "already celebrated" yet.
    if (!hydrated) return undefined;

    const prefersReducedMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Read the persisted set ONCE at effect start; subsequent
    // markCelebrated calls inside this effect run won't re-trigger the
    // effect because celebratedSet isn't in the deps array.
    const persistedAtStart = useCrossProcessStore.getState().celebrated;

    for (const edge of edges) {
      // Already mid-sweep or completed in this mount — leave it alone.
      if (sweptThisMountRef.current.has(edge.key)) continue;
      if (persistedAtStart.has(edge.key)) {
        sweptThisMountRef.current.set(edge.key, "done");
        continue;
      }

      const path = pathRefs.current.get(edge.key);
      if (!path) {
        sweptThisMountRef.current.set(edge.key, "done");
        markCelebrated(edge.key);
        continue;
      }

      if (prefersReducedMotion) {
        sweptThisMountRef.current.set(edge.key, "done");
        path.setAttribute("data-state", "settled");
        markCelebrated(edge.key);
        continue;
      }

      const length = path.getTotalLength();
      // Sweep effect: stroke-dasharray + offset → animates the dash from
      // hidden to fully drawn over 0.6s ease-out, then settles to the
      // permanent ligature state.
      gsap.set(path, {
        attr: {
          "stroke-dasharray": length,
          "stroke-dashoffset": length,
          "data-state": "sweep",
        },
      });
      const tween = gsap.to(path, {
        attr: { "stroke-dashoffset": 0 },
        duration: 0.6,
        ease: "power2.out",
        onComplete: () => {
          sweptThisMountRef.current.set(edge.key, "done");
          // Guard against unmount: the path may have been detached if the
          // user navigated away mid-sweep. isConnected returns false for a
          // detached node; in that case do NOT mark celebrated — the user
          // never saw the dopamine moment, let it play next time.
          if (!path.isConnected) return;
          path.setAttribute("data-state", "settled");
          path.removeAttribute("stroke-dasharray");
          path.removeAttribute("stroke-dashoffset");
          markCelebrated(edge.key);
        },
      });
      sweptThisMountRef.current.set(edge.key, tween);
    }

    // No per-run cleanup. The previous version killed in-flight tweens
    // on every dep-change which broke the dopamine animation under
    // polling. Tweens are short (0.6s) and self-clean via onComplete;
    // detached paths are guarded inside onComplete via isConnected.
    return undefined;
    // celebratedSet deliberately omitted from deps — see the comment on
    // the selector above. The effect reads the persisted set via
    // getState() so onComplete-triggered store updates don't re-run
    // (and prematurely .kill()) sibling tweens.
  }, [edges, hydrated, markCelebrated]);

  // Unmount-only cleanup: kill any tweens still in flight so onComplete
  // doesn't fire against a stale closure after this component leaves
  // the tree. Keeping this in its own effect with an empty deps array
  // ensures it runs ONLY on unmount, not on every edges-array re-ref.
  useEffect(() => {
    const tweens = sweptThisMountRef.current;
    return () => {
      for (const entry of tweens.values()) {
        if (entry !== "done") entry.kill();
      }
    };
  }, []);

  return (
    <g aria-hidden="true">
      {edges.map((edge) => {
        const alreadyCelebrated = celebratedSet.has(edge.key);
        return (
          <path
            key={edge.key}
            ref={(el) => {
              if (el) {
                pathRefs.current.set(edge.key, el);
              } else {
                pathRefs.current.delete(edge.key);
              }
            }}
            className="voi-cross-edge"
            d={edge.pathD}
            data-state={alreadyCelebrated ? "settled" : "sweep"}
            data-edge-key={edge.key}
          />
        );
      })}
    </g>
  );
}

const paneStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "8px",
  padding: "14px 12px",
  overflowY: "auto",
  height: "100%",
};

const svgWrapperStyle: CSSProperties = {
  width: "100%",
  flex: 1,
  minHeight: 0,
  overflow: "auto",
};

const emptyPaneStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "center",
  padding: "20px",
  height: "100%",
};

const emptyTextStyle: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "12px",
  color: "var(--text-muted)",
  margin: 0,
};
