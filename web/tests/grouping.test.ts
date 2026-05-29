import { describe, expect, it } from "vitest";
import {
  computeTreeOrder,
  groupSpans,
  reconcileSelection,
  type SpanRow,
} from "../src/lib/grouping";

interface SpanOverrides {
  traceId?: string;
  spanId: string;
  parentSpanId?: string;
  spanName?: string;
  timestamp: string;
  serviceName?: string;
  statusCode?: string;
  duration?: number;
  agentProject?: string;
  agentSessionId?: string;
  agentRunId?: string;
  sessionId?: string;
  projectName?: string;
  resourceAttributesRaw?: Record<string, string>;
  spanAttributesRaw?: Record<string, string>;
}

function span(o: SpanOverrides): SpanRow {
  return {
    TraceId: o.traceId ?? "trace",
    SpanId: o.spanId,
    ParentSpanId: o.parentSpanId ?? "",
    SpanName: o.spanName ?? o.spanId,
    Timestamp: o.timestamp,
    ServiceName: o.serviceName ?? "service",
    StatusCode: o.statusCode ?? "",
    Duration: o.duration ?? 0,
    AgentProject: o.agentProject ?? "project",
    AgentSessionId: o.agentSessionId ?? "session",
    AgentRunId: o.agentRunId ?? "run",
    SessionId: o.sessionId ?? "",
    ProjectName: o.projectName ?? "",
    ResourceAttributesRaw: o.resourceAttributesRaw ?? {},
    SpanAttributesRaw: o.spanAttributesRaw ?? {},
    depth: 0,
  };
}

const spanIds = (rows: SpanRow[]): string[] => rows.map((r) => r.SpanId);
const depths = (rows: SpanRow[]): number[] => rows.map((r) => r.depth);

describe("computeTreeOrder", () => {
  it("emptyInputReturnsEmpty", () => {
    expect(computeTreeOrder([])).toEqual([]);
  });

  it("linearChainGetsIncreasingDepth", () => {
    const rows = [
      span({
        spanId: "grandchild",
        parentSpanId: "child",
        timestamp: "2026-01-01T00:00:03.000000000",
      }),
      span({ spanId: "root", timestamp: "2026-01-01T00:00:01.000000000" }),
      span({
        spanId: "child",
        parentSpanId: "root",
        timestamp: "2026-01-01T00:00:02.000000000",
      }),
    ];
    const ordered = computeTreeOrder(rows);
    expect(spanIds(ordered)).toEqual(["root", "child", "grandchild"]);
    expect(depths(ordered)).toEqual([0, 1, 2]);
  });

  it("multipleRootsUsePreorderWithSiblingsSortedByTimestamp", () => {
    const rows = [
      span({ spanId: "root-a", timestamp: "2026-01-01T00:00:02.000000000" }),
      span({
        spanId: "root-a-later-child",
        parentSpanId: "root-a",
        timestamp: "2026-01-01T00:00:04.000000000",
      }),
      span({
        spanId: "root-b-child",
        parentSpanId: "root-b",
        timestamp: "2026-01-01T00:00:05.000000000",
      }),
      span({
        spanId: "root-a-earlier-child",
        parentSpanId: "root-a",
        timestamp: "2026-01-01T00:00:03.000000000",
      }),
      span({ spanId: "root-b", timestamp: "2026-01-01T00:00:01.000000000" }),
    ];
    const ordered = computeTreeOrder(rows);
    expect(spanIds(ordered)).toEqual([
      "root-b",
      "root-b-child",
      "root-a",
      "root-a-earlier-child",
      "root-a-later-child",
    ]);
    expect(depths(ordered)).toEqual([0, 1, 0, 1, 1]);
  });

  it("allRootsAreSortedByTimestampAscending", () => {
    const rows = [
      span({ spanId: "root-b", timestamp: "2026-01-01T00:00:02.000000000" }),
      span({ spanId: "root-a", timestamp: "2026-01-01T00:00:01.000000000" }),
    ];
    const ordered = computeTreeOrder(rows);
    expect(spanIds(ordered)).toEqual(["root-a", "root-b"]);
    expect(depths(ordered)).toEqual([0, 0]);
  });

  it("orphanWithMissingParentIsTreatedAsRoot", () => {
    const rows = [
      span({
        spanId: "orphan-child",
        parentSpanId: "orphan",
        timestamp: "2026-01-01T00:00:02.000000000",
      }),
      span({
        spanId: "orphan",
        parentSpanId: "missing-parent",
        timestamp: "2026-01-01T00:00:01.000000000",
      }),
    ];
    const ordered = computeTreeOrder(rows);
    expect(spanIds(ordered)).toEqual(["orphan", "orphan-child"]);
    expect(depths(ordered)).toEqual([0, 1]);
  });

  it("zeroParentSpanIdIsTreatedAsRoot", () => {
    const rows = [
      span({
        spanId: "child",
        parentSpanId: "root",
        timestamp: "2026-01-01T00:00:02.000000000",
      }),
      span({
        spanId: "root",
        parentSpanId: "0000000000000000",
        timestamp: "2026-01-01T00:00:01.000000000",
      }),
    ];
    const ordered = computeTreeOrder(rows);
    expect(spanIds(ordered)).toEqual(["root", "child"]);
    expect(depths(ordered)).toEqual([0, 1]);
  });

  it("cycleDoesNotRecurseForever", () => {
    const rows = [
      span({
        spanId: "a",
        parentSpanId: "b",
        timestamp: "2026-01-01T00:00:01.000000000",
      }),
      span({
        spanId: "b",
        parentSpanId: "a",
        timestamp: "2026-01-01T00:00:02.000000000",
      }),
    ];
    expect(computeTreeOrder(rows)).toEqual([]);
  });

  it("treeBookkeepingIsScopedByTraceWhenSpanIdsCollide", () => {
    const rows = [
      span({
        traceId: "trace-b",
        spanId: "shared",
        timestamp: "2026-01-01T00:00:01.000000000",
      }),
      span({
        traceId: "trace-a",
        spanId: "child",
        parentSpanId: "shared",
        timestamp: "2026-01-01T00:00:02.000000000",
      }),
      span({
        traceId: "trace-a",
        spanId: "shared",
        timestamp: "2026-01-01T00:00:03.000000000",
      }),
    ];
    const ordered = computeTreeOrder(rows);
    expect(ordered.map((r) => `${r.TraceId}:${r.SpanId}`)).toEqual([
      "trace-b:shared",
      "trace-a:shared",
      "trace-a:child",
    ]);
    expect(depths(ordered)).toEqual([0, 0, 1]);
  });

  it("stableIdUsesTraceAndSpanIdsAfterTreeOrdering", () => {
    const rows = [
      span({
        traceId: "trace-",
        spanId: "child",
        parentSpanId: "root",
        timestamp: "2026-01-01T00:00:02.000000000",
      }),
      span({
        traceId: "trace-",
        spanId: "root",
        timestamp: "2026-01-01T00:00:01.000000000",
      }),
    ];
    const ordered = computeTreeOrder(rows);
    expect(ordered.map((r) => r.TraceId + r.SpanId)).toEqual([
      "trace-root",
      "trace-child",
    ]);
  });
});

describe("groupSpans", () => {
  it("groupSpansPrefersNativeSessionIdOverAgentSessionId", () => {
    const sessions = groupSpans([
      span({
        spanId: "root",
        timestamp: "2026-01-01T00:00:01.000000000",
        agentSessionId: "agent-1",
        sessionId: "span-1",
        projectName: "project-name",
      }),
    ]);
    expect(sessions.map((s) => s.id)).toEqual(["span-1"]);
    expect(sessions[0]?.displayLabel).toBe("project-name · span-1");
  });

  it("fallsBackToAgentSessionIdWhenSessionIdIsMissing", () => {
    const sessions = groupSpans([
      span({
        spanId: "root",
        timestamp: "2026-01-01T00:00:01.000000000",
        agentSessionId: "agent-1",
        sessionId: "",
      }),
    ]);
    expect(sessions.map((s) => s.id)).toEqual(["agent-1"]);
  });

  it("fallsBackToTraceIdWhenSessionAndAgentSessionAreMissing", () => {
    const sessions = groupSpans([
      span({
        traceId: "trace-fallback",
        spanId: "trace-root",
        timestamp: "2026-01-01T00:00:02.000000000",
        agentSessionId: "",
        agentRunId: "",
        sessionId: "",
      }),
      span({
        traceId: "trace-run",
        spanId: "run-root",
        timestamp: "2026-01-01T00:00:01.000000000",
        agentSessionId: "",
        agentRunId: "",
        sessionId: "",
      }),
    ]);
    expect(new Set(sessions.map((s) => s.id))).toEqual(
      new Set(["trace-fallback", "trace-run"]),
    );
  });

  it("lastActivityUsesSpanEndTimeNotStartTime", () => {
    const longSpanTimestamp = "2026-01-01T00:00:00.000000000";
    const laterShortSpanTimestamp = "2026-01-01T00:00:01.000000000";
    const sessions = groupSpans([
      span({
        spanId: "long-span",
        timestamp: longSpanTimestamp,
        duration: 10_000_000_000,
      }),
      span({
        spanId: "later-short",
        timestamp: laterShortSpanTimestamp,
        duration: 0,
      }),
    ]);
    const session = sessions[0];
    const trace = session?.traces[0];
    expect(session?.lastActivityText).toBe(longSpanTimestamp);
    expect(trace?.lastActivityText).toBe(longSpanTimestamp);
    expect(Math.abs((trace?.durationSeconds ?? 0) - 10.0)).toBeLessThan(0.001);
  });

  it("traceDurationUsesSpanDurationForSingleLongSpan", () => {
    const sessions = groupSpans([
      span({
        spanId: "root",
        timestamp: "2026-01-01T00:00:00.000000000",
        duration: 5_000_000_000,
      }),
    ]);
    const trace = sessions[0]?.traces[0];
    expect(Math.abs((trace?.durationSeconds ?? 0) - 5.0)).toBeLessThan(0.001);
  });

  it("hasErrorWhenStatusCodeIsError", () => {
    const sessions = groupSpans([
      span({
        spanId: "root",
        timestamp: "2026-01-01T00:00:00.000000000",
        statusCode: "Error",
      }),
    ]);
    const trace = sessions[0]?.traces[0];
    expect(trace?.hasError).toBe(true);
    expect(sessions[0]?.hasError).toBe(true);
  });
});

describe("reconcileSelection", () => {
  it("keepsOnlyPresentIds", () => {
    const sessions = groupSpans([
      span({
        traceId: "trace-a",
        spanId: "root",
        timestamp: "2026-01-01T00:00:00.000000000",
      }),
    ]);
    const kept = reconcileSelection(
      sessions,
      sessions[0]?.id,
      "trace-a",
      "trace-aroot",
    );
    const cleared = reconcileSelection(
      sessions,
      "missing-session",
      "missing-trace",
      "missing-span",
    );
    expect(kept.selectedSessionId).toBe(sessions[0]?.id);
    expect(kept.selectedTraceId).toBe("trace-a");
    expect(kept.selectedSpanId).toBe("trace-aroot");
    expect(cleared.selectedSessionId).toBeNull();
    expect(cleared.selectedTraceId).toBeNull();
    expect(cleared.selectedSpanId).toBeNull();
  });
});
