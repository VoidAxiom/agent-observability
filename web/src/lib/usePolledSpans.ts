/*
 * usePolledSpans — fetch + group spans from ClickHouse on a 5s cadence.
 *
 * Contract:
 *  - First mount sets loading=true, then either fills sessions or sets error.
 *  - Subsequent polls swap data atomically: no flicker, loading stays false.
 *  - nowMs advances with each successful refresh so activityStatus() honors
 *    the latest wall-clock vs the latest span end-time.
 *  - Errors don't blank prior data; sessions stays at last-good and error
 *    carries the message. Recovery on the next successful tick clears error.
 *  - Interval cleared on unmount; in-flight fetches no-op via a guard ref
 *    so a tab-switched-out poll can't clobber state after teardown.
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
  // Lazy default so a test that doesn't pass config can still mock fetchImpl
  // without touching loadConfigFromEnv (which would otherwise read import.meta.env).
  const configRef = useRef<ClickHouseConfig | null>(options.config ?? null);
  const fetchRef = useRef(options.fetchImpl);
  const nowRef = useRef(options.nowFn ?? (() => Date.now()));
  const mountedRef = useRef(true);

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

    const doFetch = async (isFirst: boolean): Promise<void> => {
      let rows: SpanRow[];
      try {
        const cfg = resolveConfig();
        const impl = fetchRef.current;
        rows = impl ? await impl(cfg) : await fetchOnce(cfg);
      } catch (err) {
        if (!mountedRef.current) return;
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
      if (!mountedRef.current) return;
      const sessions = groupSpans(rows);
      setState({
        sessions,
        nowMs: nowRef.current(),
        error: null,
        loading: isFirst ? false : false,
      });
    };

    void doFetch(true);
    const handle = window.setInterval(() => {
      void doFetch(false);
    }, intervalMs);

    return () => {
      mountedRef.current = false;
      window.clearInterval(handle);
    };
  }, [intervalMs]);

  return state;
}
