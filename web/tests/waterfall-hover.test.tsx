import { describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { Waterfall } from "../src/components/Waterfall";
import { computeTreeOrder, type SpanRow } from "../src/lib/grouping";

const BASE_START_MS = Date.parse("2026-01-01T00:00:00.000Z");

function span(o: {
  spanId: string;
  parentSpanId?: string;
  startOffsetMs: number;
  durationMs: number;
}): SpanRow {
  const startMs = BASE_START_MS + o.startOffsetMs;
  const iso = new Date(startMs).toISOString();
  const timestamp = iso.replace("Z", "000000Z");
  return {
    TraceId: "trace-h",
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

function chain(): SpanRow[] {
  // root → mid → leaf, plus a sibling-of-mid (sib) under root.
  return computeTreeOrder([
    span({ spanId: "root", startOffsetMs: 0, durationMs: 1000 }),
    span({
      spanId: "mid",
      parentSpanId: "root",
      startOffsetMs: 50,
      durationMs: 800,
    }),
    span({
      spanId: "leaf",
      parentSpanId: "mid",
      startOffsetMs: 100,
      durationMs: 500,
    }),
    span({
      spanId: "sib",
      parentSpanId: "root",
      startOffsetMs: 600,
      durationMs: 200,
    }),
  ]);
}

describe("Waterfall hover", () => {
  it("hovering a deep child sets glow=strong and ancestors=medium", () => {
    const spans = chain();
    const { container } = render(
      <Waterfall
        spans={spans}
        selectedSpanId={null}
        onSelect={() => {}}
        nowMs={BASE_START_MS + 5000}
        widthOverride={1000}
      />,
    );

    const leafGroup = container.querySelector('g[data-span-id$="leaf"]');
    expect(leafGroup).not.toBeNull();
    fireEvent.mouseEnter(leafGroup!);

    const leafBar = leafGroup!.querySelector("rect.voi-waterfall-bar");
    expect(leafBar!.getAttribute("data-glow")).toBe("strong");

    const midBar = container.querySelector(
      'g[data-span-id$="mid"] rect.voi-waterfall-bar',
    );
    const rootBar = container.querySelector(
      'g[data-span-id$="root"] rect.voi-waterfall-bar',
    );
    expect(midBar!.getAttribute("data-glow")).toBe("medium");
    expect(rootBar!.getAttribute("data-glow")).toBe("medium");

    const sibBar = container.querySelector(
      'g[data-span-id$="sib"] rect.voi-waterfall-bar',
    );
    expect(sibBar!.getAttribute("data-dimmed")).toBe("true");
    expect(sibBar!.getAttribute("data-glow")).toBe("soft");
  });

  it("mouse leave clears the hover state", () => {
    const spans = chain();
    const { container } = render(
      <Waterfall
        spans={spans}
        selectedSpanId={null}
        onSelect={() => {}}
        nowMs={BASE_START_MS + 5000}
        widthOverride={1000}
      />,
    );

    const leafGroup = container.querySelector('g[data-span-id$="leaf"]');
    fireEvent.mouseEnter(leafGroup!);
    fireEvent.mouseLeave(leafGroup!);

    const sibBar = container.querySelector(
      'g[data-span-id$="sib"] rect.voi-waterfall-bar',
    );
    // After hover-end nothing is dimmed.
    expect(sibBar!.getAttribute("data-dimmed")).toBe("false");
  });

  it("clicking a bar fires onSelect with the spanRowId", () => {
    const spans = chain();
    let selected: string | null = null;
    const { container } = render(
      <Waterfall
        spans={spans}
        selectedSpanId={null}
        onSelect={(id) => {
          selected = id;
        }}
        nowMs={BASE_START_MS + 5000}
        widthOverride={1000}
      />,
    );

    const midBar = container.querySelector(
      'g[data-span-id$="mid"] rect.voi-waterfall-bar',
    );
    fireEvent.click(midBar!);
    expect(selected).toBe(spans.find((s) => s.SpanId === "mid")!.TraceId + "mid");
  });

  it("does not pulse completed spans (no data-running=true)", () => {
    const spans = chain();
    const { container } = render(
      <Waterfall
        spans={spans}
        selectedSpanId={null}
        onSelect={() => {}}
        nowMs={BASE_START_MS + 10_000}
        widthOverride={1000}
      />,
    );
    const runningBars = container.querySelectorAll('rect.voi-waterfall-bar[data-running="true"]');
    expect(runningBars.length).toBe(0);
  });
});
