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
    // Cross-tab safety: read the current persisted set and UNION with the
    // in-memory set before writing. Without this, Tab A's `{E1}` write
    // would be overwritten by Tab B's later `{E2}` write — both tabs
    // would re-celebrate the lost edge on next reload, breaking the
    // "exactly ONCE per browser profile" contract in the file header.
    // Codex round-4 P1 2026-05-30.
    const merged = new Set<string>(celebrated);
    const raw = window.localStorage?.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const v of parsed) {
            if (typeof v === "string") merged.add(v);
          }
        }
      } catch {
        // Corrupt or stale JSON — fall through and overwrite with the
        // in-memory set. Worse-case: we lose celebrations from a
        // corrupted tab write, but we never propagate the corruption.
      }
    }
    window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(Array.from(merged)));
  } catch {
    // private mode / unavailable storage — best-effort.
  }
}

// Module-scoped flag so the `storage` listener is wired exactly once even
// if hydrate() runs from multiple component mounts in the same tab.
let storageListenerWired = false;

export const useCrossProcessStore = create<CrossProcessState>((set, get) => ({
  celebrated: new Set(),
  hydrated: false,
  hydrate: () => {
    if (get().hydrated) return;
    set({ celebrated: loadFromStorage(), hydrated: true });
    // Cross-tab safety: when another tab writes to STORAGE_KEY, merge its
    // payload into our in-memory set so a celebration the user already
    // saw in Tab B isn't re-fired when they switch to Tab A. Pairs with
    // the union-on-write inside saveToStorage above. Codex round-4 P1
    // 2026-05-30.
    if (typeof window !== "undefined" && !storageListenerWired) {
      storageListenerWired = true;
      window.addEventListener("storage", (event) => {
        if (event.key !== STORAGE_KEY) return;
        // Re-read the full set rather than parsing event.newValue alone —
        // any concurrent write between the event and our read is already
        // unioned at the storage layer per saveToStorage's union.
        const fresh = loadFromStorage();
        const current = get().celebrated;
        // Skip the no-op case to avoid unnecessary store updates that
        // would re-render every subscriber (the running sweeps for one).
        let diverged = fresh.size !== current.size;
        if (!diverged) {
          for (const v of fresh) {
            if (!current.has(v)) {
              diverged = true;
              break;
            }
          }
        }
        if (diverged) set({ celebrated: fresh });
      });
    }
  },
  hasCelebrated: (edgeKey: string) => {
    // Pure read — do NOT set() here. Components that need hydration must
    // call hydrate() from a useEffect; calling set() inside what may be a
    // render-time selector violates React's no-state-update-during-render
    // rule and can cause "Cannot update a component while rendering"
    // warnings + missed sweeps under concurrent rendering.
    return get().celebrated.has(edgeKey);
  },
  markCelebrated: (edgeKey: string) => {
    const current = get().celebrated;
    if (current.has(edgeKey)) return;
    const next = new Set(current);
    next.add(edgeKey);
    // Persist FIRST (with cross-tab union) — then read back the merged
    // storage state into memory so other tabs' celebrations land in our
    // set immediately, not only on the next `storage` event tick.
    saveToStorage(next);
    const merged = loadFromStorage();
    // Belt-and-suspenders: ensure the just-added edge is present even if
    // a hostile localStorage layer silently discarded the write.
    merged.add(edgeKey);
    set({ celebrated: merged, hydrated: true });
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
