/*
 * usePolledSpans.test.tsx — exercises the polling hook directly.
 *
 * Asserts the in-flight generation guard: when a slow first fetch is
 * overtaken by the next interval's faster fetch, the stale first
 * response must NOT clobber the newer state.
 */

import { describe, expect, it, vi } from "vitest";
import { act, render, cleanup } from "@testing-library/react";
import { useEffect } from "react";
import { usePolledSpans } from "../src/lib/usePolledSpans";
import type { FetchResult } from "../src/lib/clickhouse";
import type { SpanRow } from "../src/lib/grouping";

// Small helper so legacy tests that conceptually deal in "rows" can stay
// readable while matching the FetchResult shape the hook now requires.
// Tests that need to assert truncated semantics construct the literal
// directly instead of going through here.
function ok(rows: SpanRow[]): FetchResult {
  return { rows, truncated: false, rawRowCount: rows.length };
}

function row(spanId: string, sessionId: string): SpanRow {
  return {
    TraceId: `trace-${spanId}`,
    SpanId: spanId,
    ParentSpanId: "",
    SpanName: "claude_code.tool",
    Timestamp: "2026-01-01T00:00:00.000000000",
    ServiceName: "claude-code",
    StatusCode: "",
    Duration: 1_000_000,
    AgentProject: "p",
    AgentSessionId: "as",
    AgentRunId: "r",
    SessionId: sessionId,
    ProjectName: "p",
    ResourceAttributesRaw: {},
    SpanAttributesRaw: {},
    depth: 0,
  };
}

interface ProbeProps {
  intervalMs: number;
  fetchImpl: () => Promise<FetchResult>;
  onState: (state: ReturnType<typeof usePolledSpans>) => void;
}

function Probe({ intervalMs, fetchImpl, onState }: ProbeProps) {
  const state = usePolledSpans({ intervalMs, fetchImpl });
  useEffect(() => {
    onState(state);
  }, [state, onState]);
  return null;
}

describe("usePolledSpans", () => {
  it("starts in loading state with empty sessions", async () => {
    let last: ReturnType<typeof usePolledSpans> | null = null;
    const fetchImpl = vi.fn(async () => ok([]));
    render(
      <Probe
        intervalMs={5000}
        fetchImpl={fetchImpl}
        onState={(s) => {
          last = s;
        }}
      />,
    );
    expect(last).not.toBeNull();
    expect((last as unknown as ReturnType<typeof usePolledSpans>).loading).toBe(
      true,
    );
    cleanup();
  });

  it("stale slow first fetch does NOT overwrite a newer second fetch result", async () => {
    vi.useFakeTimers();
    try {
      let slowResolver: ((result: FetchResult) => void) | null = null;
      let callIdx = 0;

      const fetchImpl = vi.fn(async () => {
        callIdx += 1;
        if (callIdx === 1) {
          // First call: never auto-resolves; we'll resolve it manually
          // AFTER the second call lands.
          return new Promise<FetchResult>((resolve) => {
            slowResolver = resolve;
          });
        }
        // Second call: resolves immediately on the microtask queue.
        return ok([row("fresh", "fresh-session")]);
      });

      let last: ReturnType<typeof usePolledSpans> | null = null;
      const updates: ReturnType<typeof usePolledSpans>[] = [];

      render(
        <Probe
          intervalMs={100}
          fetchImpl={fetchImpl}
          onState={(s) => {
            last = s;
            updates.push(s);
          }}
        />,
      );

      // Advance one interval so the SECOND fetch fires.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(150);
      });

      // The second fetch should have completed and put sessions into state.
      expect(callIdx).toBeGreaterThanOrEqual(2);
      const afterFresh = last as unknown as ReturnType<typeof usePolledSpans>;
      expect(afterFresh.sessions.length).toBe(1);
      expect(afterFresh.sessions[0]!.sessionKey).toBe("fresh-session");

      // Now manually resolve the SLOW first fetch with a different, older
      // snapshot. The generation guard must drop it.
      await act(async () => {
        slowResolver!(ok([row("stale", "stale-session")]));
        await vi.advanceTimersByTimeAsync(0);
      });

      const final = last as unknown as ReturnType<typeof usePolledSpans>;
      expect(final.sessions.length).toBe(1);
      expect(final.sessions[0]!.sessionKey).toBe("fresh-session");
    } finally {
      vi.useRealTimers();
      cleanup();
    }
  });

  it("does NOT starve when every poll is slower than intervalMs", async () => {
    // Regression: codex PR#16 P1. When CH latency consistently exceeds
    // intervalMs, the old generation guard ("am I the latest started?")
    // discarded EVERY response because a newer generation had already
    // started by resolve-time. The fixed guard ("is a strictly later
    // generation already committed?") lets the first slow poll commit
    // when its successor is still in flight.
    vi.useFakeTimers();
    try {
      const resolvers: Array<(result: FetchResult) => void> = [];
      const fetchImpl = vi.fn(
        () =>
          new Promise<FetchResult>((resolve) => {
            resolvers.push(resolve);
          }),
      );

      let last: ReturnType<typeof usePolledSpans> | null = null;
      render(
        <Probe
          intervalMs={50}
          fetchImpl={fetchImpl}
          onState={(s) => {
            last = s;
          }}
        />,
      );

      // Let the first fetch start, then advance past the interval so a
      // SECOND fetch is also fired and now in-flight alongside the first.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60);
      });
      expect(resolvers.length).toBeGreaterThanOrEqual(2);

      // Resolve the FIRST (slow) fetch. Under the old guard this would
      // have been dropped (gen=1 !== generationRef=2). Under the fixed
      // guard it commits (gen=1 > lastCommittedGen=0).
      await act(async () => {
        resolvers[0]!(ok([row("first-slow", "session-a")]));
        await vi.advanceTimersByTimeAsync(0);
      });
      const afterFirst = last as unknown as ReturnType<typeof usePolledSpans>;
      expect(afterFirst.sessions.length).toBe(1);
      expect(afterFirst.sessions[0]!.sessionKey).toBe("session-a");
      expect(afterFirst.loading).toBe(false);

      // The second fetch (gen=2) is still in flight; resolving it should
      // also commit since gen=2 > lastCommittedGen=1.
      await act(async () => {
        resolvers[1]!(ok([row("second-slow", "session-b")]));
        await vi.advanceTimersByTimeAsync(0);
      });
      const afterSecond = last as unknown as ReturnType<typeof usePolledSpans>;
      expect(afterSecond.sessions.length).toBe(1);
      expect(afterSecond.sessions[0]!.sessionKey).toBe("session-b");
    } finally {
      vi.useRealTimers();
      cleanup();
    }
  });

  it("in-flight fetch from a prior effect epoch does NOT leak into the new epoch", async () => {
    // Regression: /code-review round-3 finding. When the effect re-runs
    // (e.g. intervalMs changes), the prior effect's still-in-flight fetch
    // must NOT commit into the new epoch — the cancelled-closure scopes
    // the guard to the effect run it was started in.
    vi.useFakeTimers();
    try {
      const oldEpochResolvers: Array<(result: FetchResult) => void> = [];
      const newEpochResolvers: Array<(result: FetchResult) => void> = [];
      let intervalMs = 100;
      let isOldEpoch = true;

      const fetchImpl = vi.fn(
        () =>
          new Promise<FetchResult>((resolve) => {
            if (isOldEpoch) {
              oldEpochResolvers.push(resolve);
            } else {
              newEpochResolvers.push(resolve);
            }
          }),
      );

      let last: ReturnType<typeof usePolledSpans> | null = null;
      function Wrapper() {
        const state = usePolledSpans({ intervalMs, fetchImpl });
        useEffect(() => {
          last = state;
        }, [state]);
        return null;
      }

      const { rerender } = render(<Wrapper />);

      // Old-epoch fetch in flight (not yet resolved).
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(oldEpochResolvers.length).toBe(1);

      // Switch epochs: bump intervalMs to force the effect to re-run.
      isOldEpoch = false;
      intervalMs = 200;
      rerender(<Wrapper />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(newEpochResolvers.length).toBe(1);

      // Resolve the OLD-epoch fetch with a stale-epoch payload. It must
      // NOT commit (cancelled-closure dropped it).
      await act(async () => {
        oldEpochResolvers[0]!(ok([row("stale-epoch", "stale-epoch-session")]));
        await vi.advanceTimersByTimeAsync(0);
      });
      const afterStale = last as unknown as ReturnType<typeof usePolledSpans>;
      // Still loading: no commit landed from the stale epoch.
      expect(afterStale.sessions.length).toBe(0);
      expect(afterStale.loading).toBe(true);

      // Resolve the NEW-epoch fetch — it commits cleanly.
      await act(async () => {
        newEpochResolvers[0]!(ok([row("fresh-epoch", "fresh-epoch-session")]));
        await vi.advanceTimersByTimeAsync(0);
      });
      const afterFresh = last as unknown as ReturnType<typeof usePolledSpans>;
      expect(afterFresh.sessions.length).toBe(1);
      expect(afterFresh.sessions[0]!.sessionKey).toBe("fresh-epoch-session");
      expect(afterFresh.loading).toBe(false);
    } finally {
      vi.useRealTimers();
      cleanup();
    }
  });

  it("propagates the truncated flag from FetchResult into state (VOI-382)", async () => {
    // The fetchOnce contract returns { rows, truncated }; the hook must
    // surface truncated on PolledSpansState so SessionSidebar can render
    // its chip. Regression: an earlier version dropped the flag because
    // groupSpans only takes rows, so truncated lived only on the local
    // closure and never reached state.
    vi.useFakeTimers();
    try {
      // Suppress the once-per-transition warn so the test output stays clean.
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      let callIdx = 0;
      const fetchImpl = vi.fn(async () => {
        callIdx += 1;
        if (callIdx === 1) {
          // rawRowCount > ceiling per the probe-row pattern (fetchOnce
          // queries ceiling+1 rows; truncated=true iff CH returned > ceiling).
          return {
            rows: [row("a", "session-a")],
            truncated: true,
            rawRowCount: 50_001,
          };
        }
        return {
          rows: [row("b", "session-b")],
          truncated: false,
          rawRowCount: 1,
        };
      });

      let last: ReturnType<typeof usePolledSpans> | null = null;
      render(
        <Probe
          intervalMs={50}
          fetchImpl={fetchImpl}
          onState={(s) => {
            last = s;
          }}
        />,
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10);
      });
      const afterFirst = last as unknown as ReturnType<typeof usePolledSpans>;
      expect(afterFirst.truncated).toBe(true);
      // The false→true transition fires console.warn exactly once.
      expect(warnSpy).toHaveBeenCalledTimes(1);
      // Warn cites the RAW row count (the count truncated was decided
      // from), not rows.length. Codex P2 round-3 2026-05-30.
      const warnText = warnSpy.mock.calls[0]?.[0] as string;
      expect(warnText).toContain("50001 raw rows");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(60);
      });
      const afterSecond = last as unknown as ReturnType<typeof usePolledSpans>;
      expect(afterSecond.truncated).toBe(false);
      // No new warn on the true→false transition (only false→true warns).
      expect(warnSpy).toHaveBeenCalledTimes(1);

      warnSpy.mockRestore();
    } finally {
      vi.useRealTimers();
      cleanup();
    }
  });

  it("error during fetch keeps last-good sessions and surfaces message", async () => {
    vi.useFakeTimers();
    try {
      let callIdx = 0;
      const fetchImpl = vi.fn(async () => {
        callIdx += 1;
        if (callIdx === 1) {
          return ok([row("good", "good-session")]);
        }
        throw new Error("CH down");
      });

      let last: ReturnType<typeof usePolledSpans> | null = null;
      render(
        <Probe
          intervalMs={50}
          fetchImpl={fetchImpl}
          onState={(s) => {
            last = s;
          }}
        />,
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10);
      });
      const afterGood = last as unknown as ReturnType<typeof usePolledSpans>;
      expect(afterGood.sessions.length).toBe(1);
      expect(afterGood.error).toBeNull();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(60);
      });
      const afterError = last as unknown as ReturnType<typeof usePolledSpans>;
      expect(afterError.sessions.length).toBe(1);
      expect(afterError.error).toBe("CH down");
    } finally {
      vi.useRealTimers();
      cleanup();
    }
  });
});
