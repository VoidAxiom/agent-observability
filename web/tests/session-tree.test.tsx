/*
 * session-tree.test.tsx — VOI-386 RTL exercise of SessionSidebar
 * rendering a hand-built 3-level forest (claude → subagent → codex).
 *
 * Asserts:
 *  - Root nodes render with their disclosure triangle reflecting the
 *    expandedNodeIds prop (▾ when expanded, ▸ when collapsed).
 *  - Clicking the triangle fires onToggleExpand WITHOUT firing onSelect.
 *  - Clicking the row body fires onSelect WITHOUT firing onToggleExpand.
 *  - Indentation increases by 14px per depth (16 + depth*14).
 *  - Kind chip text matches the SessionNode.kind discriminator.
 *  - Children only render when the parent is in expandedNodeIds.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { SessionSidebar } from "../src/components/SessionSidebar";
import type { SessionNode, SpanRow } from "../src/lib/grouping";

afterEach(() => cleanup());

function makeSpan(id: string): SpanRow {
  return {
    TraceId: `trace-${id}`,
    SpanId: id,
    ParentSpanId: "",
    SpanName: "claude_code.tool.bash",
    Timestamp: "2026-01-01T00:00:01.000000000",
    ServiceName: "claude-code",
    StatusCode: "",
    Duration: 1_000_000,
    AgentProject: "agent-observability",
    AgentSessionId: "agent-sess",
    AgentRunId: "run",
    SessionId: id,
    ProjectName: "proj",
    ResourceAttributesRaw: {},
    SpanAttributesRaw: {},
    depth: 0,
  };
}

interface NodeOverrides {
  id: string;
  kind: SessionNode["kind"];
  label?: string;
  children?: SessionNode[];
}

function node(o: NodeOverrides): SessionNode {
  const s = makeSpan(o.id);
  return {
    id: o.id,
    sessionKey: o.id,
    displayLabel: o.label ?? o.id,
    serviceName: o.kind === "codex" ? "codex_exec" : "claude-code",
    projectName: "proj",
    lastActivity: Date.now(),
    lastActivityText: "",
    spanCount: 1,
    traceCount: 1,
    durationSeconds: 0.001,
    hasError: false,
    traces: [
      {
        id: `${o.id}-t1`,
        traceId: `${o.id}-t1`,
        displayLabel: "claude_code.tool.bash",
        rootStart: Date.now(),
        rootStartText: "",
        lastActivity: Date.now(),
        lastActivityText: "",
        spanCount: 1,
        durationSeconds: 0.001,
        hasError: false,
        spans: [s],
      },
    ],
    kind: o.kind,
    parentId: null,
    children: o.children ?? [],
    spans: [s],
    descendantSpanCount: 0,
    descendantHasError: false,
  };
}

function buildForest(): SessionNode[] {
  const codexA = node({ id: "codex-A", kind: "codex", label: "codex-A" });
  const subagent = node({
    id: "sub-A",
    kind: "subagent",
    label: "ui-implementer",
    children: [codexA],
  });
  const root = node({
    id: "claude-root",
    kind: "claude",
    label: "claude · root",
    children: [subagent],
  });
  return [root];
}

describe("SessionSidebar tree rendering (VOI-386)", () => {
  it("root nodes render with ▾ disclosure when expanded; children visible", () => {
    const forest = buildForest();
    const { container } = render(
      <SessionSidebar
        sessions={forest}
        selectedSessionId={null}
        onSelect={() => undefined}
        expandedNodeIds={new Set(["claude-root", "sub-A"])}
        onToggleExpand={() => undefined}
        nowMs={Date.now()}
      />,
    );
    const rootDisc = container.querySelector(
      '[data-disclosure="true"][data-node-id="claude-root"]',
    );
    expect(rootDisc?.textContent).toBe("▾");
    // Subagent + codex rows are visible only because their parents are expanded.
    expect(container.querySelector('[data-session-id="sub-A"]')).not.toBeNull();
    expect(container.querySelector('[data-session-id="codex-A"]')).not.toBeNull();
  });

  it("collapsed subagent hides its codex children but the subagent row is visible", () => {
    const forest = buildForest();
    const { container } = render(
      <SessionSidebar
        sessions={forest}
        selectedSessionId={null}
        onSelect={() => undefined}
        expandedNodeIds={new Set(["claude-root"])}
        onToggleExpand={() => undefined}
        nowMs={Date.now()}
      />,
    );
    expect(container.querySelector('[data-session-id="sub-A"]')).not.toBeNull();
    expect(
      container.querySelector('[data-session-id="codex-A"]'),
    ).toBeNull();
    const subDisc = container.querySelector(
      '[data-disclosure="true"][data-node-id="sub-A"]',
    );
    expect(subDisc?.textContent).toBe("▸");
    expect(subDisc?.getAttribute("aria-expanded")).toBe("false");
  });

  it("clicking the disclosure triangle fires onToggleExpand without firing onSelect", () => {
    const onSelect = vi.fn();
    const onToggleExpand = vi.fn();
    const forest = buildForest();
    const { container } = render(
      <SessionSidebar
        sessions={forest}
        selectedSessionId={null}
        onSelect={onSelect}
        expandedNodeIds={new Set(["claude-root"])}
        onToggleExpand={onToggleExpand}
        nowMs={Date.now()}
      />,
    );
    const subDisc = container.querySelector(
      '[data-disclosure="true"][data-node-id="sub-A"]',
    ) as HTMLButtonElement;
    fireEvent.click(subDisc);
    expect(onToggleExpand).toHaveBeenCalledWith("sub-A");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("clicking a subagent row fires onSelect with the subagent id; does NOT toggle expansion", () => {
    const onSelect = vi.fn();
    const onToggleExpand = vi.fn();
    const forest = buildForest();
    const { container } = render(
      <SessionSidebar
        sessions={forest}
        selectedSessionId={null}
        onSelect={onSelect}
        expandedNodeIds={new Set(["claude-root"])}
        onToggleExpand={onToggleExpand}
        nowMs={Date.now()}
      />,
    );
    const subRow = container.querySelector(
      '[data-session-id="sub-A"]',
    ) as HTMLButtonElement;
    fireEvent.click(subRow);
    expect(onSelect).toHaveBeenCalledWith("sub-A");
    expect(onToggleExpand).not.toHaveBeenCalled();
  });

  it("indentation is depth*14 px (claude=0 → 16, subagent=1 → 30, codex=2 → 44)", () => {
    const forest = buildForest();
    const { container } = render(
      <SessionSidebar
        sessions={forest}
        selectedSessionId={null}
        onSelect={() => undefined}
        expandedNodeIds={new Set(["claude-root", "sub-A"])}
        onToggleExpand={() => undefined}
        nowMs={Date.now()}
      />,
    );
    const rowFor = (id: string): HTMLElement => {
      const row = container.querySelector(`[data-session-id="${id}"]`);
      if (!row) throw new Error(`no row for ${id}`);
      // The wrapping div carries the depth-driven padding.
      return row.parentElement as HTMLElement;
    };
    expect(rowFor("claude-root").style.paddingLeft).toBe("16px");
    expect(rowFor("sub-A").style.paddingLeft).toBe("30px");
    expect(rowFor("codex-A").style.paddingLeft).toBe("44px");
  });

  it("kind chip text matches the node's kind discriminator", () => {
    const forest = buildForest();
    const { container } = render(
      <SessionSidebar
        sessions={forest}
        selectedSessionId={null}
        onSelect={() => undefined}
        expandedNodeIds={new Set(["claude-root", "sub-A"])}
        onToggleExpand={() => undefined}
        nowMs={Date.now()}
      />,
    );
    expect(
      container.querySelector('[data-kind-chip="claude"]')?.textContent,
    ).toBe("claude");
    expect(
      container.querySelector('[data-kind-chip="subagent"]')?.textContent,
    ).toBe("subagent");
    expect(
      container.querySelector('[data-kind-chip="codex"]')?.textContent,
    ).toBe("codex");
  });

  it("a leaf node renders without a disclosure button (no triangle)", () => {
    const leafOnly = [node({ id: "leaf", kind: "claude" })];
    const { container } = render(
      <SessionSidebar
        sessions={leafOnly}
        selectedSessionId={null}
        onSelect={() => undefined}
        expandedNodeIds={new Set()}
        onToggleExpand={() => undefined}
        nowMs={Date.now()}
      />,
    );
    expect(
      container.querySelector('[data-disclosure="true"][data-node-id="leaf"]'),
    ).toBeNull();
  });
});
