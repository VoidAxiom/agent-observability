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

import type { SessionKind, SessionNode } from "../src/lib/grouping";

function makeSession(o: {
  id: string;
  serviceName: string;
  hasError?: boolean;
  spanName?: string;
  kind?: SessionKind;
  parentId?: string | null;
  children?: SessionNode[];
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
    // VOI-386 tree fields. Default flat; tests that need nesting pass
    // explicit `children` so the forest assembles as expected.
    kind: o.kind ?? "claude",
    parentId: o.parentId ?? null,
    children: o.children ?? [],
    spans: [s],
    descendantSpanCount: 0,
    descendantHasError: false,
  };
}

const NOOP_TOGGLE = () => undefined;
const EMPTY_EXPANDED: ReadonlySet<string> = new Set<string>();

describe("SessionSidebar", () => {
  it("renders a kind chip per node — replaces VOI-346 bucket-by-service headers (VOI-386)", () => {
    // The pre-VOI-386 sidebar grouped roots under serviceName headers
    // (claude-code / codex_exec / agent-obs-sdk). The forest now nests by
    // tree topology, and the per-row kind chip carries the same visual
    // signal. Assert the chip element exists for each kind.
    const sessions = [
      makeSession({ id: "s1", serviceName: "claude-code", kind: "claude" }),
      makeSession({ id: "s2", serviceName: "codex_exec", kind: "codex" }),
      makeSession({ id: "s3", serviceName: "agent-obs-sdk", kind: "claude" }),
    ];
    const { container } = render(
      <SessionSidebar
        sessions={sessions}
        selectedSessionId={null}
        onSelect={() => undefined}
        expandedNodeIds={EMPTY_EXPANDED as Set<string>}
        onToggleExpand={NOOP_TOGGLE}
        nowMs={Date.now()}
      />,
    );
    expect(container.querySelector('[data-kind-chip="claude"]')).not.toBeNull();
    expect(container.querySelector('[data-kind-chip="codex"]')).not.toBeNull();
  });

  it("renders empty-state placeholder when no sessions", () => {
    render(
      <SessionSidebar
        sessions={[]}
        selectedSessionId={null}
        onSelect={() => undefined}
        expandedNodeIds={EMPTY_EXPANDED as Set<string>}
        onToggleExpand={NOOP_TOGGLE}
        nowMs={Date.now()}
        emptyMessage="// awaiting"
      />,
    );
    expect(screen.getByText("// awaiting")).toBeDefined();
  });

  it("marks selected row with data-selected=true and aria-current=true (single-select semantic)", () => {
    // Contract updated per codex round-4 P1 2026-05-30: single-select
    // session list uses aria-current, not aria-pressed. aria-pressed
    // would announce each row as a per-row toggle to screen-readers,
    // which doesn't match the interaction (the click flips the global
    // selectedSessionId, not the row's own state).
    const sessions = [
      makeSession({ id: "s1", serviceName: "claude-code" }),
      makeSession({ id: "s2", serviceName: "claude-code" }),
    ];
    render(
      <SessionSidebar
        sessions={sessions}
        selectedSessionId="s1"
        onSelect={() => undefined}
        expandedNodeIds={EMPTY_EXPANDED as Set<string>}
        onToggleExpand={NOOP_TOGGLE}
        nowMs={Date.now()}
      />,
    );
    const selected = document.querySelector('[data-session-id="s1"]');
    const other = document.querySelector('[data-session-id="s2"]');
    expect(selected?.getAttribute("data-selected")).toBe("true");
    expect(selected?.getAttribute("aria-current")).toBe("true");
    expect(selected?.getAttribute("aria-pressed")).toBeNull();
    expect(other?.getAttribute("data-selected")).toBe("false");
    expect(other?.getAttribute("aria-current")).toBeNull();
    expect(other?.getAttribute("aria-pressed")).toBeNull();
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
        expandedNodeIds={EMPTY_EXPANDED as Set<string>}
        onToggleExpand={NOOP_TOGGLE}
        nowMs={Date.now()}
      />,
    );
    expect(screen.getByLabelText("error")).toBeDefined();
  });

  it("parent row surfaces error when ONLY a descendant has errored (codex P2 2026-05-31)", () => {
    // descendantHasError is rolled up by finalizeSubtree + sessionsFilter
    // so a collapsed parent's status dot still tells the operator that
    // work failed one level down. Without this, an error in a subagent
    // or codex child stays silent behind the parent's normal dot.
    const childErr: SessionGroup = {
      ...makeSession({ id: "child", serviceName: "claude-code", hasError: true }),
      kind: "subagent",
      parentId: "parent",
    };
    const parent: SessionGroup = {
      ...makeSession({ id: "parent", serviceName: "claude-code" }),
      // Parent itself has no error; the rolled-up flag is what carries
      // the failure signal up the tree.
      hasError: false,
      descendantHasError: true,
      children: [childErr],
    };
    render(
      <SessionSidebar
        sessions={[parent]}
        selectedSessionId={null}
        onSelect={() => undefined}
        expandedNodeIds={EMPTY_EXPANDED as Set<string>}
        onToggleExpand={NOOP_TOGGLE}
        nowMs={Date.now()}
      />,
    );
    // The parent row's status dot uses the error variant. The child is
    // collapsed by default, so the only error dot visible without
    // expansion is the parent's — scope the assertion to the parent's
    // own row.
    const parentRow = document.querySelector(
      '[data-session-id="parent"]',
    ) as HTMLElement | null;
    expect(parentRow).not.toBeNull();
    const parentErrDot = parentRow!.querySelector('[aria-label="error"]');
    expect(parentErrDot).not.toBeNull();
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
        expandedNodeIds={EMPTY_EXPANDED as Set<string>}
        onToggleExpand={NOOP_TOGGLE}
        nowMs={Date.now()}
      />,
    );
    const dot = screen.getByLabelText("error") as HTMLElement;
    const inline = dot.getAttribute("style") ?? "";
    expect(inline).toContain("var(--accent-2)");
    expect(inline).not.toContain("var(--accent-1)");
  });

  it("renders the truncation chip when truncated=true (VOI-382)", () => {
    // The chip is the operator-visible signal that the polling query hit
    // its row-count safety ceiling; absent → operator wouldn't know older
    // sessions might be missing from the list. Selector is the structural
    // data-truncation-chip attribute so the visible text can be tweaked
    // without breaking the test.
    const sessions = [makeSession({ id: "abc", serviceName: "claude-code" })];
    const { container } = render(
      <SessionSidebar
        sessions={sessions}
        selectedSessionId={null}
        onSelect={() => undefined}
        expandedNodeIds={EMPTY_EXPANDED as Set<string>}
        onToggleExpand={NOOP_TOGGLE}
        nowMs={Date.now()}
        truncated={true}
      />,
    );
    const chip = container.querySelector('[data-truncation-chip="true"]');
    expect(chip).not.toBeNull();
    expect(chip?.textContent ?? "").toMatch(/truncated/i);
    // Chip leads with the repo-standard CH_* name (matches .env.example,
    // migrate.sh, docker-compose, Swift app). VITE_* fallback lives in
    // the title hover.
    expect(chip?.textContent ?? "").toMatch(/CH_QUERY_LIMIT_CEILING/);
    expect(chip?.textContent ?? "").not.toMatch(/VITE_CH_QUERY_LIMIT_CEILING/);
  });

  it("renders the truncation chip in the EMPTY-state path too — the diagnostic case the chip exists to surface", () => {
    // Regression: /code-review round-2 P2 2026-05-30. The empty-state
    // early-return previously hid the chip in the very situation that
    // most needs it: CH returns 50k rows but none have a usable
    // SessionId so groupSpans collapses to zero sessions; truncated=true
    // but sidebar would short-circuit to "// awaiting" with zero signal
    // that the cap was hit.
    const { container } = render(
      <SessionSidebar
        sessions={[]}
        selectedSessionId={null}
        onSelect={() => undefined}
        expandedNodeIds={EMPTY_EXPANDED as Set<string>}
        onToggleExpand={NOOP_TOGGLE}
        nowMs={Date.now()}
        emptyMessage="// no sessions"
        truncated={true}
      />,
    );
    const chip = container.querySelector('[data-truncation-chip="true"]');
    expect(chip).not.toBeNull();
    expect(chip?.textContent ?? "").toMatch(/CH_QUERY_LIMIT_CEILING/);
  });

  it("does NOT render the truncation chip when truncated is false or omitted", () => {
    const sessions = [makeSession({ id: "abc", serviceName: "claude-code" })];
    // Default omitted prop.
    const r1 = render(
      <SessionSidebar
        sessions={sessions}
        selectedSessionId={null}
        onSelect={() => undefined}
        expandedNodeIds={EMPTY_EXPANDED as Set<string>}
        onToggleExpand={NOOP_TOGGLE}
        nowMs={Date.now()}
      />,
    );
    expect(
      r1.container.querySelector('[data-truncation-chip="true"]'),
    ).toBeNull();
    r1.unmount();
    // Explicit false.
    const r2 = render(
      <SessionSidebar
        sessions={sessions}
        selectedSessionId={null}
        onSelect={() => undefined}
        expandedNodeIds={EMPTY_EXPANDED as Set<string>}
        onToggleExpand={NOOP_TOGGLE}
        nowMs={Date.now()}
        truncated={false}
      />,
    );
    expect(
      r2.container.querySelector('[data-truncation-chip="true"]'),
    ).toBeNull();
  });

  it("renders absolute EST/EDT last-activity time on each row + title carries the date (VOI-389)", () => {
    // Pin lastActivity to a deterministic UTC instant so the assertion
    // doesn't depend on Date.now() timing. July 15 2026 14:32:47 UTC ->
    // 10:32:47 AM EDT in America/New_York.
    const lastActivityMs = Date.UTC(2026, 6, 15, 14, 32, 47);
    const s = makeSession({ id: "abc", serviceName: "claude-code" });
    s.lastActivity = lastActivityMs;
    const { container } = render(
      <SessionSidebar
        sessions={[s]}
        selectedSessionId={null}
        onSelect={() => undefined}
        expandedNodeIds={EMPTY_EXPANDED as Set<string>}
        onToggleExpand={NOOP_TOGGLE}
        nowMs={lastActivityMs + 5000}
      />,
    );
    // The row meta line carries the absolute clock time.
    const timeMeta = container.querySelector('[data-meta-time="true"]');
    expect(timeMeta?.textContent ?? "").toContain("10:32:47 AM EDT");
    // The row button's data-tooltip carries the date+time + relative age
    // so the operator can correlate across days without losing the
    // relative form. We use data-tooltip (the project's CSS-styled
    // tooltip channel) rather than native title to avoid two-tier
    // flicker against the inner label span's existing data-tooltip.
    const row = container.querySelector('[data-session-id="abc"]') as HTMLElement;
    const tooltip = row.getAttribute("data-tooltip") ?? "";
    expect(tooltip).toMatch(/Jul 15, 10:32:47 AM EDT/);
    expect(tooltip).toContain("5s ago");
  });

  it("sentinel-guards lastActivity: DISTANT_PAST renders '--' meta + 'unknown' title (P1 2026-05-31)", () => {
    // Codex /code-review flagged the leak: session.lastActivity === -8.64e15
    // makes ageSeconds ~8.64e12 and the title becomes "last_activity --
    // (8640000000000s ago)". The guard collapses both the meta line's
    // value and the title to a clean "unknown" string when the time is
    // not real.
    const s = makeSession({ id: "stale", serviceName: "claude-code" });
    s.lastActivity = -8.64e15;
    const { container } = render(
      <SessionSidebar
        sessions={[s]}
        selectedSessionId={null}
        onSelect={() => undefined}
        expandedNodeIds={EMPTY_EXPANDED as Set<string>}
        onToggleExpand={NOOP_TOGGLE}
        nowMs={Date.now()}
      />,
    );
    const timeMeta = container.querySelector('[data-meta-time="true"]');
    expect(timeMeta?.textContent ?? "").toBe("// last --");
    const row = container.querySelector('[data-session-id="stale"]') as HTMLElement;
    const tooltip = row.getAttribute("data-tooltip") ?? "";
    expect(tooltip).toBe("last_activity unknown");
    // The garbage value MUST NOT appear anywhere in the rendered DOM.
    expect(container.textContent ?? "").not.toContain("8640000000000");
  });

  it("invokes onSelect with the session id when row clicked", () => {
    const onSelect = vi.fn();
    const sessions = [makeSession({ id: "abc", serviceName: "claude-code" })];
    render(
      <SessionSidebar
        sessions={sessions}
        selectedSessionId={null}
        onSelect={onSelect}
        expandedNodeIds={EMPTY_EXPANDED as Set<string>}
        onToggleExpand={NOOP_TOGGLE}
        nowMs={Date.now()}
      />,
    );
    const row = document.querySelector('[data-session-id="abc"]');
    expect(row).not.toBeNull();
    fireEvent.click(row as Element);
    expect(onSelect).toHaveBeenCalledWith("abc");
  });
});
