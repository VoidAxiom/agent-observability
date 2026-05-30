/*
 * collapsible-traces — pins CollapsibleTraceList expand behavior + the
 * subagent badge render path. The chevron click expands inline, revealing
 * the spans with data-depth attributes. A subagent span (carrying
 * SpanAttributesRaw['subagent_type']) gets a child element matching
 * [data-subagent-badge="true"].
 */

import { describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { CollapsibleTraceList } from "../src/components/CollapsibleTraceList";
import type { SpanRow, TraceGroup } from "../src/lib/grouping";

function span(o: Partial<SpanRow> & { SpanId: string; TraceId: string }): SpanRow {
  return {
    TraceId: o.TraceId,
    SpanId: o.SpanId,
    ParentSpanId: o.ParentSpanId ?? "",
    SpanName: o.SpanName ?? "claude_code.tool.bash",
    Timestamp: o.Timestamp ?? "2026-01-01T00:00:00.000000000",
    ServiceName: o.ServiceName ?? "claude-code",
    StatusCode: o.StatusCode ?? "",
    Duration: o.Duration ?? 1_000_000,
    AgentProject: o.AgentProject ?? "p",
    AgentSessionId: o.AgentSessionId ?? "s",
    AgentRunId: o.AgentRunId ?? "r",
    SessionId: o.SessionId ?? "sess",
    ProjectName: o.ProjectName ?? "proj",
    ResourceAttributesRaw: o.ResourceAttributesRaw ?? {},
    SpanAttributesRaw: o.SpanAttributesRaw ?? {},
    depth: o.depth ?? 0,
  };
}

function trace(id: string, spans: SpanRow[]): TraceGroup {
  return {
    id,
    traceId: id,
    displayLabel: id,
    rootStart: 0,
    rootStartText: "",
    lastActivity: 0,
    lastActivityText: "",
    spanCount: spans.length,
    durationSeconds: 1.234,
    hasError: false,
    spans,
  };
}

interface HarnessProps {
  traces: TraceGroup[];
}

function Harness({ traces }: HarnessProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);
  return (
    <CollapsibleTraceList
      traces={traces}
      selectedTraceId={selectedTraceId}
      selectedSpanId={selectedSpanId}
      expandedTraceIds={expanded}
      onSelectTrace={setSelectedTraceId}
      onSelectSpan={setSelectedSpanId}
      onToggleExpand={(id) =>
        setExpanded((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        })
      }
    />
  );
}

describe("CollapsibleTraceList", () => {
  it("renders trace rows with no spans visible by default", () => {
    const t1 = trace("trace-1", [
      span({ TraceId: "trace-1", SpanId: "s1", depth: 0 }),
      span({ TraceId: "trace-1", SpanId: "s2", depth: 1, ParentSpanId: "s1" }),
    ]);
    const { container } = render(<Harness traces={[t1]} />);
    // Trace label visible
    expect(container.querySelector('[data-trace-id="trace-1"]')).not.toBeNull();
    // No inline span rows yet (expanded set is empty)
    expect(container.querySelectorAll("[data-span-id]").length).toBe(0);
    cleanup();
  });

  it("clicking the chevron expands the trace to show indented spans with data-depth", () => {
    const subagentSpan = span({
      TraceId: "trace-A",
      SpanId: "sub-1",
      depth: 2,
      ParentSpanId: "root",
      SpanName: "claude_code.tool.bash",
      SpanAttributesRaw: { subagent_type: "Bash", agent_id: "agent-xyz" },
    });
    const t = trace("trace-A", [
      span({ TraceId: "trace-A", SpanId: "root", depth: 0 }),
      subagentSpan,
    ]);
    const { container, getByTestId } = render(<Harness traces={[t]} />);

    fireEvent.click(getByTestId("voi-chevron-trace-A"));

    const spanRows = container.querySelectorAll("[data-span-id]");
    expect(spanRows.length).toBe(2);

    // data-depth attribute carries the depth value
    const depths = Array.from(spanRows).map((el) => el.getAttribute("data-depth"));
    expect(depths).toContain("0");
    expect(depths).toContain("2");

    // Subagent span carries the badge element. The label IS the upper-
    // cased subagent_type (NOT a generic "[SUBAGENT]" literal) so it
    // agrees with the waterfall bar suffix label.
    const badge = container.querySelector('[data-subagent-badge="true"]');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toBe("[BASH]");

    // Tooltip carries the agent metadata
    const tooltip = badge?.getAttribute("data-tooltip") ?? "";
    expect(tooltip).toContain("subagent_type=Bash");
    expect(tooltip).toContain("agent_id=agent-xyz");

    cleanup();
  });

  it("non-subagent spans do NOT render the badge", () => {
    const t = trace("trace-B", [
      span({ TraceId: "trace-B", SpanId: "p1", depth: 0, SpanName: "claude_code.llm_request" }),
    ]);
    const { container, getByTestId } = render(<Harness traces={[t]} />);
    fireEvent.click(getByTestId("voi-chevron-trace-B"));
    expect(container.querySelector('[data-subagent-badge="true"]')).toBeNull();
    cleanup();
  });
});
