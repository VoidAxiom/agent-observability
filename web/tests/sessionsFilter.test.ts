/*
 * sessionsFilter.test.ts — VOI-386 propagation rule for the Live tab.
 *
 * A node is kept in the active subset if it OR any descendant is active.
 * When the parent itself is inactive but a descendant is active, the
 * parent is retained (with children filtered to the active subtree) so
 * the operator can drill into the live descendant via the parent row.
 *
 * A fully-stale subtree (parent + every descendant inactive) is dropped.
 */

import { describe, expect, it } from "vitest";
import { filterActive } from "../src/lib/sessionsFilter";
import type { SessionNode, SpanRow } from "../src/lib/grouping";

const NOW = Date.UTC(2026, 0, 1, 0, 5, 0);
const ACTIVE = NOW - 60 * 1000; // 60s ago — within the 5-minute active window
const STALE = NOW - 60 * 60 * 1000; // 1h ago — past idle, beyond active

function span(id: string): SpanRow {
  return {
    TraceId: `t-${id}`,
    SpanId: id,
    ParentSpanId: "",
    SpanName: "claude_code.tool.bash",
    Timestamp: "",
    ServiceName: "claude-code",
    StatusCode: "",
    Duration: 0,
    AgentProject: "",
    AgentSessionId: "",
    AgentRunId: "",
    SessionId: id,
    ProjectName: "",
    ResourceAttributesRaw: {},
    SpanAttributesRaw: {},
    depth: 0,
  };
}

interface NodeOverrides {
  id: string;
  lastActivity: number;
  kind?: SessionNode["kind"];
  children?: SessionNode[];
}

function node(o: NodeOverrides): SessionNode {
  const s = span(o.id);
  return {
    id: o.id,
    sessionKey: o.id,
    displayLabel: o.id,
    serviceName: "claude-code",
    projectName: "",
    lastActivity: o.lastActivity,
    lastActivityText: "",
    spanCount: 1,
    traceCount: 1,
    durationSeconds: 0,
    hasError: false,
    traces: [],
    kind: o.kind ?? "claude",
    parentId: null,
    children: o.children ?? [],
    spans: [s],
    descendantSpanCount: 0,
    descendantHasError: false,
  };
}

describe("filterActive (VOI-386 propagating Live filter)", () => {
  it("keeps an active root with no children", () => {
    const out = filterActive([node({ id: "r1", lastActivity: ACTIVE })], NOW);
    expect(out.map((n) => n.id)).toEqual(["r1"]);
  });

  it("drops a fully-stale subtree (parent inactive + every descendant inactive)", () => {
    const stale = node({
      id: "stale-root",
      lastActivity: STALE,
      children: [node({ id: "stale-child", lastActivity: STALE })],
    });
    expect(filterActive([stale], NOW)).toEqual([]);
  });

  it("keeps an inactive parent when a descendant is active so the operator can drill in", () => {
    const tree = node({
      id: "inactive-parent",
      lastActivity: STALE,
      children: [
        node({ id: "active-child", lastActivity: ACTIVE }),
        node({ id: "stale-sibling", lastActivity: STALE }),
      ],
    });
    const out = filterActive([tree], NOW);
    expect(out.length).toBe(1);
    expect(out[0]!.id).toBe("inactive-parent");
    // Children filtered to only the active subtree — stale sibling dropped.
    expect(out[0]!.children.map((c) => c.id)).toEqual(["active-child"]);
  });

  it("filters to the live subtree across multiple levels (claude → subagent → codex)", () => {
    // Only the codex grandchild is active; subagent + claude are stale.
    // Filter must retain all three so the operator can drill from the
    // visible root to the active codex.
    const tree = node({
      id: "claude-root",
      lastActivity: STALE,
      children: [
        node({
          id: "subagent",
          lastActivity: STALE,
          kind: "subagent",
          children: [
            node({ id: "codex-live", lastActivity: ACTIVE, kind: "codex" }),
          ],
        }),
      ],
    });
    const out = filterActive([tree], NOW);
    expect(out.length).toBe(1);
    expect(out[0]!.children.length).toBe(1);
    expect(out[0]!.children[0]!.children.map((c) => c.id)).toEqual([
      "codex-live",
    ]);
  });

  it("does not mutate the input forest", () => {
    const tree = node({
      id: "root",
      lastActivity: STALE,
      children: [
        node({ id: "live", lastActivity: ACTIVE }),
        node({ id: "stale", lastActivity: STALE }),
      ],
    });
    const before = tree.children.map((c) => c.id);
    filterActive([tree], NOW);
    expect(tree.children.map((c) => c.id)).toEqual(before);
  });

  it("recomputes descendantSpanCount against the FILTERED children, not the original", () => {
    const tree = node({
      id: "root",
      lastActivity: ACTIVE,
      children: [
        node({ id: "live", lastActivity: ACTIVE }),
        node({ id: "stale", lastActivity: STALE }),
      ],
    });
    // Original tree's descendantSpanCount is 0 (fixture default); after
    // filtering the parent keeps only "live" (1 span). The aggregate
    // should reflect the filtered child set so sidebar chips don't lie.
    const out = filterActive([tree], NOW);
    expect(out[0]!.children.map((c) => c.id)).toEqual(["live"]);
    expect(out[0]!.descendantSpanCount).toBe(1);
  });
});
