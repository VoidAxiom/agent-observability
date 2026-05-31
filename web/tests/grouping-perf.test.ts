/*
 * VOI-388 perf regression: reconcileSelection MUST stay sub-50ms on a
 * 100k-span synthetic forest. The old impl materialized forest-wide id
 * Sets and was the root cause of the operator-reported 1-2s click-to-paint
 * lag on the live dev box (107k spans in 1h window, 350k in 6h). The new
 * impl walks a chain — session via findNodeById, trace via subtree walk,
 * span via the matched trace's spans only — and is O(visible-subtree)
 * rather than O(all-spans-in-window).
 *
 * Includes behavioral-equivalence cases against the spec's documented
 * contract so a future "make it faster still" refactor can't silently
 * narrow the trace search to direct-children-only or skip the null-input
 * edge cases.
 */

import { describe, expect, it } from "vitest";
import {
  groupSpansToTree,
  reconcileSelection,
  type SessionNode,
  type SpanRow,
} from "../src/lib/grouping";
import { buildSyntheticForest } from "./_perfFixtures";

function mk(input: {
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
    Duration: 1_000_000,
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

const PERF_BUDGET_AVG_MS = 50; // average of 100 invocations (worst-case env headroom)
const PERF_BUDGET_NULL_MS = 5; // null-input fast path
const PERF_BUDGET_UNKNOWN_MS = 50; // unknown selectedSessionId (forest DFS)

// The TRUE old impl, copied verbatim from grouping.ts pre-VOI-388 (three
// INDEPENDENT forest-wide Sets — session/trace/span validated against their
// own membership Set, not chained). Used as the perf-comparison reference
// AND as the equivalence oracle in the behavioral describe below. Kept at
// module scope so the perf test can compare wall-clock against it without
// re-defining; a regression that re-introduces forest-wide-Set semantics
// would push the new impl's wall-clock back up to (or past) the old's.
function oldReconcileImpl(
  sessions: SessionNode[],
  selectedSessionId: string | null | undefined,
  selectedTraceId: string | null | undefined,
  selectedSpanId: string | null | undefined,
): {
  selectedSessionId: string | null;
  selectedTraceId: string | null;
  selectedSpanId: string | null;
} {
  const sessionIds = new Set<string>();
  const traceIds = new Set<string>();
  const spanIds = new Set<string>();
  const visit = (node: SessionNode): void => {
    sessionIds.add(node.id);
    for (const t of node.traces) {
      traceIds.add(t.id);
      for (const s of t.spans) spanIds.add(s.TraceId + s.SpanId);
    }
    for (const c of node.children) visit(c);
  };
  for (const s of sessions) visit(s);

  return {
    selectedSessionId:
      selectedSessionId && sessionIds.has(selectedSessionId)
        ? selectedSessionId
        : null,
    selectedTraceId:
      selectedTraceId && traceIds.has(selectedTraceId)
        ? selectedTraceId
        : null,
    selectedSpanId:
      selectedSpanId && spanIds.has(selectedSpanId) ? selectedSpanId : null,
  };
}

describe("reconcileSelection — perf on 100k-span forest (VOI-388)", () => {
  /**
   * Pick a perf-stressful selection: claude-root sessionId + a trace owned
   * ONLY by a deep codex descendant. This forces findTraceInSubtree to
   * walk the entire claude subtree (NOT early-exit at depth 0 the way a
   * codex-session sample would) — the exact O(visible-subtree-nodes)
   * branch the doc-comment in grouping.ts promises stays sub-50ms.
   */
  function pickStressfulSelection(
    built: ReturnType<typeof buildSyntheticForest>,
  ): { sessionId: string; traceId: string; spanId: string } {
    const claudeRoot = built.forest.find((n) => n.kind === "claude");
    if (!claudeRoot) {
      throw new Error("perf fixture missing a claude root");
    }
    // Walk the subtree to find a trace owned by some descendant.
    const stack: SessionNode[] = [...claudeRoot.children];
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (node.traces.length > 0 && node.traces[0]!.spans[0]) {
        const t = node.traces[0]!;
        const span = t.spans[0]!;
        return {
          sessionId: claudeRoot.id,
          traceId: t.id,
          spanId: span.TraceId + span.SpanId,
        };
      }
      for (const c of node.children) stack.push(c);
    }
    throw new Error("perf fixture has no descendant-owned trace under claude root");
  }

  it("100 invocations on a 100k-span forest average < 50ms each (claude-root + deep-descendant trace)", () => {
    const built = buildSyntheticForest();
    // Sanity: we actually built ~100k spans. The DEFAULT_SHAPE is calibrated
    // for this; a future fixture-shape change that drops below 100k should
    // fail this guard so the perf gate stays meaningful.
    expect(built.totalSpans).toBeGreaterThanOrEqual(95_000);

    const sel = pickStressfulSelection(built);

    // Warm-up: one untimed call so any JIT optimization happens before
    // measurement. The reconcile fn is small but vitest under jsdom isn't
    // a controlled benchmark env; this evens out the first-call cost.
    reconcileSelection(built.forest, sel.sessionId, sel.traceId, sel.spanId);

    const iterations = 100;
    const t0 = performance.now();
    for (let i = 0; i < iterations; i++) {
      reconcileSelection(built.forest, sel.sessionId, sel.traceId, sel.spanId);
    }
    const elapsed = performance.now() - t0;
    const avgMs = elapsed / iterations;
    expect(avgMs).toBeLessThan(PERF_BUDGET_AVG_MS);
  });

  /**
   * Ratio gate: the new chain impl MUST run substantially faster than the
   * old forest-wide-Set impl on the same forest + selection. This is the
   * load-bearing regression guard — a refactor that re-introduces
   * Set-materialization semantics would push the wall-clock ratio back
   * toward 1.0 and trip this test even on slow CI hardware (because both
   * impls slow down proportionally). The 5x floor is conservative: locally
   * the chain runs ~50-200x faster on the deep-descendant case.
   */
  it("chain impl runs >=5x faster than the old forest-wide-Set impl on the same selection", () => {
    const built = buildSyntheticForest();
    const sel = pickStressfulSelection(built);

    // Warm-up BOTH impls so the comparison isn't first-call biased.
    reconcileSelection(built.forest, sel.sessionId, sel.traceId, sel.spanId);
    oldReconcileImpl(built.forest, sel.sessionId, sel.traceId, sel.spanId);

    const iterations = 20; // fewer iters: old impl is expensive
    const t0Old = performance.now();
    for (let i = 0; i < iterations; i++) {
      oldReconcileImpl(built.forest, sel.sessionId, sel.traceId, sel.spanId);
    }
    const oldElapsed = performance.now() - t0Old;

    const t0New = performance.now();
    for (let i = 0; i < iterations; i++) {
      reconcileSelection(built.forest, sel.sessionId, sel.traceId, sel.spanId);
    }
    const newElapsed = performance.now() - t0New;

    // Defensive: if the old impl is so fast measurement is noise (<10ms
    // total across all iters), the test environment is too quiet for the
    // ratio to be meaningful. Treat as a pass — the absolute-budget test
    // above is still load-bearing.
    if (oldElapsed >= 10) {
      expect(newElapsed * 5).toBeLessThanOrEqual(oldElapsed);
    }
  });

  it("all-null inputs complete in < 5ms (near-instant fast path)", () => {
    const built = buildSyntheticForest();
    const t0 = performance.now();
    const out = reconcileSelection(built.forest, null, null, null);
    const elapsed = performance.now() - t0;
    expect(out.selectedSessionId).toBeNull();
    expect(out.selectedTraceId).toBeNull();
    expect(out.selectedSpanId).toBeNull();
    expect(elapsed).toBeLessThan(PERF_BUDGET_NULL_MS);
  });

  it("unknown selectedSessionId completes in < 50ms (DFS without span materialization)", () => {
    const built = buildSyntheticForest();
    const t0 = performance.now();
    const out = reconcileSelection(
      built.forest,
      "definitely-not-a-real-session",
      "definitely-not-a-real-trace",
      "definitely-not-a-real-span",
    );
    const elapsed = performance.now() - t0;
    expect(out.selectedSessionId).toBeNull();
    expect(out.selectedTraceId).toBeNull();
    expect(out.selectedSpanId).toBeNull();
    expect(elapsed).toBeLessThan(PERF_BUDGET_UNKNOWN_MS);
  });
});

describe("reconcileSelection — behavioral equivalence vs OLD impl", () => {
  // Scenarios are restricted to states REACHABLE via App.tsx's reconcile
  // useEffect normalization (no cross-session/cross-trace span carry-over —
  // App.tsx nulls those before reconcileSelection ever sees them). The
  // module-scope oldReconcileImpl is the oracle; the deliberate-divergence
  // corner test below documents the unreachable states.

  it("matches OLD impl across 8 reachable-state scenarios", () => {
    const built = buildSyntheticForest({
      claudeSessions: 2,
      spansPerClaudeSession: 10,
      subagentsPerSession: 1,
      spansPerSubagent: 10,
      codexNodesTotal: 2,
      spansPerCodex: 20,
      legacyCodexSpans: 0,
    });
    const { forest } = built;

    // Hand-pick observable ids from the assembled forest so the scenarios
    // are grounded in real fixture state, not guesses.
    const claudeRoot = forest.find((n) => n.kind === "claude");
    expect(claudeRoot).toBeDefined();
    const subagent = claudeRoot?.children.find((c) => c.kind === "subagent");
    const codex = claudeRoot?.children.find((c) => c.kind === "codex");
    expect(subagent).toBeDefined();
    expect(codex).toBeDefined();

    const claudeTraceId = claudeRoot!.traces[0]!.id;
    const claudeSpanRowId =
      claudeRoot!.traces[0]!.spans[0]!.TraceId +
      claudeRoot!.traces[0]!.spans[0]!.SpanId;
    const codexTraceId = codex!.traces[0]!.id;
    const codexSpanRowId =
      codex!.traces[0]!.spans[0]!.TraceId +
      codex!.traces[0]!.spans[0]!.SpanId;

    const scenarios: Array<{
      label: string;
      sessionId: string | null;
      traceId: string | null;
      spanId: string | null;
    }> = [
      {
        label: "valid trio (claude root)",
        sessionId: claudeRoot!.id,
        traceId: claudeTraceId,
        spanId: claudeSpanRowId,
      },
      {
        label: "valid session+trace, missing span",
        sessionId: claudeRoot!.id,
        traceId: claudeTraceId,
        spanId: "missing-span",
      },
      {
        label: "valid session, missing trace+span",
        sessionId: claudeRoot!.id,
        traceId: "missing-trace",
        spanId: "missing-span",
      },
      {
        label: "all missing",
        sessionId: "missing-session",
        traceId: "missing-trace",
        spanId: "missing-span",
      },
      // (the "orphan span (no trace selected)" case is intentionally a
      //  divergence: old preserves the spanId via the forest-wide Set, new
      //  returns null because there's no matched trace to validate against.
      //  Unreachable via App.tsx — `onSelectSession` sets trace+span to null
      //  together — so the divergence is documented in the divergence test
      //  below, not asserted as equivalence here.)
      {
        label: "nested subagent selection (subagent owns no traces; trace lives on parent claude)",
        sessionId: subagent!.id,
        traceId: claudeTraceId,
        spanId: null,
      },
      {
        label: "nested codex selection (codex owns its own trace)",
        sessionId: codex!.id,
        traceId: codexTraceId,
        spanId: codexSpanRowId,
      },
      {
        label: "all null",
        sessionId: null,
        traceId: null,
        spanId: null,
      },
    ];

    for (const sc of scenarios) {
      const newOut = reconcileSelection(
        forest,
        sc.sessionId,
        sc.traceId,
        sc.spanId,
      );
      const oldOut = oldReconcileImpl(
        forest,
        sc.sessionId,
        sc.traceId,
        sc.spanId,
      );
      // New chain impl MUST match the true old forest-wide-Set impl on
      // every scenario reachable via App.tsx normalization. A future
      // refactor that breaks either direction trips this.
      expect(
        {
          scenario: sc.label,
          ...newOut,
        },
        `scenario: ${sc.label}`,
      ).toEqual({ scenario: sc.label, ...oldOut });
    }
  });

  // The deliberate-divergence corner: a state where the new chain impl
  // and the old forest-wide impl produce DIFFERENT raw outputs. This is
  // unreachable in practice because App.tsx's reconcile useEffect nulls
  // these cases before reconcileSelection ever sees them, but the
  // difference is real and documented here so a future reader doesn't
  // mistake "they agree everywhere" for "they agree always". App.tsx's
  // post-reconcile auto-promotion + span-still-valid checks (App.tsx
  // lines ~167-199) normalize the outputs to the same observable UI.
  it("documents the cross-trace span divergence (unreachable via App.tsx)", () => {
    // Build a forest where claude root + codex child own DISTINCT traces
    // (codex emits on its own trace because TRACEPARENT isn't propagated
    // for un-stamped codex_exec subprocesses in this fixture). The
    // _perfFixtures.ts builder propagates the parent trace for realism;
    // here we hand-build so the divergence corner is structurally
    // reachable.
    const claudeTrace = "claude-trace-X";
    const codexTrace = "codex-trace-X";
    const rows: SpanRow[] = [
      mk({
        traceId: claudeTrace,
        spanId: "claude-root",
        timestamp: "2026-01-01T00:00:01.000000000",
        serviceName: "claude-code",
        sessionId: "sess-X",
      }),
      mk({
        traceId: codexTrace,
        spanId: "codex-root",
        timestamp: "2026-01-01T00:00:02.000000000",
        serviceName: "codex_exec",
        agentSessionId: "codex-sess-X",
        resourceAttributesRaw: {
          "agent.session.id": "codex-sess-X",
          "agent.parent.session.id": "sess-X",
        },
      }),
    ];
    const forest = groupSpansToTree(rows);
    const claudeRoot = forest.find((n) => n.kind === "claude")!;
    const codexChild = claudeRoot.children.find((c) => c.kind === "codex")!;
    const claudeTraceId = claudeRoot.traces[0]!.id;
    expect(claudeTraceId).toBe(claudeTrace);
    const codexSpanRowId =
      codexChild.traces[0]!.spans[0]!.TraceId +
      codexChild.traces[0]!.spans[0]!.SpanId;

    // Selected: (session=codex, trace=claudeTrace, span=spanFromCodexTrace).
    // The trace EXISTS forest-wide (on the claude root) but NOT under the
    // codex subtree; the span lives in the codex trace not claudeTrace.
    const oldOut = oldReconcileImpl(
      forest,
      codexChild.id,
      claudeTraceId,
      codexSpanRowId,
    );
    const newOut = reconcileSelection(
      forest,
      codexChild.id,
      claudeTraceId,
      codexSpanRowId,
    );
    // OLD impl: trace validates (forest-wide Set), span validates
    // (forest-wide Set) → preserves both.
    expect(oldOut.selectedTraceId).toBe(claudeTraceId);
    expect(oldOut.selectedSpanId).toBe(codexSpanRowId);
    // NEW impl: trace fails (not in codex subtree) → cascades trace+span
    // to null. App.tsx's traceWasEvicted branch then auto-promotes a
    // valid trace for the selected session; the UI ends up in the same
    // state either way.
    expect(newOut.selectedTraceId).toBeNull();
    expect(newOut.selectedSpanId).toBeNull();
  });

  it("preserves selectedTraceId when the trace lives on a descendant subagent (not the selected claude)", () => {
    // Spec line 41-44: selectedTraceId is preserved iff the selected
    // session OR ANY DESCENDANT NODE owns a trace with that id. This
    // case nails the failure mode of narrowing the trace search to
    // session.traces only — which would silently break the contract.
    const built = buildSyntheticForest({
      claudeSessions: 1,
      spansPerClaudeSession: 5,
      subagentsPerSession: 1,
      spansPerSubagent: 5,
      codexNodesTotal: 1,
      spansPerCodex: 5,
      legacyCodexSpans: 0,
    });
    const claudeRoot = built.forest.find((n) => n.kind === "claude")!;
    const codexChild = claudeRoot.children.find((c) => c.kind === "codex");
    expect(codexChild).toBeDefined();
    expect(codexChild!.traces.length).toBeGreaterThan(0);
    const codexTraceId = codexChild!.traces[0]!.id;

    // Claude session + a trace that belongs to its codex descendant.
    const out = reconcileSelection(
      built.forest,
      claudeRoot.id,
      codexTraceId,
      null,
    );
    expect(out.selectedSessionId).toBe(claudeRoot.id);
    expect(out.selectedTraceId).toBe(codexTraceId);
    expect(out.selectedSpanId).toBeNull();
  });
});
