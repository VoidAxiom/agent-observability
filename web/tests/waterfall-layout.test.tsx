import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Waterfall } from "../src/components/Waterfall";
import { computeTreeOrder, type SpanRow } from "../src/lib/grouping";

interface SpanInput {
  spanId: string;
  parentSpanId?: string;
  spanName?: string;
  startOffsetMs: number;
  durationMs: number;
  serviceName?: string;
}

const BASE_START_MS = Date.parse("2026-01-01T00:00:00.000Z");

function span(input: SpanInput): SpanRow {
  const startMs = BASE_START_MS + input.startOffsetMs;
  const iso = new Date(startMs).toISOString();
  // Convert the Date.toISOString form ("...Z") to the CH-style padded
  // nanosecond form parseTimestamp also accepts.
  const timestamp = iso.replace("Z", "000000Z");
  return {
    TraceId: "trace-1",
    SpanId: input.spanId,
    ParentSpanId: input.parentSpanId ?? "",
    SpanName: input.spanName ?? input.spanId,
    Timestamp: timestamp,
    ServiceName: input.serviceName ?? "claude-code",
    StatusCode: "",
    Duration: input.durationMs * 1_000_000,
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

function fixture(): SpanRow[] {
  // 8 spans across 3 depths.
  //  root (0)
  //   ├ child-a (1)
  //   │   ├ grand-a1 (2)
  //   │   └ grand-a2 (2)
  //   ├ child-b (1)
  //   │   └ grand-b1 (2)
  //   └ child-c (1)
  const rows: SpanRow[] = [
    span({ spanId: "root", startOffsetMs: 0, durationMs: 1000 }),
    span({
      spanId: "child-a",
      parentSpanId: "root",
      startOffsetMs: 50,
      durationMs: 400,
    }),
    span({
      spanId: "grand-a1",
      parentSpanId: "child-a",
      startOffsetMs: 100,
      durationMs: 100,
    }),
    span({
      spanId: "grand-a2",
      parentSpanId: "child-a",
      startOffsetMs: 250,
      durationMs: 150,
    }),
    span({
      spanId: "child-b",
      parentSpanId: "root",
      startOffsetMs: 500,
      durationMs: 200,
    }),
    span({
      spanId: "grand-b1",
      parentSpanId: "child-b",
      startOffsetMs: 520,
      durationMs: 100,
    }),
    span({
      spanId: "child-c",
      parentSpanId: "root",
      startOffsetMs: 750,
      durationMs: 200,
    }),
    span({
      spanId: "tiny",
      parentSpanId: "root",
      startOffsetMs: 990,
      durationMs: 0.0001,
    }),
  ];
  return computeTreeOrder(rows);
}

describe("Waterfall layout", () => {
  it("renders one bar per span (8) in tree order", () => {
    const spans = fixture();
    const { container } = render(
      <Waterfall
        spans={spans}
        selectedSpanId={null}
        onSelect={() => {}}
        nowMs={BASE_START_MS + 5000}
        widthOverride={1000}
      />,
    );
    const bars = container.querySelectorAll("rect.voi-waterfall-bar");
    expect(bars.length).toBe(8);

    const orderedIds = Array.from(bars).map((rect) =>
      (rect.parentElement as Element).getAttribute("data-span-id"),
    );
    const expectedOrder = spans.map((s) => s.TraceId + s.SpanId);
    expect(orderedIds).toEqual(expectedOrder);
  });

  it("bar X / width match (start - minStart) / duration projection", () => {
    const spans = fixture();
    const widthOverride = 1000;
    const innerWidth = widthOverride - 0 - 8; // LEFT_GUTTER=0, RIGHT_PAD=8
    const { container } = render(
      <Waterfall
        spans={spans}
        selectedSpanId={null}
        onSelect={() => {}}
        nowMs={BASE_START_MS + 5000}
        widthOverride={widthOverride}
      />,
    );

    const rootBar = container.querySelector(
      'g[data-span-id$="root"] rect.voi-waterfall-bar',
    );
    expect(rootBar).not.toBeNull();
    // Root: offset 0, duration 1000ms; trace window is 0..1000.
    expect(Number(rootBar!.getAttribute("x"))).toBeCloseTo(0, 4);
    expect(Number(rootBar!.getAttribute("width"))).toBeCloseTo(innerWidth, 1);

    const childBBar = container.querySelector(
      'g[data-span-id$="child-b"] rect.voi-waterfall-bar',
    );
    expect(childBBar).not.toBeNull();
    // child-b: offset 500, duration 200; expected x = innerWidth/2, width=innerWidth*0.2.
    expect(Number(childBBar!.getAttribute("x"))).toBeCloseTo(innerWidth * 0.5, 1);
    expect(Number(childBBar!.getAttribute("width"))).toBeCloseTo(
      innerWidth * 0.2,
      1,
    );

    const tinyBar = container.querySelector(
      'g[data-span-id$="tiny"] rect.voi-waterfall-bar',
    );
    expect(tinyBar).not.toBeNull();
    // tiny: 0.1 microseconds → 1px floor.
    expect(Number(tinyBar!.getAttribute("width"))).toBeGreaterThanOrEqual(1);
  });

  it("rowIndex corresponds to tree-order index", () => {
    const spans = fixture();
    const { container } = render(
      <Waterfall
        spans={spans}
        selectedSpanId={null}
        onSelect={() => {}}
        nowMs={BASE_START_MS + 5000}
        widthOverride={1000}
      />,
    );

    spans.forEach((s, idx) => {
      const id = s.TraceId + s.SpanId;
      const g = container.querySelector(`g[data-span-id="${id}"]`);
      expect(g).not.toBeNull();
      expect(g!.getAttribute("data-row-index")).toBe(String(idx));
    });
  });

  it("renders empty state when no spans provided", () => {
    const { container } = render(
      <Waterfall
        spans={[]}
        selectedSpanId={null}
        onSelect={() => {}}
        nowMs={BASE_START_MS}
      />,
    );
    const bars = container.querySelectorAll("rect.voi-waterfall-bar");
    expect(bars.length).toBe(0);
    expect(container.textContent).toContain("//");
  });

  it("emits synthetic no-timestamp bars when every span has an unparseable Timestamp", () => {
    // Codex round-5 P1 2026-05-30: a trace whose spans ALL carry bad
    // timestamps must still surface one synthetic bar per span so the
    // bidirectional click-to-select contract with CollapsibleTraceList
    // holds. The earlier early-return at "no valid window" bypassed the
    // fallback pass entirely.
    const badSpans: SpanRow[] = [
      { ...span({ spanId: "a", startOffsetMs: 0, durationMs: 100 }), Timestamp: "not-a-timestamp" },
      { ...span({ spanId: "b", startOffsetMs: 0, durationMs: 100 }), Timestamp: "" },
      { ...span({ spanId: "c", startOffsetMs: 0, durationMs: 100 }), Timestamp: "0000-00-00" },
    ];
    const { container } = render(
      <Waterfall
        spans={badSpans}
        selectedSpanId={null}
        onSelect={() => {}}
        nowMs={BASE_START_MS}
        widthOverride={1000}
      />,
    );
    const syntheticGroups = container.querySelectorAll(
      'g[data-no-timestamp="true"]',
    );
    expect(syntheticGroups.length).toBe(3);
    const allBars = container.querySelectorAll("rect.voi-waterfall-bar");
    expect(allBars.length).toBe(3);
  });
});
