/*
 * sessionsFilter — predicate that narrows SessionGroup[] to the "active"
 * subset for the Live tab. Wraps the existing activityStatus() heuristic
 * (5-minute window) so the tab UI doesn't reach into grouping.ts directly.
 *
 * Pure function. nowMs flows from usePolledSpans so the filter agrees with
 * the rest of the UI on the wall clock (and so tests can pin a deterministic
 * nowMs without monkey-patching Date).
 */

import { activityStatus, type SessionGroup } from "./grouping";

export function filterActive(
  sessions: SessionGroup[],
  nowMs: number,
): SessionGroup[] {
  return sessions.filter((s) => activityStatus(s, nowMs) === "active");
}
