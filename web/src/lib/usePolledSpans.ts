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
 *    is overtaken by the next interval tick, the stale response is dropped
 *    so the UI never flashes back to an older snapshot.
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
} from "./clickhouse";
import { groupSpans, type SessionGroup, type SpanRow } from "./grouping";

export interface PolledSpansState {
  sessions: SessionGroup[];
  nowMs: number;
  error: string | null;
  loading: boolean;
}

export interface UsePolledSpansOptions {
  intervalMs?: number;
  config?: ClickHouseConfig;
  fetchImpl?: (config: ClickHouseConfig) => Promise<SpanRow[]>;
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

  const [state, setState] = useState<PolledSpansState>(() => ({
    sessions: [],
    nowMs: nowRef.current(),
    error: null,
    loading: true,
  }));

  useEffect(() => {
    mountedRef.current = true;

    const resolveConfig = (): ClickHouseConfig => {
      if (configRef.current) return configRef.current;
      const cfg = loadConfigFromEnv();
      configRef.current = cfg;
      return cfg;
    };

    const doFetch = async (): Promise<void> => {
      // Each fetch carries a generation token; if a later tick has
      // already started (or finished) by the time we resolve, drop our
      // result so the UI never regresses to an older snapshot.
      generationRef.current += 1;
      const gen = generationRef.current;

      let rows: SpanRow[];
      try {
        const cfg = resolveConfig();
        const impl = fetchRef.current;
        rows = impl ? await impl(cfg) : await fetchOnce(cfg);
      } catch (err) {
        if (!mountedRef.current || gen !== generationRef.current) return;
        const message = err instanceof Error ? err.message : String(err);
        setState((prev) => ({
          // Preserve last-good sessions across a failed poll so a transient
          // CH blip doesn't blank the UI.
          sessions: prev.sessions,
          nowMs: nowRef.current(),
          error: message,
          loading: false,
        }));
        return;
      }
      if (!mountedRef.current || gen !== generationRef.current) return;
      const sessions = groupSpans(rows);
      setState({
        sessions,
        nowMs: nowRef.current(),
        error: null,
        loading: false,
      });
    };

    void doFetch();
    const handle = window.setInterval(() => {
      void doFetch();
    }, intervalMs);

    return () => {
      mountedRef.current = false;
      window.clearInterval(handle);
    };
  }, [intervalMs]);

  return state;
}
