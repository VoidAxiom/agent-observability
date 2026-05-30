import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SessionSidebar } from "../src/components/SessionSidebar";
import type { SessionGroup, SpanRow } from "../src/lib/grouping";

function span(o: Partial<SpanRow> & { SpanId: string }): SpanRow {
  return {
    TraceId: o.TraceId ?? "t1",
    SpanId: o.SpanId,
    ParentSpanId: o.ParentSpanId ?? "",
    SpanName: o.SpanName ?? "claude_code.tool",
    Timestamp: o.Timestamp ?? "2026-01-01T00:00:00.000000000",
    ServiceName: o.ServiceName ?? "claude-code",
    StatusCode: o.StatusCode ?? "",
    Duration: o.Duration ?? 1_000_000,
    AgentProject: o.AgentProject ?? "agent-observability",
    AgentSessionId: o.AgentSessionId ?? "agent-sess",
    AgentRunId: o.AgentRunId ?? "run",
    SessionId: o.SessionId ?? "sess",
    ProjectName: o.ProjectName ?? "proj",
    ResourceAttributesRaw: o.ResourceAttributesRaw ?? {},
    SpanAttributesRaw: o.SpanAttributesRaw ?? {},
    depth: o.depth ?? 0,
  };
}

function makeSession(o: {
  id: string;
  serviceName: string;
  hasError?: boolean;
  spanName?: string;
}): SessionGroup {
  const s = span({
    SpanId: `${o.id}-root`,
    SpanName: o.spanName ?? "claude_code.tool.bash",
    StatusCode: o.hasError ? "ERROR" : "",
  });
  return {
    id: o.id,
    sessionKey: o.id,
    displayLabel: o.id,
    serviceName: o.serviceName,
    projectName: "p",
    lastActivity: Date.now(),
    lastActivityText: "",
    spanCount: 1,
    traceCount: 1,
    durationSeconds: 0.001,
    hasError: !!o.hasError,
    traces: [
      {
        id: `${o.id}-t1`,
        traceId: `${o.id}-t1`,
        displayLabel: o.spanName ?? "claude_code.tool.bash",
        rootStart: Date.now(),
        rootStartText: "",
        lastActivity: Date.now(),
        lastActivityText: "",
        spanCount: 1,
        durationSeconds: 0.001,
        hasError: !!o.hasError,
        spans: [s],
      },
    ],
  };
}

describe("SessionSidebar", () => {
  it("renders one group header per distinct service.name", () => {
    const sessions = [
      makeSession({ id: "s1", serviceName: "claude-code" }),
      makeSession({ id: "s2", serviceName: "codex_exec" }),
      makeSession({ id: "s3", serviceName: "agent-obs-sdk" }),
    ];
    render(
      <SessionSidebar
        sessions={sessions}
        selectedSessionId={null}
        onSelect={() => undefined}
        nowMs={Date.now()}
      />,
    );
    expect(screen.getByText("claude-code")).toBeDefined();
    expect(screen.getByText("codex_exec")).toBeDefined();
    expect(screen.getByText("agent-obs-sdk")).toBeDefined();
  });

  it("renders empty-state placeholder when no sessions", () => {
    render(
      <SessionSidebar
        sessions={[]}
        selectedSessionId={null}
        onSelect={() => undefined}
        nowMs={Date.now()}
        emptyMessage="// awaiting"
      />,
    );
    expect(screen.getByText("// awaiting")).toBeDefined();
  });

  it("marks selected row with data-selected=true and aria-pressed=true", () => {
    const sessions = [
      makeSession({ id: "s1", serviceName: "claude-code" }),
      makeSession({ id: "s2", serviceName: "claude-code" }),
    ];
    render(
      <SessionSidebar
        sessions={sessions}
        selectedSessionId="s1"
        onSelect={() => undefined}
        nowMs={Date.now()}
      />,
    );
    const selected = document.querySelector('[data-session-id="s1"]');
    const other = document.querySelector('[data-session-id="s2"]');
    expect(selected?.getAttribute("data-selected")).toBe("true");
    expect(selected?.getAttribute("aria-pressed")).toBe("true");
    expect(other?.getAttribute("data-selected")).toBe("false");
    expect(other?.getAttribute("aria-pressed")).toBe("false");
  });

  it("error session renders status dot with aria-label 'error'", () => {
    const sessions = [
      makeSession({ id: "s1", serviceName: "claude-code", hasError: true }),
    ];
    render(
      <SessionSidebar
        sessions={sessions}
        selectedSessionId={null}
        onSelect={() => undefined}
        nowMs={Date.now()}
      />,
    );
    expect(screen.getByLabelText("error")).toBeDefined();
  });

  it("error session dot uses --accent-2 (NOT magenta --accent-1) to avoid colliding with selection bar", () => {
    const sessions = [
      makeSession({ id: "s1", serviceName: "claude-code", hasError: true }),
    ];
    render(
      <SessionSidebar
        sessions={sessions}
        selectedSessionId="s1"
        onSelect={() => undefined}
        nowMs={Date.now()}
      />,
    );
    const dot = screen.getByLabelText("error") as HTMLElement;
    const inline = dot.getAttribute("style") ?? "";
    expect(inline).toContain("var(--accent-2)");
    expect(inline).not.toContain("var(--accent-1)");
  });

  it("invokes onSelect with the session id when row clicked", () => {
    const onSelect = vi.fn();
    const sessions = [makeSession({ id: "abc", serviceName: "claude-code" })];
    render(
      <SessionSidebar
        sessions={sessions}
        selectedSessionId={null}
        onSelect={onSelect}
        nowMs={Date.now()}
      />,
    );
    const row = document.querySelector('[data-session-id="abc"]');
    expect(row).not.toBeNull();
    fireEvent.click(row as Element);
    expect(onSelect).toHaveBeenCalledWith("abc");
  });
});
