import { describe, expect, it } from "vitest";
import {
  computeTreeOrder,
  findNodeById,
  groupSpans,
  groupSpansToTree,
  parseTimestamp,
  reconcileSelection,
  type SessionNode,
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
  // VOI-386 round-3 fix: legacy nodes (un-stamped codex, agent-obs-sdk
  // smoke spans, claude-code without a SessionId) now carry a `legacy::`
  // prefix on their id to avoid colliding with claude-rooted ids that
  // happen to equal the underlying session key. `sessionKey` is still
  // the user-meaningful identifier (no prefix), so the display label
  // and tooltips read the same as before.
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
    expect(sessions.map((s) => s.sessionKey)).toEqual(["span-1"]);
    expect(sessions.map((s) => s.id)).toEqual(["legacy::span-1"]);
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
    expect(sessions.map((s) => s.sessionKey)).toEqual(["agent-1"]);
    expect(sessions.map((s) => s.id)).toEqual(["legacy::agent-1"]);
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
    expect(new Set(sessions.map((s) => s.sessionKey))).toEqual(
      new Set(["trace-fallback", "trace-run"]),
    );
    expect(new Set(sessions.map((s) => s.id))).toEqual(
      new Set(["legacy::trace-fallback", "legacy::trace-run"]),
    );
  });

  it("legacy node id is prefixed so it cannot collide with a claude root id (round-3 fix)", () => {
    // Setup: a real claude session with SessionId="abc123" AND a
    // non-claude-code span whose SpanAttributes['session.id'] also
    // equals "abc123". Without the legacy:: prefix, both nodes would
    // carry id="abc123" and findNodeById would non-deterministically
    // select whichever LIFO traversal happened to encounter first.
    const forest = groupSpansToTree([
      claudeSpan({
        sessionId: "abc123",
        spanId: "claude-root",
        timestamp: "2026-01-01T00:00:01.000000000",
      }),
      span({
        traceId: "smoke-trace",
        spanId: "smoke-root",
        timestamp: "2026-01-01T00:00:02.000000000",
        serviceName: "agent-obs-sdk",
        sessionId: "abc123",
      }),
    ]);
    const ids = forest.map((n) => n.id).sort();
    expect(ids).toContain("abc123");
    expect(ids).toContain("legacy::abc123");
    // Distinct nodes, distinct kinds.
    const claudeNode = forest.find((n) => n.id === "abc123");
    const legacyNode = forest.find((n) => n.id === "legacy::abc123");
    expect(claudeNode?.kind).toBe("claude");
    expect(legacyNode?.kind).toBe("claude"); // agent-obs-sdk → claude fallback per buildLegacyNodes
    expect(legacyNode?.sessionKey).toBe("abc123");
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

  it("hasErrorSurvivesCycleOnlyTrace", () => {
    // Mirrors SessionGrouping.swift: error detection scans raw trace rows,
    // not the ordered/visible set. A cycle-only trace whose spans are all
    // dropped by computeTreeOrder must still surface as failing so broken
    // traces do not look healthy in the session list.
    const sessions = groupSpans([
      span({
        spanId: "a",
        parentSpanId: "b",
        timestamp: "2026-01-01T00:00:01.000000000",
        statusCode: "Error",
      }),
      span({
        spanId: "b",
        parentSpanId: "a",
        timestamp: "2026-01-01T00:00:02.000000000",
      }),
    ]);
    const trace = sessions[0]?.traces[0];
    expect(trace?.spanCount).toBe(0);
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

describe("parseTimestamp", () => {
  const epoch = Date.UTC(2026, 0, 1, 0, 0, 0);

  it("parses the ClickHouse nanosecond format", () => {
    expect(parseTimestamp("2026-01-01T00:00:00.000000000")).toBe(epoch);
  });

  it("parses the space-separated form", () => {
    expect(parseTimestamp("2026-01-01 00:00:00.000000000")).toBe(epoch);
  });

  it("parses an ISO timestamp with Z but no fractional seconds", () => {
    // Regression: an earlier impl appended '.000' to the end of the string
    // ('...Z.000'), producing an invalid timestamp that Date.parse rejected.
    // The row would then be grouped with the distant-past sentinel and
    // break last-activity ordering / duration / activity status.
    expect(parseTimestamp("2026-01-01T00:00:00Z")).toBe(epoch);
  });

  it("parses an ISO timestamp with +HH:MM offset but no fractional seconds", () => {
    expect(parseTimestamp("2026-01-01T00:00:00+00:00")).toBe(epoch);
  });

  it("parses an ISO timestamp with fractional seconds AND a Z suffix", () => {
    expect(parseTimestamp("2026-01-01T00:00:00.500Z")).toBe(epoch + 500);
  });

  it("parses an ISO timestamp with fractional seconds AND a +HH:MM offset", () => {
    expect(parseTimestamp("2026-01-01T00:00:00.500+00:00")).toBe(epoch + 500);
  });

  it("returns null for empty input", () => {
    expect(parseTimestamp("")).toBeNull();
  });

  it("returns null for a '.' with no digits", () => {
    expect(parseTimestamp("2026-01-01T00:00:00.Z")).toBeNull();
  });

  it("returns null for garbage after the fractional digits", () => {
    expect(parseTimestamp("2026-01-01T00:00:00.500x")).toBeNull();
  });
});

// ---------- VOI-386 tree builder ----------
//
// Helpers below construct hand-rolled fixtures for the
// claude → subagent → codex hierarchy. The flow under test:
//   1. claude root  = bucket of ServiceName="claude-code" spans by
//                     SpanAttributes['session.id'].
//   2. subagent     = bucket of those spans by SpanAttributes['agent_id']
//                     IF that agent_id was the first descendant of a
//                     dispatch span (SpanAttributes['subagent_type']).
//   3. codex node   = bucket of ServiceName="codex_exec" spans by
//                     ResourceAttributes['agent.session.id'], parent
//                     resolved via two-tier fallback (parent.span.id walk
//                     → parent.session.id → null).

interface ClaudeSpanOverrides {
  sessionId: string;
  spanId: string;
  parentSpanId?: string;
  timestamp?: string;
  agentId?: string;
  subagentType?: string;
  spanName?: string;
}

function claudeSpan(o: ClaudeSpanOverrides): SpanRow {
  return span({
    traceId: `claude-trace-${o.sessionId}`,
    spanId: o.spanId,
    parentSpanId: o.parentSpanId ?? "",
    spanName: o.spanName ?? "claude_code.tool.bash",
    timestamp: o.timestamp ?? "2026-01-01T00:00:01.000000000",
    serviceName: "claude-code",
    sessionId: o.sessionId,
    spanAttributesRaw: {
      ...(o.agentId ? { agent_id: o.agentId } : {}),
      ...(o.subagentType ? { subagent_type: o.subagentType } : {}),
    },
  });
}

interface CodexSpanOverrides {
  codexSessionId: string;
  spanId: string;
  parentSpanId?: string;
  timestamp?: string;
  parentSpanIdStamp?: string;
  parentSessionIdStamp?: string;
  spanName?: string;
}

function codexSpan(o: CodexSpanOverrides): SpanRow {
  const resAttrs: Record<string, string> = {
    "agent.session.id": o.codexSessionId,
    "agent.kind": "codex_exec",
  };
  if (o.parentSpanIdStamp) {
    resAttrs["agent.parent.span.id"] = o.parentSpanIdStamp;
  }
  if (o.parentSessionIdStamp) {
    resAttrs["agent.parent.session.id"] = o.parentSessionIdStamp;
  }
  return span({
    traceId: `codex-trace-${o.codexSessionId}-${o.spanId}`,
    spanId: o.spanId,
    parentSpanId: o.parentSpanId ?? "",
    spanName: o.spanName ?? "codex_exec.invoke",
    timestamp: o.timestamp ?? "2026-01-01T00:00:02.000000000",
    serviceName: "codex_exec",
    sessionId: "",
    agentSessionId: o.codexSessionId,
    resourceAttributesRaw: resAttrs,
  });
}

function findRootBySession(
  forest: SessionNode[],
  sessionId: string,
): SessionNode {
  const node = forest.find((n) => n.id === sessionId);
  if (!node) throw new Error(`no root for session ${sessionId}`);
  return node;
}

describe("groupSpansToTree (VOI-386)", () => {
  it("single claude session, no subagents → one root, zero children, owns all spans", () => {
    const forest = groupSpansToTree([
      claudeSpan({
        sessionId: "sess-A",
        spanId: "s1",
        timestamp: "2026-01-01T00:00:01.000000000",
      }),
      claudeSpan({
        sessionId: "sess-A",
        spanId: "s2",
        parentSpanId: "s1",
        timestamp: "2026-01-01T00:00:02.000000000",
      }),
    ]);
    expect(forest.length).toBe(1);
    const root = forest[0]!;
    expect(root.kind).toBe("claude");
    expect(root.parentId).toBeNull();
    expect(root.children.length).toBe(0);
    expect(root.spans.length).toBe(2);
    expect(root.spanCount).toBe(2);
  });

  it("claude session with one subagent → child kind=subagent, label = subagent_type, span ownership split", () => {
    const forest = groupSpansToTree([
      // Root claude work span (no agent_id → claude owns it).
      claudeSpan({
        sessionId: "sess-B",
        spanId: "root",
        timestamp: "2026-01-01T00:00:01.000000000",
      }),
      // Dispatch span: carries subagent_type.
      claudeSpan({
        sessionId: "sess-B",
        spanId: "dispatch",
        parentSpanId: "root",
        timestamp: "2026-01-01T00:00:02.000000000",
        subagentType: "ui-implementer",
      }),
      // Subagent's first work span (agent_id="sub-1") — tree descendant
      // of dispatch span. dispatch span tree-walk picks this agent_id up.
      claudeSpan({
        sessionId: "sess-B",
        spanId: "sub-first",
        parentSpanId: "dispatch",
        timestamp: "2026-01-01T00:00:03.000000000",
        agentId: "sub-1",
      }),
      claudeSpan({
        sessionId: "sess-B",
        spanId: "sub-second",
        parentSpanId: "sub-first",
        timestamp: "2026-01-01T00:00:04.000000000",
        agentId: "sub-1",
      }),
    ]);
    expect(forest.length).toBe(1);
    const root = forest[0]!;
    expect(root.kind).toBe("claude");
    expect(root.children.length).toBe(1);
    const subagent = root.children[0]!;
    expect(subagent.kind).toBe("subagent");
    expect(subagent.parentId).toBe(root.id);
    expect(subagent.displayLabel).toBe("ui-implementer");
    // Span ownership: subagent gets its two work spans; root keeps the
    // non-agent-id spans (root + dispatch).
    expect(subagent.spans.map((s) => s.SpanId).sort()).toEqual([
      "sub-first",
      "sub-second",
    ]);
    expect(root.spans.map((s) => s.SpanId).sort()).toEqual([
      "dispatch",
      "root",
    ]);
  });

  it("subagent-launched codex → claude → subagent → codex (3 levels deep)", () => {
    const forest = groupSpansToTree([
      claudeSpan({
        sessionId: "sess-C",
        spanId: "root",
        timestamp: "2026-01-01T00:00:01.000000000",
      }),
      claudeSpan({
        sessionId: "sess-C",
        spanId: "dispatch",
        parentSpanId: "root",
        timestamp: "2026-01-01T00:00:02.000000000",
        subagentType: "implementer",
      }),
      // Subagent work span — parent of the eventual codex stamp anchor.
      claudeSpan({
        sessionId: "sess-C",
        spanId: "sub-work",
        parentSpanId: "dispatch",
        timestamp: "2026-01-01T00:00:03.000000000",
        agentId: "sub-2",
      }),
      // Codex spans: stamped with agent.parent.span.id pointing at the
      // subagent's work span. The resolver should walk that span's
      // ancestry → land on agent_id=sub-2 → nest under that subagent.
      codexSpan({
        codexSessionId: "codex-X",
        spanId: "cx-1",
        parentSpanIdStamp: "sub-work",
        parentSessionIdStamp: "sess-C",
        timestamp: "2026-01-01T00:00:04.000000000",
      }),
    ]);
    expect(forest.length).toBe(1);
    const root = findRootBySession(forest, "sess-C");
    expect(root.children.length).toBe(1);
    const subagent = root.children[0]!;
    expect(subagent.kind).toBe("subagent");
    expect(subagent.children.length).toBe(1);
    const codex = subagent.children[0]!;
    expect(codex.kind).toBe("codex");
    expect(codex.parentId).toBe(subagent.id);
    expect(codex.sessionKey).toBe("codex-X");
  });

  it("main-agent-launched codex → claude → codex (no subagent intervening)", () => {
    const forest = groupSpansToTree([
      claudeSpan({
        sessionId: "sess-D",
        spanId: "root",
        timestamp: "2026-01-01T00:00:01.000000000",
      }),
      // No dispatch span — main agent calls codex directly. The codex
      // stamp's parent.span.id walk finds no agent_id ancestor (root
      // claude span has none); falls through to parent.session.id which
      // matches sess-D.
      codexSpan({
        codexSessionId: "codex-Y",
        spanId: "cy-1",
        parentSpanIdStamp: "root",
        parentSessionIdStamp: "sess-D",
        timestamp: "2026-01-01T00:00:02.000000000",
      }),
    ]);
    const root = findRootBySession(forest, "sess-D");
    expect(root.children.length).toBe(1);
    const codex = root.children[0]!;
    expect(codex.kind).toBe("codex");
    expect(codex.parentId).toBe(root.id);
  });

  it("standalone codex (no parent session id) → top-level codex root", () => {
    const forest = groupSpansToTree([
      codexSpan({
        codexSessionId: "codex-Z",
        spanId: "cz-1",
        timestamp: "2026-01-01T00:00:01.000000000",
      }),
    ]);
    expect(forest.length).toBe(1);
    const codex = forest[0]!;
    expect(codex.kind).toBe("codex");
    expect(codex.parentId).toBeNull();
  });

  it("codex with parent.session.id but claude session not in window → top-level codex with orphan-parent label", () => {
    const forest = groupSpansToTree([
      codexSpan({
        codexSessionId: "codex-W",
        spanId: "cw-1",
        parentSessionIdStamp: "missing-claude-session",
        timestamp: "2026-01-01T00:00:01.000000000",
      }),
    ]);
    const codex = forest.find((n) => n.sessionKey === "codex-W");
    expect(codex).not.toBeUndefined();
    expect(codex!.parentId).toBeNull();
    expect(codex!.displayLabel).toMatch(/orphan parent/);
  });

  it("multiple codex execs under the same subagent → distinct codex nodes keyed by agent.session.id", () => {
    const forest = groupSpansToTree([
      claudeSpan({
        sessionId: "sess-E",
        spanId: "root",
        timestamp: "2026-01-01T00:00:01.000000000",
      }),
      claudeSpan({
        sessionId: "sess-E",
        spanId: "dispatch",
        parentSpanId: "root",
        timestamp: "2026-01-01T00:00:02.000000000",
        subagentType: "implementer",
      }),
      claudeSpan({
        sessionId: "sess-E",
        spanId: "sub-anchor",
        parentSpanId: "dispatch",
        timestamp: "2026-01-01T00:00:03.000000000",
        agentId: "sub-E",
      }),
      codexSpan({
        codexSessionId: "codex-E1",
        spanId: "ce1-1",
        parentSpanIdStamp: "sub-anchor",
        parentSessionIdStamp: "sess-E",
        timestamp: "2026-01-01T00:00:04.000000000",
      }),
      codexSpan({
        codexSessionId: "codex-E2",
        spanId: "ce2-1",
        parentSpanIdStamp: "sub-anchor",
        parentSessionIdStamp: "sess-E",
        timestamp: "2026-01-01T00:00:05.000000000",
      }),
    ]);
    const root = findRootBySession(forest, "sess-E");
    const subagent = root.children[0]!;
    expect(subagent.children.length).toBe(2);
    const codexKeys = subagent.children
      .map((c) => c.sessionKey)
      .sort();
    expect(codexKeys).toEqual(["codex-E1", "codex-E2"]);
    for (const codex of subagent.children) {
      expect(codex.kind).toBe("codex");
    }
  });

  it("un-stamped historical codex (no agent.session.id) does NOT promote to tree codex node", () => {
    // Spec § "stamped-data-only": codex spans without the explicit stamp
    // remain in the legacy bucket — they fall through to the effective-
    // session-key path and surface as a flat node, not a tree codex node.
    const forest = groupSpansToTree([
      span({
        traceId: "legacy-trace",
        spanId: "legacy-span",
        timestamp: "2026-01-01T00:00:01.000000000",
        serviceName: "codex_exec",
        sessionId: "",
        agentSessionId: "",
      }),
    ]);
    // No tree codex node — the row collapses to legacy effective-key
    // bucketing (TraceId fallback). The node exists, but its sessionKey
    // is not "anything" — what matters is no claude→codex tree structure
    // emerged (no claude parent, no stamped codex node).
    expect(forest.length).toBe(1);
    const onlyNode = forest[0]!;
    expect(onlyNode.children.length).toBe(0);
    // Effective key fell through to TraceId.
    expect(onlyNode.sessionKey).toBe("legacy-trace");
  });

  it("siblings at every level sort by lastActivity desc", () => {
    const forest = groupSpansToTree([
      // sess-OLD ends at :01.
      claudeSpan({
        sessionId: "sess-OLD",
        spanId: "old-root",
        timestamp: "2026-01-01T00:00:01.000000000",
      }),
      // sess-NEW ends at :05 — should sort FIRST in the forest.
      claudeSpan({
        sessionId: "sess-NEW",
        spanId: "new-root",
        timestamp: "2026-01-01T00:00:05.000000000",
      }),
    ]);
    expect(forest.map((n) => n.sessionKey)).toEqual([
      "sess-NEW",
      "sess-OLD",
    ]);
  });

  it("findNodeById finds deeply nested nodes; null for missing; cycle-safe", () => {
    const forest = groupSpansToTree([
      claudeSpan({
        sessionId: "sess-F",
        spanId: "root",
        timestamp: "2026-01-01T00:00:01.000000000",
      }),
      claudeSpan({
        sessionId: "sess-F",
        spanId: "dispatch",
        parentSpanId: "root",
        timestamp: "2026-01-01T00:00:02.000000000",
        subagentType: "ui-implementer",
      }),
      claudeSpan({
        sessionId: "sess-F",
        spanId: "sub-anchor",
        parentSpanId: "dispatch",
        timestamp: "2026-01-01T00:00:03.000000000",
        agentId: "sub-F",
      }),
      codexSpan({
        codexSessionId: "codex-F",
        spanId: "cf-1",
        parentSpanIdStamp: "sub-anchor",
        parentSessionIdStamp: "sess-F",
        timestamp: "2026-01-01T00:00:04.000000000",
      }),
    ]);
    const subagent = forest[0]!.children[0]!;
    const codex = subagent.children[0]!;
    expect(findNodeById(forest, codex.id)?.sessionKey).toBe("codex-F");
    expect(findNodeById(forest, subagent.id)?.kind).toBe("subagent");
    expect(findNodeById(forest, "absent")).toBeNull();
    expect(findNodeById(forest, null)).toBeNull();
    // Cycle-safety check: build a hand-rolled cyclic forest. The visited
    // set in findNodeById should bound the walk regardless.
    const cycleA: SessionNode = {
      ...forest[0]!,
      id: "cyc-A",
      children: [],
    };
    const cycleB: SessionNode = {
      ...forest[0]!,
      id: "cyc-B",
      children: [cycleA],
    };
    cycleA.children = [cycleB];
    expect(findNodeById([cycleA], "cyc-B")?.id).toBe("cyc-B");
    expect(findNodeById([cycleA], "nope")).toBeNull();
  });

  it("nested subagent (subagent dispatching another subagent) reparents under the outer subagent — not the claude root", () => {
    // Spec § Layer 1 step 2: "Parent = the enclosing claude session OR
    // an enclosing subagent, via the span tree, if subagents nest."
    // Claude /code-review P2 #1 fix.
    //
    // Topology: claude root → outer subagent (a-outer) → inner subagent (a-inner).
    // The inner dispatch span has agent_id=a-outer (it lives under the outer
    // subagent's work tree); the inner's own agent_id is a-inner.
    const forest = groupSpansToTree([
      claudeSpan({
        sessionId: "sess-nest",
        spanId: "root",
        timestamp: "2026-01-01T00:00:01.000000000",
      }),
      // Outer dispatch — dispatched BY the root agent (so dispatch span
      // has no agent_id).
      claudeSpan({
        sessionId: "sess-nest",
        spanId: "outer-dispatch",
        parentSpanId: "root",
        timestamp: "2026-01-01T00:00:02.000000000",
        subagentType: "outer",
      }),
      claudeSpan({
        sessionId: "sess-nest",
        spanId: "outer-work",
        parentSpanId: "outer-dispatch",
        timestamp: "2026-01-01T00:00:03.000000000",
        agentId: "a-outer",
      }),
      // Inner dispatch — has agent_id=a-outer because it's emitted FROM
      // the outer subagent's context.
      claudeSpan({
        sessionId: "sess-nest",
        spanId: "inner-dispatch",
        parentSpanId: "outer-work",
        timestamp: "2026-01-01T00:00:04.000000000",
        agentId: "a-outer",
        subagentType: "inner",
      }),
      claudeSpan({
        sessionId: "sess-nest",
        spanId: "inner-work",
        parentSpanId: "inner-dispatch",
        timestamp: "2026-01-01T00:00:05.000000000",
        agentId: "a-inner",
      }),
    ]);
    const root = findRootBySession(forest, "sess-nest");
    // Outer subagent must be a direct child of the claude root.
    expect(root.children.length).toBe(1);
    const outer = root.children[0]!;
    expect(outer.kind).toBe("subagent");
    expect(outer.displayLabel).toBe("outer");
    // Inner subagent must nest under OUTER, NOT under root.
    expect(outer.children.length).toBe(1);
    const inner = outer.children[0]!;
    expect(inner.kind).toBe("subagent");
    expect(inner.displayLabel).toBe("inner");
    expect(inner.parentId).toBe(outer.id);
  });

  it("cross-session agent_id collision does NOT cross-talk subagent resolution", () => {
    // Two distinct claude sessions whose subagents happen to share an
    // agent_id (counter-based ids, fixture replays, etc). Each session's
    // codex stamp must resolve to ITS OWN subagent, not the other one.
    // Claude /code-review P2 #2 fix.
    const forest = groupSpansToTree([
      // Session A:
      claudeSpan({
        sessionId: "sess-A",
        spanId: "a-root",
        timestamp: "2026-01-01T00:00:01.000000000",
      }),
      claudeSpan({
        sessionId: "sess-A",
        spanId: "a-dispatch",
        parentSpanId: "a-root",
        timestamp: "2026-01-01T00:00:02.000000000",
        subagentType: "sub-A",
      }),
      claudeSpan({
        sessionId: "sess-A",
        spanId: "a-sub",
        parentSpanId: "a-dispatch",
        timestamp: "2026-01-01T00:00:03.000000000",
        agentId: "shared-id",
      }),
      // Session B (uses the SAME shared-id agent_id):
      claudeSpan({
        sessionId: "sess-B",
        spanId: "b-root",
        timestamp: "2026-01-01T00:00:10.000000000",
      }),
      claudeSpan({
        sessionId: "sess-B",
        spanId: "b-dispatch",
        parentSpanId: "b-root",
        timestamp: "2026-01-01T00:00:11.000000000",
        subagentType: "sub-B",
      }),
      claudeSpan({
        sessionId: "sess-B",
        spanId: "b-sub",
        parentSpanId: "b-dispatch",
        timestamp: "2026-01-01T00:00:12.000000000",
        agentId: "shared-id",
      }),
      // A codex stamped to session A whose parent.span.id walks up into A's subtree.
      codexSpan({
        codexSessionId: "codex-A",
        spanId: "ca-1",
        parentSpanIdStamp: "a-sub",
        parentSessionIdStamp: "sess-A",
        timestamp: "2026-01-01T00:00:04.000000000",
      }),
    ]);
    const rootA = findRootBySession(forest, "sess-A");
    const subA = rootA.children[0]!;
    expect(subA.displayLabel).toBe("sub-A");
    // The codex's resolved parent should be sub-A — not sub-B (which
    // also has shared-id agent_id). Per-session scoping ensures this.
    expect(subA.children.length).toBe(1);
    expect(subA.children[0]!.sessionKey).toBe("codex-A");
    const rootB = findRootBySession(forest, "sess-B");
    const subB = rootB.children[0]!;
    expect(subB.displayLabel).toBe("sub-B");
    // sub-B must NOT have inherited codex-A.
    expect(subB.children.length).toBe(0);
  });

  it("SpanId collision across sessions does NOT misdirect the codex parent walk (codex P2 round-2 2026-05-31)", () => {
    // SpanIds are 64-bit (16-hex); collisions across in-window traces /
    // sessions are rare but realistic with fixture replays, idempotent
    // ingestion, and busy multi-trace windows. Codex stamps
    // agent.parent.span.id WITHOUT an accompanying agent.parent.trace.id,
    // so the walker needs a SpanId-keyed lookup that is SAFE against
    // cross-session collisions.
    //
    // Critical detail: ClickHouse polling uses `ORDER BY Timestamp DESC`,
    // so rows arrive newest-first. The fixture below inserts the WRONG-
    // session collision row (sess-Y) BEFORE the legitimate row (sess-X).
    // A first-wins-by-SpanId map would bind 'shared-span' to sess-Y's
    // row; the round-1 fix added a "reject if row.SessionId !=
    // parentSessionId" guard but the guard TERMINATES the walk instead
    // of finding the legitimate row — so the codex falls back to tier-2
    // (claude root) and the test would see sub-X.children.length === 0.
    // The round-2 fix keys the bucket itself by (sessionId, spanId) so
    // both collision candidates are addressable, and the walker scopes
    // lookup via the codex's stamped parent.session.id.
    const forest = groupSpansToTree([
      // WRONG-SESSION COLLISION ROW FIRST (mimics ORDER BY DESC newest-
      // first ingestion). Session Y has a span with SpanId='shared-span'.
      claudeSpan({
        sessionId: "sess-Y",
        spanId: "y-root",
        timestamp: "2026-01-01T00:00:10.000000000",
      }),
      claudeSpan({
        sessionId: "sess-Y",
        spanId: "y-dispatch",
        parentSpanId: "y-root",
        timestamp: "2026-01-01T00:00:11.000000000",
        subagentType: "sub-Y",
      }),
      claudeSpan({
        sessionId: "sess-Y",
        // SAME SpanId as sess-X's subagent ancestor below. Inserted FIRST.
        spanId: "shared-span",
        parentSpanId: "y-dispatch",
        timestamp: "2026-01-01T00:00:12.000000000",
        agentId: "agent-Y",
      }),
      // Session X: the legitimate ancestry the codex stamps point into.
      claudeSpan({
        sessionId: "sess-X",
        spanId: "x-root",
        timestamp: "2026-01-01T00:00:01.000000000",
      }),
      claudeSpan({
        sessionId: "sess-X",
        spanId: "x-dispatch",
        parentSpanId: "x-root",
        timestamp: "2026-01-01T00:00:02.000000000",
        subagentType: "sub-X",
      }),
      claudeSpan({
        sessionId: "sess-X",
        // Colliding SpanId — inserted SECOND. A first-wins-by-SpanId map
        // would hide this row behind sess-Y's.
        spanId: "shared-span",
        parentSpanId: "x-dispatch",
        timestamp: "2026-01-01T00:00:03.000000000",
        agentId: "agent-X",
      }),
      // Codex stamped to sess-X. parent.span.id='shared-span' must
      // resolve into sess-X's subagent, not sess-Y's, even though Y's
      // row was indexed first.
      codexSpan({
        codexSessionId: "codex-X",
        spanId: "cx-1",
        parentSpanIdStamp: "shared-span",
        parentSessionIdStamp: "sess-X",
        timestamp: "2026-01-01T00:00:04.000000000",
      }),
    ]);

    // The codex must be nested under sub-X (resolved via tier-1 walker
    // with (sessionId, spanId) keyed lookup), NOT under sub-Y and NOT
    // orphaned/tier-2'd to the claude root.
    const rootX = findRootBySession(forest, "sess-X");
    expect(rootX.children.length).toBe(1);
    const subX = rootX.children[0]!;
    expect(subX.displayLabel).toBe("sub-X");
    expect(subX.children.length).toBe(1);
    expect(subX.children[0]!.sessionKey).toBe("codex-X");

    // sub-Y must not have inherited the codex.
    const rootY = findRootBySession(forest, "sess-Y");
    expect(rootY.children.length).toBe(1);
    const subY = rootY.children[0]!;
    expect(subY.displayLabel).toBe("sub-Y");
    expect(subY.children.length).toBe(0);
  });

  it("dispatch-absent: agent_id spans still bucket into a subagent node (codex P2 round-3 2026-05-31)", () => {
    // Polling windows are bounded: a long-running session whose dispatch
    // span (subagent_type) has aged out OR been truncated still emits
    // subagent work spans with agent_id. Per spec § Layer 1 step 2
    // ("bucket the claude spans that carry a (non-root) agent_id by that
    // agent_id"), the dispatch span is for LABELING — bucketing must
    // happen on agent_id alone. Without this, work spans fold into the
    // claude root and the subagent → codex relationship vanishes from
    // the visible tree for any session whose window doesn't include the
    // original dispatch.
    const forest = groupSpansToTree([
      // Claude root span — no agent_id.
      claudeSpan({
        sessionId: "sess-dispatch-gone",
        spanId: "root-w",
        timestamp: "2026-01-01T00:10:00.000000000",
      }),
      // Subagent work span — has agent_id but NO matching dispatch span
      // in this window (the original dispatch aged out of the poll).
      claudeSpan({
        sessionId: "sess-dispatch-gone",
        spanId: "sub-w-1",
        parentSpanId: "root-w",
        timestamp: "2026-01-01T00:10:01.000000000",
        agentId: "lonely-agent",
      }),
      claudeSpan({
        sessionId: "sess-dispatch-gone",
        spanId: "sub-w-2",
        parentSpanId: "sub-w-1",
        timestamp: "2026-01-01T00:10:02.000000000",
        agentId: "lonely-agent",
      }),
      // Codex launched from inside that orphaned subagent — its parent
      // resolution should still nest it under the subagent bucket.
      codexSpan({
        codexSessionId: "codex-orphan",
        spanId: "co-1",
        parentSpanIdStamp: "sub-w-2",
        parentSessionIdStamp: "sess-dispatch-gone",
        timestamp: "2026-01-01T00:10:03.000000000",
      }),
    ]);

    const root = findRootBySession(forest, "sess-dispatch-gone");
    expect(root.children.length).toBe(1);
    const sub = root.children[0]!;
    expect(sub.kind).toBe("subagent");
    // Label falls back to the agent_id itself (since the dispatch span
    // carrying subagent_type isn't in the window).
    expect(sub.displayLabel).toBe("lonely-agent");
    // Subagent owns its two work spans; claude root keeps root-w only.
    expect(sub.spans.map((s) => s.SpanId).sort()).toEqual([
      "sub-w-1",
      "sub-w-2",
    ]);
    expect(root.spans.map((s) => s.SpanId).sort()).toEqual(["root-w"]);
    // Codex still resolves through the tier-1 walker into the subagent.
    expect(sub.children.length).toBe(1);
    expect(sub.children[0]!.sessionKey).toBe("codex-orphan");
  });

  it("groupSpans alias matches groupSpansToTree output", () => {
    const rows = [
      claudeSpan({
        sessionId: "sess-alias",
        spanId: "s1",
        timestamp: "2026-01-01T00:00:01.000000000",
      }),
    ];
    expect(groupSpans(rows).map((n) => n.id)).toEqual(
      groupSpansToTree(rows).map((n) => n.id),
    );
  });
});

