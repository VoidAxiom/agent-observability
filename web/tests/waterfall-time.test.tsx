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
