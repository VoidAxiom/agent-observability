/*
 * Perf-test fixtures for VOI-388 regression coverage. Builds a synthetic
 * ~100k-span forest mirroring the operator's real shape (107k spans in 1h
 * window; 350k in 6h): a handful of claude sessions, each with a subagent
 * child + several codex children, with the bulk of the spans living under
 * the codex nodes (the realistic "deep trace, many spans" hot spot).
 *
 * Fixtures are deterministic — every span id, trace id, and timestamp
 * derives from the (sessionIndex, agentKind, agentIndex, spanIndex)
 * tuple — so test runs are reproducible and a flake in CI traces back to
 * something other than fixture randomness.
 *
 * Lives in `web/tests/` so it isn't bundled into production. NO export
 * from production code paths.
 */

import type { SessionNode, SpanRow } from "../src/lib/grouping";
import { groupSpansToTree } from "../src/lib/grouping";

/** Target distribution for a ~100k-span synthetic forest. */
export interface ForestShape {
  claudeSessions: number;
  spansPerClaudeSession: number;
  subagentsPerSession: number;
  spansPerSubagent: number;
  codexNodesTotal: number;
  spansPerCodex: number;
  legacyCodexSpans: number;
}

export const DEFAULT_SHAPE: ForestShape = {
  claudeSessions: 8,
  spansPerClaudeSession: 100, // 800 claude root spans
  subagentsPerSession: 1, // 8 subagents
  spansPerSubagent: 500, // 4000 subagent spans
  codexNodesTotal: 40, // distributed across the 8 sessions (5 per)
  spansPerCodex: 2000, // 80,000 codex spans
  legacyCodexSpans: 15200, // ~15k legacy / un-stamped — pads to ~100k total
};

const BASE_SEC = Date.UTC(2026, 0, 1, 0, 0, 0); // 2026-01-01T00:00:00Z

function nsTimestamp(epochMs: number): string {
  // Format as ClickHouse-style nanosecond ISO string. Microsecond precision
  // suffices for ordering; the trailing nanos are zeros.
  const iso = new Date(epochMs).toISOString(); // YYYY-MM-DDTHH:MM:SS.mmmZ
  // Convert ".000Z" → ".000000000" (drop Z, pad to 9 fractional digits).
  return iso.slice(0, -1).padEnd(29, "0");
}

function bareSpan(input: {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  timestamp: string;
  serviceName: string;
  sessionId?: string;
  agentSessionId?: string;
  resourceAttributesRaw?: Record<string, string>;
  spanAttributesRaw?: Record<string, string>;
}): SpanRow {
  return {
    TraceId: input.traceId,
    SpanId: input.spanId,
    ParentSpanId: input.parentSpanId ?? "",
    SpanName: "synthetic",
    Timestamp: input.timestamp,
    ServiceName: input.serviceName,
    StatusCode: "OK",
    Duration: 1_000_000, // 1ms — irrelevant to grouping/reconcile, present for completeness
    AgentProject: "project",
    AgentSessionId: input.agentSessionId ?? "",
    AgentRunId: "",
    SessionId: input.sessionId ?? "",
    ProjectName: "project",
    ResourceAttributesRaw: input.resourceAttributesRaw ?? {},
    SpanAttributesRaw: input.spanAttributesRaw ?? {},
    depth: 0,
  };
}

/**
 * Build a ~100k-span synthetic forest. Returns the row stream + the
 * already-grouped forest (so tests can pull both raw rows for re-grouping
 * benchmarks and the assembled forest for reconcile benchmarks).
 */
export function buildSyntheticForest(
  shape: ForestShape = DEFAULT_SHAPE,
): {
  rows: SpanRow[];
  forest: SessionNode[];
  totalSpans: number;
  // Convenience handles used by the perf test to pick a "valid" selection
  // without re-walking the forest.
  sampleSessionId: string;
  sampleTraceId: string;
  sampleSpanId: string;
} {
  const rows: SpanRow[] = [];
  let tsCursor = BASE_SEC;
  const nextTs = (): string => {
    // 1ms increments — guaranteed ordering, fits 9-digit fractional ISO.
    tsCursor += 1;
    return nsTimestamp(tsCursor);
  };

  let sampleSessionId = "";
  let sampleTraceId = "";
  let sampleSpanId = "";

  const codexPerSession = Math.max(
    1,
    Math.floor(shape.codexNodesTotal / Math.max(1, shape.claudeSessions)),
  );

  for (let si = 0; si < shape.claudeSessions; si++) {
    const sessionId = `claude-sess-${si}`;
    const claudeTrace = `claude-trace-${si}`;
    const rootSpanId = `claude-root-${si}`;
    // Root claude span.
    rows.push(
      bareSpan({
        traceId: claudeTrace,
        spanId: rootSpanId,
        timestamp: nextTs(),
        serviceName: "claude-code",
        sessionId,
      }),
    );
    // Claude root work spans (no agent_id → owned by claude root).
    for (let k = 1; k < shape.spansPerClaudeSession; k++) {
      rows.push(
        bareSpan({
          traceId: claudeTrace,
          spanId: `claude-work-${si}-${k}`,
          parentSpanId: rootSpanId,
          timestamp: nextTs(),
          serviceName: "claude-code",
          sessionId,
        }),
      );
    }
    // Subagents.
    for (let bi = 0; bi < shape.subagentsPerSession; bi++) {
      const agentId = `agent-${si}-${bi}`;
      const dispatchSpanId = `dispatch-${si}-${bi}`;
      // Dispatch span carries subagent_type.
      rows.push(
        bareSpan({
          traceId: claudeTrace,
          spanId: dispatchSpanId,
          parentSpanId: rootSpanId,
          timestamp: nextTs(),
          serviceName: "claude-code",
          sessionId,
          spanAttributesRaw: { subagent_type: `synth-subagent-${bi}` },
        }),
      );
      // First descendant work span establishes the subagent's agent_id.
      const firstSubSpanId = `sub-first-${si}-${bi}`;
      rows.push(
        bareSpan({
          traceId: claudeTrace,
          spanId: firstSubSpanId,
          parentSpanId: dispatchSpanId,
          timestamp: nextTs(),
          serviceName: "claude-code",
          sessionId,
          spanAttributesRaw: { agent_id: agentId },
        }),
      );
      for (let k = 1; k < shape.spansPerSubagent; k++) {
        rows.push(
          bareSpan({
            traceId: claudeTrace,
            spanId: `sub-${si}-${bi}-${k}`,
            parentSpanId: firstSubSpanId,
            timestamp: nextTs(),
            serviceName: "claude-code",
            sessionId,
            spanAttributesRaw: { agent_id: agentId },
          }),
        );
      }
    }
    // Codex children for this session — stamped with parent.session.id.
    for (let ci = 0; ci < codexPerSession; ci++) {
      const codexSessionId = `codex-sess-${si}-${ci}`;
      const codexTrace = claudeTrace; // inherit via TRACEPARENT propagation in real data
      const codexRootSpanId = `codex-root-${si}-${ci}`;
      const stamp: Record<string, string> = {
        "agent.session.id": codexSessionId,
        "agent.parent.session.id": sessionId,
        "agent.parent.span.id": rootSpanId,
      };
      rows.push(
        bareSpan({
          traceId: codexTrace,
          spanId: codexRootSpanId,
          parentSpanId: rootSpanId,
          timestamp: nextTs(),
          serviceName: "codex_exec",
          agentSessionId: codexSessionId,
          resourceAttributesRaw: stamp,
        }),
      );
      for (let k = 1; k < shape.spansPerCodex; k++) {
        rows.push(
          bareSpan({
            traceId: codexTrace,
            spanId: `codex-${si}-${ci}-${k}`,
            parentSpanId: codexRootSpanId,
            timestamp: nextTs(),
            serviceName: "codex_exec",
            agentSessionId: codexSessionId,
            resourceAttributesRaw: stamp,
          }),
        );
      }
      if (sampleSessionId === "" && si === 0 && ci === 0) {
        sampleSessionId = `codex::${codexSessionId}`;
        sampleTraceId = codexTrace;
        // The first codex span owns the trace; spanRowId = TraceId+SpanId.
        sampleSpanId = `${codexTrace}${codexRootSpanId}`;
      }
    }
  }

  // Legacy / un-stamped codex spans → padding to reach ~100k.
  for (let li = 0; li < shape.legacyCodexSpans; li++) {
    const tr = `legacy-trace-${li}`;
    rows.push(
      bareSpan({
        traceId: tr,
        spanId: `legacy-${li}`,
        timestamp: nextTs(),
        serviceName: "codex_exec",
        // No agent.session.id stamp → falls through to legacy bucketing.
      }),
    );
  }

  const forest = groupSpansToTree(rows);
  // Fallback sample if codexPerSession was 0: pick the first claude root.
  if (sampleSessionId === "" && forest[0]) {
    sampleSessionId = forest[0].id;
    sampleTraceId = forest[0].traces[0]?.id ?? "";
    sampleSpanId = forest[0].traces[0]?.spans[0]
      ? forest[0].traces[0].spans[0].TraceId +
        forest[0].traces[0].spans[0].SpanId
      : "";
  }

  return {
    rows,
    forest,
    totalSpans: rows.length,
    sampleSessionId,
    sampleTraceId,
    sampleSpanId,
  };
}
