/*
 * usePolledSpans — fetch + group spans from ClickHouse on a 5s cadence.
 *
 * Contract:
 *  - First mount sets loading=true, then either fills sessions or sets error.
 *  - Subsequent polls swap data atomically: no flicker, loading stays false.
 *  - nowMs advances with EVERY tick (successful OR errored). The wall clock
 *    keeps ticking regardless of CH availability, so activityStatus()
 *    correctly ages sessions during a CH outage.
 *  - Errors don't blank prior data; sessions stays at last-good and error
 *    carries the message. Recovery on the next successful tick clears error.
 *  - In-flight fetches are guarded by a generation counter — if a slow poll
 *    is overtaken by a LATER poll that has already committed, the stale
 *    response is dropped so the UI never flashes back to an older snapshot.
 *    A slow poll whose successor is also still in flight DOES commit when
 *    it resolves (the order check is "is there a strictly newer committed
 *    generation?", not "am I the latest started?") — this prevents
 *    starvation when CH latency persistently exceeds intervalMs.
 *  - Interval cleared on unmount; in-flight fetches no-op via mountedRef
 *    so a tab-switched-out poll can't clobber state after teardown.
 *  - options (fetchImpl, nowFn, config) are mirrored into refs on every
 *    render so a parent that swaps an injected mock between renders sees
 *    the change honored on the next tick.
 */

import { useEffect, useRef, useState } from "react";
import {
  fetchOnce,
  loadConfigFromEnv,
  type ClickHouseConfig,
  type FetchResult,
} from "./clickhouse";
import { groupSpans, type SessionGroup, type SpanRow } from "./grouping";

export interface PolledSpansState {
  sessions: SessionGroup[];
  nowMs: number;
  error: string | null;
  loading: boolean;
  /**
   * True iff the most recent poll's row count hit the safety ceiling
   * (VITE_CH_QUERY_LIMIT_CEILING — default 50k). The SessionSidebar shows
   * a "// window truncated" chip when this is true so the operator knows
   * the visible session list might be missing older sessions whose latest
   * activity fell outside the visible-rows window. VOI-382.
   */
  truncated: boolean;
}

export interface UsePolledSpansOptions {
  intervalMs?: number;
  config?: ClickHouseConfig;
  // Test-injectable fetch. Matches fetchOnce's return shape (FetchResult)
  // exactly — no dual-shape shim. Tests construct `{ rows, truncated }`
  // explicitly so the production contract and the test contract stay in
  // lockstep.
  fetchImpl?: (config: ClickHouseConfig) => Promise<FetchResult>;
  nowFn?: () => number;
}

const DEFAULT_INTERVAL_MS = 5000;

export function usePolledSpans(
  options: UsePolledSpansOptions = {},
): PolledSpansState {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;

  // Refs mirror the latest options on every render so callers can swap
  // mocks/config across renders without remounting the hook.
  const configRef = useRef<ClickHouseConfig | null>(options.config ?? null);
  const fetchRef = useRef(options.fetchImpl);
  const nowRef = useRef(options.nowFn ?? (() => Date.now()));
  // Refresh on every render — cheap; keeps the typed surface honest.
  configRef.current = options.config ?? configRef.current;
  fetchRef.current = options.fetchImpl;
  nowRef.current = options.nowFn ?? (() => Date.now());

  const mountedRef = useRef(true);
  const generationRef = useRef(0);
  // Highest generation that has actually committed state. A resolved fetch
  // is dropped iff a STRICTLY LATER generation has already committed —
  // this preserves the "stale-slow-fetch loses to newer-fast-fetch"
  // ordering AND lets a slow successful poll commit when its successors
  // are also still in flight (no starvation when CH latency > intervalMs).
  const lastCommittedGenRef = useRef(0);

  const [state, setState] = useState<PolledSpansState>(() => ({
    sessions: [],
    nowMs: nowRef.current(),
    error: null,
    loading: true,
    truncated: false,
  }));

  // Dedupe console.warn for truncation so we warn ONCE per truncated-state
  // transition (false → true). Without this, a 5s poll on a chronically-
  // truncated table spams the console every 5 seconds. Refs scoped to the
  // hook instance so two hook callers don't share state.
  const lastTruncatedRef = useRef<boolean>(false);

  useEffect(() => {
    mountedRef.current = true;
    // Local-to-effect cancellation flag: cleanup flips it so any in-flight
    // fetch from this effect cannot commit after a NEW effect (e.g. caused
    // by intervalMs change) starts. The hook-scoped mountedRef alone is
    // insufficient because React re-runs the effect body immediately after
    // cleanup, flipping mountedRef back to true and letting a prior-effect
    // fetch land into the new effect's lifecycle (which would also reset
    // the generation counters — the old fetch would then look "newer" than
    // anything committed in the new epoch). The cancelled-closure scopes
    // the guard to THIS effect run.
    let cancelled = false;

    const resolveConfig = (): ClickHouseConfig => {
      if (configRef.current) return configRef.current;
      const cfg = loadConfigFromEnv();
      configRef.current = cfg;
      return cfg;
    };

    const doFetch = async (): Promise<void> => {
      // Each fetch carries a monotonically increasing generation token. A
      // resolved fetch commits iff no STRICTLY LATER generation has already
      // committed (gen > lastCommittedGenRef). The "strictly later"
      // condition lets a slow poll still commit when its successor is also
      // still in flight, preventing starvation under sustained CH latency
      // > intervalMs. The original "stale-slow-fetch loses to newer-fast-
      // fetch" ordering is preserved: the fast successor commits first,
      // bumps lastCommittedGen, and the older fetch is then dropped.
      // The cancelled-closure additionally drops any fetch belonging to a
      // prior effect epoch (cleanup → re-run) wholesale.
      generationRef.current += 1;
      const gen = generationRef.current;

      let rows: SpanRow[];
      let truncated: boolean;
      // rawRowCount comes off FetchResult so the truncation warn cites the
      // exact count CH SENT (the count truncated was decided from), not
      // rows.length which can be smaller when individual rows fail to
      // parse — codex P2 round-3 2026-05-30.
      let rawRowCount: number;
      try {
        const cfg = resolveConfig();
        const impl = fetchRef.current;
        const result = impl ? await impl(cfg) : await fetchOnce(cfg);
        rows = result.rows;
        truncated = result.truncated;
        rawRowCount = result.rawRowCount;
      } catch (err) {
        if (cancelled || !mountedRef.current || gen <= lastCommittedGenRef.current) return;
        const message = err instanceof Error ? err.message : String(err);
        lastCommittedGenRef.current = gen;
        setState((prev) => ({
          // Preserve last-good sessions across a failed poll so a transient
          // CH blip doesn't blank the UI. Preserve truncated too — a
          // transient error shouldn't flip the chip off.
          sessions: prev.sessions,
          nowMs: nowRef.current(),
          error: message,
          loading: false,
          truncated: prev.truncated,
        }));
        return;
      }
      if (cancelled || !mountedRef.current || gen <= lastCommittedGenRef.current) return;
      lastCommittedGenRef.current = gen;
      const sessions = groupSpans(rows);
      // Warn once per false→true transition (see lastTruncatedRef
      // declaration above for rationale).
      if (truncated && !lastTruncatedRef.current) {
        console.warn(
          `[usePolledSpans] ClickHouse result hit the row-count safety ceiling ` +
            `(${rawRowCount} raw rows). Older spans within the configured time window ` +
            `were dropped. Raise CH_QUERY_LIMIT_CEILING (or VITE_CH_QUERY_LIMIT_CEILING ` +
            `as a web-only fallback), or shorten CH_QUERY_WINDOW_HOURS.`,
        );
      }
      lastTruncatedRef.current = truncated;
      setState({
        sessions,
        nowMs: nowRef.current(),
        error: null,
        loading: false,
        truncated,
      });
    };

    void doFetch();
    const handle = window.setInterval(() => {
      void doFetch();
    }, intervalMs);

    return () => {
      cancelled = true;
      mountedRef.current = false;
      window.clearInterval(handle);
    };
  }, [intervalMs]);

  return state;
}
