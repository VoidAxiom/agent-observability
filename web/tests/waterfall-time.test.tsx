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

describe("Waterfall — VOI-389 absolute EST/EDT surfaces", () => {
  it("per-bar tooltip includes absolute EST start/end times with ms precision", () => {
    const spans = smallTrace();
    const { container } = render(
      <Waterfall
        spans={spans}
        selectedSpanId={null}
        onSelect={() => undefined}
        nowMs={BASE_START_MS + 5000}
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
        nowMs={BASE_START_MS + 5000}
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
        nowMs={BASE_START_MS + 5000}
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
        nowMs={BASE_START_MS + 5000}
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
        nowMs={BASE_START_MS + 5000}
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

  it("axis emits zero absolute tick labels when traceStartMs is unparseable", () => {
    const spans = computeTreeOrder([
      span({ spanId: "root", startOffsetMs: 0, durationMs: 1000, badTimestamp: true }),
    ]);
    const { container } = render(
      <Waterfall
        spans={spans}
        selectedSpanId={null}
        onSelect={() => undefined}
        nowMs={BASE_START_MS + 5000}
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
        nowMs={BASE_START_MS + 5000}
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
        nowMs={BASE_START_MS + 5000}
        collapsed={false}
        onToggleCollapsed={() => undefined}
      />,
    );
    const chip = getByTestId("voi-waterfall-chip");
    expect(chip.textContent ?? "").toContain("started --");
  });
});
