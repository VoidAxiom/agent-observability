/*
 * sessionsFilter — propagating Live-tab filter for the SessionNode forest.
 *
 * A node is "kept" if its own activityStatus is active OR any descendant
 * is active. When a parent is itself inactive but a descendant is active,
 * the parent is RETAINED (with children filtered to only the active
 * subtree) so the operator can drill into the live descendant via the
 * parent's row.
 *
 * Pure function — never mutates the input. nowMs flows from usePolledSpans
 * so every consumer (filter + activity-status helpers + tab counts) agrees
 * on the wall clock and tests can pin it deterministically.
 */

import { activityStatus, type SessionGroup, type SessionNode } from "./grouping";

export function filterActive(
  sessions: SessionGroup[],
  nowMs: number,
): SessionGroup[] {
  const out: SessionNode[] = [];
  for (const node of sessions) {
    const kept = filterNode(node, nowMs);
    if (kept) out.push(kept);
  }
  return out;
}

/**
 * Return a NEW SessionNode with descendants filtered to the active
 * subtree, OR null when the entire subtree (this node + every descendant)
 * is inactive. Aggregates are recomputed against the filtered children.
 */
function filterNode(node: SessionNode, nowMs: number): SessionNode | null {
  const filteredChildren: SessionNode[] = [];
  for (const child of node.children) {
    const kept = filterNode(child, nowMs);
    if (kept) filteredChildren.push(kept);
  }
  const selfActive = activityStatus(node, nowMs) === "active";
  if (!selfActive && filteredChildren.length === 0) return null;

  // Recompute descendant aggregates against the FILTERED children so the
  // sidebar chip on a parent kept only because of an active descendant
  // reflects the descendant's contribution, not the original (pre-filter)
  // count. spanCount / hasError on the node itself are intrinsic to the
  // node's own spans and are unchanged.
  let descSpans = 0;
  let descError = false;
  for (const child of filteredChildren) {
    descSpans += child.spanCount + child.descendantSpanCount;
    if (child.hasError || child.descendantHasError) descError = true;
  }

  return {
    ...node,
    children: filteredChildren,
    descendantSpanCount: descSpans,
    descendantHasError: descError,
  };
}
