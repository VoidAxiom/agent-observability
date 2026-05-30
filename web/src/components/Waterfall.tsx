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

  const totalHeight =
    TIME_AXIS_HEIGHT + spans.length * ROW_HEIGHT + BAR_Y_OFFSET;

  return (
    <section
      aria-label="Waterfall"
      style={paneStyle}
      ref={containerRef}
      data-testid="voi-waterfall"
    >
      <header style={paneHeaderStyle}>
        <h2 style={paneHeaderTitleStyle}>WATERFALL</h2>
        <span style={paneHeaderHintStyle}>
          {`// ${spans.length} spans · ${formatTraceDuration(layout.durationMs)}`}
        </span>
      </header>
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
                hoveredSpanId !== null &&
                hoveredSpanId !== bar.spanId &&
                ancestorSet !== null &&
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
  spans.forEach((span, index) => {
    const id = spanRowId(span);
    const startMs = starts.get(id);
    if (startMs === undefined) return;
    const family = spanNameToFamily(span.SpanName);
    const accent = familyToAccentVar(family);
    const rawX = (startMs - minStart) * scale;
    const rawWidth = Math.max(MIN_BAR_WIDTH, (span.Duration / 1_000_000) * scale);
    const endMs = startMs + span.Duration / 1_000_000;
    const isRunning =
      isStatusUnset(span.StatusCode) && endMs > nowMs - 1000;
    bars.push({
      span,
      spanId: id,
      rowIndex: index,
      x: LEFT_GUTTER + rawX,
      y: TIME_AXIS_HEIGHT + index * ROW_HEIGHT + BAR_Y_OFFSET,
      width: rawWidth,
      family,
      accent,
      ancestors: ancestorChain.get(id) ?? new Set(),
      isRunning,
    });
  });

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

  return (
    <g
      data-span-id={bar.spanId}
      data-depth={bar.span.depth}
      data-row-index={bar.rowIndex}
      data-selected={selected ? "true" : "false"}
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
      aria-label={`${bar.span.SpanName} — depth ${bar.span.depth}`}
      aria-pressed={selected}
      style={{ cursor: "pointer", outline: "none" }}
    >
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
        >
          {truncateLabel(label, bar.width)}
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

function formatTraceDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
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
  const hasCelebrated = useCrossProcessStore((s) => s.hasCelebrated);
  const markCelebrated = useCrossProcessStore((s) => s.markCelebrated);
  const hydrate = useCrossProcessStore((s) => s.hydrate);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  // Track which edges have run the sweep in THIS mount to avoid re-firing
  // when the spans array updates (e.g. polling adds new spans). Persistence
  // across mounts is handled by the zustand store.
  const sweptThisMountRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const prefersReducedMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    for (const edge of edges) {
      if (sweptThisMountRef.current.has(edge.key)) continue;
      if (hasCelebrated(edge.key)) {
        sweptThisMountRef.current.add(edge.key);
        continue;
      }
      sweptThisMountRef.current.add(edge.key);

      const path = pathRefs.current.get(edge.key);
      if (!path) {
        markCelebrated(edge.key);
        continue;
      }

      if (prefersReducedMotion) {
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
      gsap.to(path, {
        attr: { "stroke-dashoffset": 0 },
        duration: 0.6,
        ease: "power2.out",
        onComplete: () => {
          path.setAttribute("data-state", "settled");
          path.removeAttribute("stroke-dasharray");
          path.removeAttribute("stroke-dashoffset");
          markCelebrated(edge.key);
        },
      });
    }
  }, [edges, hasCelebrated, markCelebrated]);

  return (
    <g aria-hidden="true">
      {edges.map((edge) => {
        const alreadyCelebrated = hasCelebrated(edge.key);
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

const paneHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "0 4px",
};

const paneHeaderTitleStyle: CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-numeric)",
  fontSize: "11px",
  letterSpacing: "0.12em",
  color: "var(--text)",
  textTransform: "uppercase",
};

const paneHeaderHintStyle: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "11px",
  color: "var(--text-muted)",
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
