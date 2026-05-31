/*
 * VOI-389 — absolute EST/EDT visibility in the waterfall surfaces.
 *
 * Covers:
 *   - WaterfallShell header chip includes the trace start in EST/EDT.
 *   - Per-bar SVG <title> tooltip includes `started HH:MM:SS.mmm AM/PM
 *     EDT` and `ended ...` for parseable Timestamps.
 *   - The time axis carries an absolute-time tick label row at major
 *     ticks (data-absolute-tick="true") that reads EST/EDT.
 *   - Spans with unparseable Timestamps surface `started --, ended --`
 *     in the tooltip rather than a fabricated value.
 */

import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Waterfall } from "../src/components/Waterfall";
import { WaterfallShell } from "../src/components/WaterfallShell";
import { computeTreeOrder, type SpanRow } from "../src/lib/grouping";

// July 15 2026 14:32:47 UTC -> 10:32:47 AM EDT in America/New_York.
const BASE_START_MS = Date.UTC(2026, 6, 15, 14, 32, 47, 0);

function span(o: {
  spanId: string;
  parentSpanId?: string;
  startOffsetMs: number;
  durationMs: number;
  badTimestamp?: boolean;
}): SpanRow {
  const startMs = BASE_START_MS + o.startOffsetMs;
  const iso = new Date(startMs).toISOString();
  const timestamp = o.badTimestamp ? "garbage-not-a-time" : iso.replace("Z", "000000Z");
  return {
    TraceId: "trace-t",
    SpanId: o.spanId,
    ParentSpanId: o.parentSpanId ?? "",
    SpanName: o.spanId,
    Timestamp: timestamp,
    ServiceName: "claude-code",
    StatusCode: "",
    Duration: o.durationMs * 1_000_000,
    AgentProject: "p",
    AgentSessionId: "s",
    AgentRunId: "r",
    SessionId: "sess",
    ProjectName: "proj",
    ResourceAttributesRaw: {},
    SpanAttributesRaw: {},
    depth: 0,
  };
}

function smallTrace(): SpanRow[] {
  return computeTreeOrder([
    span({ spanId: "root", startOffsetMs: 0, durationMs: 1000 }),
    span({
      spanId: "child",
      parentSpanId: "root",
      startOffsetMs: 100,
      durationMs: 400,
    }),
  ]);
}

/**
 * In-flight (still-running) span: StatusCode UNSET + Duration === 0.
 * The Waterfall buildLayout marks this as `isRunning` and animates the
 * bar with a pulse. The tooltip MUST NOT print
 * "ended <same as started>" — that's a lie the operator would trust
 * because the bar is animated as running. Codex /code-review P1.
 */
function runningSpan(): SpanRow[] {
  return [
    {
      TraceId: "trace-running",
      SpanId: "running",
      ParentSpanId: "",
      SpanName: "claude_code.tool",
      Timestamp: new Date(BASE_START_MS).toISOString().replace("Z", "000000Z"),
      ServiceName: "claude-code",
      StatusCode: "",
      Duration: 0,
      AgentProject: "p",
      AgentSessionId: "s",
      AgentRunId: "r",
      SessionId: "sess",
      ProjectName: "proj",
      ResourceAttributesRaw: {},
      SpanAttributesRaw: {},
      depth: 0,
    },
  ];
}

/**
 * Polling-window in-flight: StatusCode UNSET + Duration > 0 + endMs
 * within nowMs-5s. buildLayout marks this as isRunning too (case b of
 * the predicate). The round-2 patch carved out only the Duration===0
 * branch and left this case rendering "ended <real time>" — Claude
 * /code-review round-3 caught the gap.
 */
function pollingInFlightSpan(): SpanRow[] {
  return [
    {
      TraceId: "trace-polling",
      SpanId: "polling",
      ParentSpanId: "",
      SpanName: "claude_code.tool",
      Timestamp: new Date(BASE_START_MS).toISOString().replace("Z", "000000Z"),
      ServiceName: "claude-code",
      StatusCode: "",
      Duration: 2_500_000_000, // 2.5s
      AgentProject: "p",
      AgentSessionId: "s",
      AgentRunId: "r",
      SessionId: "sess",
      ProjectName: "proj",
      ResourceAttributesRaw: {},
      SpanAttributesRaw: {},
      depth: 0,
    },
  ];
}

describe("Waterfall — VOI-389 absolute EST/EDT surfaces", () => {
  it("per-bar tooltip includes absolute EST start/end times with ms precision", () => {
    const spans = smallTrace();
    const { container } = render(
      <Waterfall
        spans={spans}
        selectedSpanId={null}
        onSelect={() => undefined}
        nowMs={BASE_START_MS + 10_000}
        widthOverride={1200}
      />,
    );
    const rootGroup = container.querySelector('g[data-span-id$="root"]');
    expect(rootGroup).not.toBeNull();
    const title = rootGroup!.querySelector("title")?.textContent ?? "";
    // The tooltip text is multi-line — we just look for the substrings
    // proving start/end timestamps were rendered with the spec format.
    expect(title).toMatch(/started \d{1,2}:\d{2}:\d{2}\.\d{3} (AM|PM) E[SD]T/);
    expect(title).toMatch(/ended \d{1,2}:\d{2}:\d{2}\.\d{3} (AM|PM) E[SD]T/);
  });

  it("synthetic no-timestamp bars surface `started --, ended --` rather than a fabricated value", () => {
    // Trace where every span's Timestamp is malformed -> the fallback
    // pass emits noTimestamp bars. The tooltip MUST NOT lie about start.
    const spans = computeTreeOrder([
      span({ spanId: "root", startOffsetMs: 0, durationMs: 1000, badTimestamp: true }),
    ]);
    const { container } = render(
      <Waterfall
        spans={spans}
        selectedSpanId={null}
        onSelect={() => undefined}
        nowMs={BASE_START_MS + 10_000}
        widthOverride={1200}
      />,
    );
    const rootGroup = container.querySelector('g[data-span-id$="root"]');
    expect(rootGroup).not.toBeNull();
    expect(rootGroup!.getAttribute("data-no-timestamp")).toBe("true");
    const title = rootGroup!.querySelector("title")?.textContent ?? "";
    expect(title).toContain("started --");
    expect(title).toContain("ended --");
  });

  it("polling-window in-flight span (Duration > 0, fresh end) also reads 'ended (still running)' — guard is bar.isRunning, not Duration===0 (round-3 P2)", () => {
    // The round-2 patch undercovered the polling-window branch: a span
    // with StatusCode UNSET, Duration > 0, and endMs within nowMs-5s
    // is treated as running everywhere else but the tooltip used to
    // print "ended <real time>". Guard collapses to `bar.isRunning`.
    const spans = pollingInFlightSpan();
    const { container } = render(
      <Waterfall
        spans={spans}
        selectedSpanId={null}
        onSelect={() => undefined}
        // nowMs = startMs + 4s; endMs = startMs + 2.5s; 4 - 2.5 = 1.5s
        // < 5s polling-fresh window → isRunning.
        nowMs={BASE_START_MS + 4000}
        widthOverride={1200}
      />,
    );
    const group = container.querySelector('g[data-span-id$="polling"]');
    const title = group?.querySelector("title")?.textContent ?? "";
    expect(title).toContain("ended (still running)");
    expect(title).not.toMatch(/ended \d{1,2}:\d{2}:\d{2}\.\d{3} (AM|PM)/);
  });

  it("in-flight (running) span tooltip reads 'ended (still running)' instead of duplicating the start time", () => {
    // Without the running-span branch, bar.endMs === bar.startMs and the
    // tooltip would render "ended 12:32:47.000 PM EDT" identical to the
    // started line — a lie the operator would trust because the bar is
    // animated as running. Codex /code-review P1 2026-05-31.
    const spans = runningSpan();
    const { container } = render(
      <Waterfall
        spans={spans}
        selectedSpanId={null}
        onSelect={() => undefined}
        nowMs={BASE_START_MS + 10_000}
        widthOverride={1200}
      />,
    );
    const group = container.querySelector('g[data-span-id$="running"]');
    const title = group?.querySelector("title")?.textContent ?? "";
    expect(title).toContain("started ");
    expect(title).toContain("ended (still running)");
    // The "ended HH:MM:SS.mmm AM/PM EDT" form must NOT appear.
    expect(title).not.toMatch(/ended \d{1,2}:\d{2}:\d{2}\.\d{3} (AM|PM)/);
  });

  it("absolute axis labels anchor both endpoints — leftmost label at first major, rightmost at last major (round-3 P3)", () => {
    // round-2 floor(i*N/K) left up to 20% of the right edge blank
    // (e.g. K=5, N=11 → indices {0,2,4,6,8}; last absolute label at
    // 80% of axis). round-3 uses round(i*(N-1)/(K-1)) so index 0 →
    // first major and K-1 → last major; gaps in between stay even.
    const spans = smallTrace();
    const { container } = render(
      <Waterfall
        spans={spans}
        selectedSpanId={null}
        onSelect={() => undefined}
        nowMs={BASE_START_MS + 10_000}
        widthOverride={1200}
      />,
    );
    const allMajorTicks = container.querySelectorAll(
      'text.voi-waterfall-tick-label:not([data-absolute-tick])',
    );
    const absoluteTicks = container.querySelectorAll('text[data-absolute-tick="true"]');
    expect(allMajorTicks.length).toBeGreaterThanOrEqual(2);
    expect(absoluteTicks.length).toBeGreaterThanOrEqual(2);
    const majorXs = Array.from(allMajorTicks)
      .map((t) => Number((t as SVGTextElement).getAttribute("x") ?? "0"))
      .sort((a, b) => a - b);
    const absXs = Array.from(absoluteTicks)
      .map((t) => Number((t as SVGTextElement).getAttribute("x") ?? "0"))
      .sort((a, b) => a - b);
    // Leftmost absolute label sits at the leftmost major's x.
    expect(absXs[0]).toBe(majorXs[0]);
    // Rightmost absolute label sits at the rightmost major's x — not
    // 20% short of it. The round-2 fix had absXs[absXs.length-1] ===
    // majorXs[Math.floor(0.8 * majorXs.length)] (≈ 80% of width).
    expect(absXs[absXs.length - 1]).toBe(majorXs[majorXs.length - 1]);
  });

  it("absolute axis labels are evenly spread across the full axis, not clustered at the left", () => {
    // Regression for codex /code-review P1 2026-05-31: the previous
    // stride = floor(N/K) collapsed to 1 whenever K < N < 2K, so all K
    // labels landed in the first K positions and the right half of the
    // axis stayed unlabelled. The fix uses floor(i*N/K) so the rightmost
    // label sits on or near the rightmost major tick.
    const spans = smallTrace();
    const { container } = render(
      <Waterfall
        spans={spans}
        selectedSpanId={null}
        onSelect={() => undefined}
        nowMs={BASE_START_MS + 10_000}
        widthOverride={1200}
      />,
    );
    const ticks = container.querySelectorAll('text[data-absolute-tick="true"]');
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    const xs = Array.from(ticks)
      .map((t) => Number((t as SVGTextElement).getAttribute("x") ?? "0"))
      .sort((a, b) => a - b);
    // The rightmost absolute-time label must sit in the right half of
    // the inner axis (innerWidth = 1200 - 8 = 1192; right half starts
    // at ~596px). Pre-fix, all labels clustered in the first ~200px.
    expect(xs[xs.length - 1]).toBeGreaterThan(500);
  });

  it("time axis emits at least one absolute EST/EDT tick label", () => {
    const spans = smallTrace();
    const { container } = render(
      <Waterfall
        spans={spans}
        selectedSpanId={null}
        onSelect={() => undefined}
        nowMs={BASE_START_MS + 10_000}
        widthOverride={1200}
      />,
    );
    const absoluteLabels = container.querySelectorAll('text[data-absolute-tick="true"]');
    expect(absoluteLabels.length).toBeGreaterThan(0);
    const text = absoluteLabels[0]!.textContent ?? "";
    // The first major tick is at ms=0, which equals the trace start —
    // matches BASE_START_MS exactly. Tick text formatted via
    // formatAbsoluteEst -> HH:MM:SS AM/PM E[SD]T.
    expect(text).toMatch(/^\d{1,2}:\d{2}:\d{2} (AM|PM) E[SD]T$/);
  });

  it("omits the absolute-time axis row entirely when the viewport is too narrow for a single ~200px slot (Claude /code-review P2 2026-05-31)", () => {
    // Below ~200px innerWidth the absolute label width (~110-130px for
    // "HH:MM:SS AM EDT" at 10px mono) would overlap with adjacent
    // labels. Cap collapses to 0 so the relative-duration ticks still
    // render but the absolute row hides.
    const spans = smallTrace();
    const { container } = render(
      <Waterfall
        spans={spans}
        selectedSpanId={null}
        onSelect={() => undefined}
        nowMs={BASE_START_MS + 10_000}
        widthOverride={180}
      />,
    );
    expect(container.querySelectorAll('text[data-absolute-tick="true"]').length).toBe(0);
  });

  it("collapses the axis height when no absolute-time row will render — bars start ~12px higher (round-4 P3)", () => {
    // Compare a normal trace (axis 36px, includes the absolute row) vs a
    // trace where every Timestamp fails to parse (axis 24px, only the
    // relative-tick row renders). Round-4 finding: the axis was bumped
    // to 36px unconditionally, leaving 12px of empty space above the
    // first bar when no absolute labels render.
    const normalSpans = smallTrace();
    const normalRender = render(
      <Waterfall
        spans={normalSpans}
        selectedSpanId={null}
        onSelect={() => undefined}
        nowMs={BASE_START_MS + 10_000}
        widthOverride={1200}
      />,
    );
    const normalRoot = normalRender.container.querySelector(
      'g[data-span-id$="root"] rect.voi-waterfall-bar',
    );
    const normalY = Number(normalRoot?.getAttribute("y") ?? "0");
    normalRender.unmount();

    const noTimestampSpans = computeTreeOrder([
      span({ spanId: "root", startOffsetMs: 0, durationMs: 1000, badTimestamp: true }),
    ]);
    const noTsRender = render(
      <Waterfall
        spans={noTimestampSpans}
        selectedSpanId={null}
        onSelect={() => undefined}
        nowMs={BASE_START_MS + 10_000}
        widthOverride={1200}
      />,
    );
    const noTsRoot = noTsRender.container.querySelector(
      'g[data-span-id$="root"] rect.voi-waterfall-bar',
    );
    const noTsY = Number(noTsRoot?.getAttribute("y") ?? "0");
    noTsRender.unmount();

    // The no-Timestamp render should start the first bar 12px higher
    // (axis collapsed from 36 -> 24).
    expect(normalY - noTsY).toBe(12);
  });

  it("axis emits zero absolute tick labels when traceStartMs is unparseable", () => {
    const spans = computeTreeOrder([
      span({ spanId: "root", startOffsetMs: 0, durationMs: 1000, badTimestamp: true }),
    ]);
    const { container } = render(
      <Waterfall
        spans={spans}
        selectedSpanId={null}
        onSelect={() => undefined}
        nowMs={BASE_START_MS + 10_000}
        widthOverride={1200}
      />,
    );
    // No parseable Timestamps -> the layout's traceStartMs is NaN and
    // we hide the absolute-time axis row rather than smear "--" across
    // every major tick.
    const absoluteLabels = container.querySelectorAll('text[data-absolute-tick="true"]');
    expect(absoluteLabels.length).toBe(0);
  });
});

describe("WaterfallShell — VOI-389 header chip absolute start", () => {
  it("chip text includes 'started <Mon DD, HH:MM:SS AM/PM EST/EDT>' derived from spans", () => {
    const spans = smallTrace();
    const { getByTestId } = render(
      <WaterfallShell
        spans={spans}
        durationSeconds={1.234}
        selectedSpanId={null}
        onSelect={() => undefined}
        nowMs={BASE_START_MS + 10_000}
        collapsed={false}
        onToggleCollapsed={() => undefined}
      />,
    );
    const chip = getByTestId("voi-waterfall-chip");
    // The deterministic test trace starts at July 15 2026 14:32:47 UTC
    // -> Jul 15, 10:32:47 AM EDT in America/New_York.
    expect(chip.textContent ?? "").toContain("started Jul 15, 10:32:47 AM EDT");
    expect(chip.textContent ?? "").toContain("1.234s");
  });

  it("chip text shows 'started --' when no span Timestamp parses", () => {
    const spans = computeTreeOrder([
      span({ spanId: "root", startOffsetMs: 0, durationMs: 1000, badTimestamp: true }),
    ]);
    const { getByTestId } = render(
      <WaterfallShell
        spans={spans}
        durationSeconds={0}
        selectedSpanId={null}
        onSelect={() => undefined}
        nowMs={BASE_START_MS + 10_000}
        collapsed={false}
        onToggleCollapsed={() => undefined}
      />,
    );
    const chip = getByTestId("voi-waterfall-chip");
    expect(chip.textContent ?? "").toContain("started --");
  });
});
