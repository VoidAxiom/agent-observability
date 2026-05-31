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
import { reconcileSelection } from "../src/lib/grouping";
import { buildSyntheticForest } from "./_perfFixtures";

const PERF_BUDGET_AVG_MS = 50; // average of 100 invocations
const PERF_BUDGET_NULL_MS = 5; // null-input fast path
const PERF_BUDGET_UNKNOWN_MS = 50; // unknown selectedSessionId (forest DFS)

describe("reconcileSelection — perf on 100k-span forest (VOI-388)", () => {
  it("100 invocations on a 100k-span forest average < 50ms each", () => {
    const built = buildSyntheticForest();
    // Sanity: we actually built ~100k spans. The DEFAULT_SHAPE is calibrated
    // for this; a future fixture-shape change that drops below 100k should
    // fail this guard so the perf gate stays meaningful.
    expect(built.totalSpans).toBeGreaterThanOrEqual(95_000);

    // Warm-up: one untimed call so any JIT optimization happens before
    // measurement. The reconcile fn is small but vitest under jsdom isn't
    // a controlled benchmark env; this evens out the first-call cost.
    reconcileSelection(
      built.forest,
      built.sampleSessionId,
      built.sampleTraceId,
      built.sampleSpanId,
    );

    const iterations = 100;
    const t0 = performance.now();
    for (let i = 0; i < iterations; i++) {
      reconcileSelection(
        built.forest,
        built.sampleSessionId,
        built.sampleTraceId,
        built.sampleSpanId,
      );
    }
    const elapsed = performance.now() - t0;
    const avgMs = elapsed / iterations;
    expect(avgMs).toBeLessThan(PERF_BUDGET_AVG_MS);
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

describe("reconcileSelection — behavioral equivalence vs spec contract", () => {
  // A "synthetic old" Set-materialization reference impl, restricted to
  // the spec's documented behavior contract: a trace id validates iff
  // ANY descendant node in the forest owns a trace with that id; a span
  // id validates iff it lives in the MATCHED trace's spans (per the spec
  // line 95 prescription). This is the contract codified in the new impl;
  // the test confirms identical outputs across the canonical scenarios.
  function referenceImpl(
    sessions: ReturnType<typeof buildSyntheticForest>["forest"],
    selectedSessionId: string | null | undefined,
    selectedTraceId: string | null | undefined,
    selectedSpanId: string | null | undefined,
  ): {
    selectedSessionId: string | null;
    selectedTraceId: string | null;
    selectedSpanId: string | null;
  } {
    const sessionIds = new Set<string>();
    const traceToSpans = new Map<string, Set<string>>();
    const visit = (node: (typeof sessions)[number]): void => {
      sessionIds.add(node.id);
      for (const t of node.traces) {
        let bucket = traceToSpans.get(t.id);
        if (!bucket) {
          bucket = new Set<string>();
          traceToSpans.set(t.id, bucket);
        }
        for (const s of t.spans) bucket.add(s.TraceId + s.SpanId);
      }
      for (const c of node.children) visit(c);
    };
    for (const s of sessions) visit(s);

    const okSession =
      selectedSessionId && sessionIds.has(selectedSessionId)
        ? selectedSessionId
        : null;
    const okTrace =
      okSession && selectedTraceId && traceToSpans.has(selectedTraceId)
        ? selectedTraceId
        : null;
    const okSpan =
      okTrace && selectedSpanId
        ? traceToSpans.get(okTrace)?.has(selectedSpanId)
          ? selectedSpanId
          : null
        : null;
    return {
      selectedSessionId: okSession,
      selectedTraceId: okTrace,
      selectedSpanId: okSpan,
    };
  }

  it("matches reference impl across 8 selection scenarios", () => {
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
      {
        label: "orphan span (no trace selected)",
        sessionId: claudeRoot!.id,
        traceId: null,
        spanId: claudeSpanRowId,
      },
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
      const refOut = referenceImpl(
        forest,
        sc.sessionId,
        sc.traceId,
        sc.spanId,
      );
      // Both impls must agree per scenario.
      expect(
        {
          scenario: sc.label,
          ...newOut,
        },
        `scenario: ${sc.label}`,
      ).toEqual({ scenario: sc.label, ...refOut });
    }
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
