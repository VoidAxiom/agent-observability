/*
 * crossProcessStore — Zustand store that tracks which cross-process edges
 * have already been celebrated with the GSAP sweep, so each edge fires
 * the dopamine animation exactly ONCE per browser profile.
 *
 * Persistence: localStorage (best-effort; gracefully no-ops in private mode
 * or test envs without storage). The store hydrates on first read so SSR
 * / first-render is deterministic.
 *
 * Edge key: `${traceId}|${parentSpanId}|${childSpanId}` — trace-scoped so
 * the same span pair across two trace replays still celebrates once per
 * trace, matching how a span on the waterfall is uniquely identified.
 */

import { create } from "zustand";

const STORAGE_KEY = "voi.crossProcessCelebrated.v1";

interface CrossProcessState {
  celebrated: Set<string>;
  hydrated: boolean;
  hydrate: () => void;
  hasCelebrated: (edgeKey: string) => boolean;
  markCelebrated: (edgeKey: string) => void;
  // For tests + the runtime-verification "fresh localStorage" reload:
  reset: () => void;
}

function loadFromStorage(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === "string"));
  } catch {
    return new Set();
  }
}

function saveToStorage(celebrated: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage?.setItem(
      STORAGE_KEY,
      JSON.stringify(Array.from(celebrated)),
    );
  } catch {
    // private mode / unavailable storage — best-effort.
  }
}

export const useCrossProcessStore = create<CrossProcessState>((set, get) => ({
  celebrated: new Set(),
  hydrated: false,
  hydrate: () => {
    if (get().hydrated) return;
    set({ celebrated: loadFromStorage(), hydrated: true });
  },
  hasCelebrated: (edgeKey: string) => {
    if (!get().hydrated) {
      // Lazy-hydrate on first read.
      set({ celebrated: loadFromStorage(), hydrated: true });
    }
    return get().celebrated.has(edgeKey);
  },
  markCelebrated: (edgeKey: string) => {
    const current = get().celebrated;
    if (current.has(edgeKey)) return;
    const next = new Set(current);
    next.add(edgeKey);
    set({ celebrated: next, hydrated: true });
    saveToStorage(next);
  },
  reset: () => {
    set({ celebrated: new Set(), hydrated: true });
    if (typeof window !== "undefined") {
      try {
        window.localStorage?.removeItem(STORAGE_KEY);
      } catch {
        // ignore
      }
    }
  },
}));

export function buildEdgeKey(
  traceId: string,
  parentSpanId: string,
  childSpanId: string,
): string {
  return `${traceId}|${parentSpanId}|${childSpanId}`;
}
