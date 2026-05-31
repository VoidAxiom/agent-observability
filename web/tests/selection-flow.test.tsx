/*
 * selection-flow.test.tsx — RTL exercise of App.tsx's selection
 * reconciliation against a mocked usePolledSpans hook. Contract
 * (post-VOI-346 codex rounds 1+5 — aggregate Details views must be
 * reachable for ANY session/trace, including the auto-promoted ones):
 *  - initial load auto-promotes first session + first trace; span is
 *    NOT auto-promoted so DetailsPane renders TRACE mode by default.
 *  - clicking a session ALWAYS clears trace+span (even when re-clicking
 *    the already-selected session) so DetailsPane can show SESSION
 *    aggregate. Trace pane re-populates with that session's traces
 *    but no trace is auto-selected.
 *  - clicking a trace ALWAYS clears span (even when re-clicking the
 *    already-selected trace) so DetailsPane can show TRACE aggregate.
 *  - clicking a span surfaces the span details.
 *  - a refresh that adds a new span keeps the user's explicit drill.
 *  - removing the selected session promotes the next-best per
 *    reconcileSelection's contract (and re-auto-promotes its first
 *    trace, since the session identity changed via data eviction).
 */

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { groupSpans, type SpanRow } from "../src/lib/grouping";
import type { PolledSpansState } from "../src/lib/usePolledSpans";

// Inject themes.css so getComputedStyle resolves cascade-driven tokens.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const THEMES_CSS_PATH = resolve(__dirname, "../src/themes.css");
beforeAll(() => {
  const css = readFileSync(THEMES_CSS_PATH, "utf-8");
  const style = document.createElement("style");
  style.setAttribute("data-test-themes", "true");
  style.textContent = css;
  document.head.appendChild(style);
});

let mockState: PolledSpansState = {
  sessions: [],
  nowMs: 0,
  error: null,
  loading: true,
  truncated: false,
};

vi.mock("../src/lib/usePolledSpans", () => ({
  usePolledSpans: () => mockState,
}));

// Import after mock so App picks up the stubbed hook.
import { App } from "../src/App";

afterEach(() => {
  cleanup();
  mockState = { sessions: [], nowMs: 0, error: null, loading: true, truncated: false };
});

function span(o: Partial<SpanRow> & { SpanId: string; TraceId: string; SessionId: string }): SpanRow {
  return {
    TraceId: o.TraceId,
    SpanId: o.SpanId,
    ParentSpanId: o.ParentSpanId ?? "",
    SpanName: o.SpanName ?? "claude_code.tool.bash",
    Timestamp: o.Timestamp ?? "2026-01-01T00:00:00.000000000",
    ServiceName: o.ServiceName ?? "claude-code",
    StatusCode: o.StatusCode ?? "",
    Duration: o.Duration ?? 1_000_000,
    AgentProject: o.AgentProject ?? "agent-observability",
    AgentSessionId: o.AgentSessionId ?? "agent-sess",
    AgentRunId: o.AgentRunId ?? "run",
    SessionId: o.SessionId,
    ProjectName: o.ProjectName ?? "proj",
    ResourceAttributesRaw: o.ResourceAttributesRaw ?? {},
    SpanAttributesRaw: o.SpanAttributesRaw ?? {},
    depth: 0,
  };
}

function setMock(rows: SpanRow[]): void {
  // Pin nowMs within the 5-minute "active" window relative to the fixture
  // timestamps (2026-01-01T00:0X:0Y...). The Live tab filter drops stale
  // sessions; selection-flow tests pre-date the tabs feature and assume
  // every fixture session is visible. Keeping nowMs at 00:01:30 leaves
  // sess1 (00:01:Y) ~30s old and sess2 (00:02:Y) ~30s in the future — both
  // resolve as "active" via activityStatus' ageSeconds <= 5*60 branch.
  mockState = {
    sessions: groupSpans(rows),
    nowMs: Date.UTC(2026, 0, 1, 0, 1, 30),
    error: null,
    loading: false,
    truncated: false,
  };
}

function fixtureRows(): SpanRow[] {
  // 2 sessions × 2 traces × 5 spans (the spec's mock contract).
  const rows: SpanRow[] = [];
  for (const sessionIdx of [1, 2]) {
    for (const traceIdx of [1, 2]) {
      const traceId = `sess${sessionIdx}-trace${traceIdx}`;
      for (let spanIdx = 1; spanIdx <= 5; spanIdx += 1) {
        rows.push(
          span({
            SessionId: `sess${sessionIdx}`,
            TraceId: traceId,
            SpanId: `${traceId}-span${spanIdx}`,
            ParentSpanId:
              spanIdx === 1 ? "" : `${traceId}-span${spanIdx - 1}`,
            SpanName: `claude_code.tool.step${spanIdx}`,
            Timestamp: `2026-01-01T00:0${sessionIdx}:0${traceIdx}.${String(spanIdx).padStart(3, "0")}000000`,
            Duration: 2_000_000,
          }),
        );
      }
    }
  }
  return rows;
}

describe("App selection flow", () => {
  it("loading state shows the awaiting placeholder", () => {
    mockState = { sessions: [], nowMs: 0, error: null, loading: true, truncated: false };
    render(<App />);
    // Both the subtitle and the sidebar empty-state render the same comment
    // text during the awaiting-load state; at least one is sufficient signal.
    expect(
      screen.getAllByText("// awaiting spans from ClickHouse...").length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("auto-promotes first session and first trace on initial data load (no span)", () => {
    setMock(fixtureRows());
    render(<App />);
    // Per VOI-346 contract: initial load promotes session + first trace.
    // Span is NOT auto-promoted so DetailsPane renders TRACE mode.
    const selectedSession = document.querySelectorAll(
      '[data-session-id][data-selected="true"]',
    );
    const selectedTrace = document.querySelectorAll(
      '[data-trace-id][data-selected="true"]',
    );
    const selectedSpan = document.querySelectorAll(
      '[data-span-id][data-selected="true"]',
    );
    expect(selectedSession.length).toBe(1);
    expect(selectedTrace.length).toBe(1);
    expect(selectedSpan.length).toBe(0);
  });

  it("clicking a second session swaps the trace pane and clears trace/span (SESSION mode)", () => {
    setMock(fixtureRows());
    render(<App />);
    const sessionButtons = document.querySelectorAll(
      "[data-session-id]",
    ) as NodeListOf<HTMLButtonElement>;
    expect(sessionButtons.length).toBe(2);
    const firstSessionId = sessionButtons[0]!.getAttribute("data-session-id");
    const secondSessionId = sessionButtons[1]!.getAttribute("data-session-id");
    expect(firstSessionId).not.toBe(secondSessionId);

    fireEvent.click(sessionButtons[1]!);
    const stillSelected = document.querySelector(
      `[data-session-id="${secondSessionId}"]`,
    );
    expect(stillSelected?.getAttribute("data-selected")).toBe("true");
    // Per VOI-346 contract: user-initiated session change clears trace
    // and span so DetailsPane renders SESSION mode. The middle pane
    // still re-renders with the new session's traces — but none are
    // pre-selected.
    const selectedTraces = document.querySelectorAll(
      '[data-trace-id][data-selected="true"]',
    );
    expect(selectedTraces.length).toBe(0);
    const visibleTraces = document.querySelectorAll("[data-trace-id]");
    // The new session has 2 traces; both render.
    expect(visibleTraces.length).toBe(2);
  });

  it("clicking a trace updates the span tree", () => {
    setMock(fixtureRows());
    render(<App />);
    const traceButtons = document.querySelectorAll(
      "[data-trace-id]",
    ) as NodeListOf<HTMLButtonElement>;
    // First session has 2 traces.
    expect(traceButtons.length).toBe(2);
    fireEvent.click(traceButtons[1]!);
    const selectedTraceId = traceButtons[1]!.getAttribute("data-trace-id");
    expect(
      document
        .querySelector(`[data-trace-id="${selectedTraceId}"]`)
        ?.getAttribute("data-selected"),
    ).toBe("true");
    // SpanTree shows the newly selected trace's spans (5).
    const spanRows = document.querySelectorAll("[data-span-id]");
    expect(spanRows.length).toBe(5);
  });

  it("selection survives a refresh that adds one new span", () => {
    setMock(fixtureRows());
    const { rerender } = render(<App />);

    // Drill into a specific span — initial load only auto-promotes
    // session + trace, never span (VOI-346 contract), so a user-click
    // is required to establish a span pin worth preserving.
    const spanButtons = document.querySelectorAll(
      "[data-span-id]",
    ) as NodeListOf<HTMLButtonElement>;
    fireEvent.click(spanButtons[2]!);

    const before = document.querySelector(
      '[data-session-id][data-selected="true"]',
    );
    const beforeSessionId = before?.getAttribute("data-session-id") ?? null;
    expect(beforeSessionId).not.toBeNull();
    const beforeTrace = document
      .querySelector('[data-trace-id][data-selected="true"]')
      ?.getAttribute("data-trace-id");
    expect(beforeTrace).not.toBeNull();
    const beforeSpan = document
      .querySelector('[data-span-id][data-selected="true"]')
      ?.getAttribute("data-span-id");
    expect(beforeSpan).not.toBeNull();

    // Refresh with one extra span on the SAME trace.
    const extended = [
      ...fixtureRows(),
      span({
        SessionId: "sess1",
        TraceId: "sess1-trace1",
        SpanId: "sess1-trace1-spanX",
        ParentSpanId: "sess1-trace1-span1",
        SpanName: "claude_code.tool.step-new",
        Timestamp: "2026-01-01T00:01:01.999000000",
        Duration: 2_000_000,
      }),
    ];
    act(() => {
      setMock(extended);
      rerender(<App />);
    });

    expect(
      document
        .querySelector(`[data-session-id="${beforeSessionId}"]`)
        ?.getAttribute("data-selected"),
    ).toBe("true");
    expect(
      document
        .querySelector(`[data-trace-id="${beforeTrace}"]`)
        ?.getAttribute("data-selected"),
    ).toBe("true");
    expect(
      document
        .querySelector(`[data-span-id="${beforeSpan}"]`)
        ?.getAttribute("data-selected"),
    ).toBe("true");
  });

  it("re-clicking the currently-selected session clears descendants (SESSION mode reachable)", () => {
    // Contract per codex round-5 P2 2026-05-30: re-clicking an
    // already-selected session must clear trace+span so DetailsPane
    // can render SESSION mode. Initial load auto-promotes the first
    // trace, so without this the user has no way to reach SESSION mode
    // for the auto-promoted session without navigating away.
    setMock(fixtureRows());
    render(<App />);
    // Drill into a specific trace + span beyond the auto-promoted defaults.
    const traceButtons = document.querySelectorAll(
      "[data-trace-id]",
    ) as NodeListOf<HTMLButtonElement>;
    fireEvent.click(traceButtons[1]!); // second trace
    const spanButtons = document.querySelectorAll(
      "[data-span-id]",
    ) as NodeListOf<HTMLButtonElement>;
    fireEvent.click(spanButtons[3]!); // deep span

    const heldTraceId = traceButtons[1]!.getAttribute("data-trace-id");
    const heldSpanId = spanButtons[3]!.getAttribute("data-span-id");

    const selectedSession = document.querySelector(
      '[data-session-id][data-selected="true"]',
    ) as HTMLButtonElement;
    fireEvent.click(selectedSession);

    // Trace + span are cleared so DetailsPane shows SESSION aggregate.
    // After clearing, the trace is still in the trace list (the middle
    // pane re-renders the session's traces) but not marked selected; the
    // spans may not be rendered at all (their trace may not be expanded),
    // which also satisfies the contract "the held span is no longer
    // marked selected anywhere."
    expect(
      document
        .querySelector(`[data-trace-id="${heldTraceId}"]`)
        ?.getAttribute("data-selected"),
    ).toBe("false");
    expect(
      document.querySelectorAll('[data-trace-id][data-selected="true"]').length,
    ).toBe(0);
    // Silence the unused-variable lint while still documenting which
    // span we drilled into above for context.
    void heldSpanId;
    expect(
      document.querySelectorAll('[data-span-id][data-selected="true"]').length,
    ).toBe(0);
  });

  it("re-clicking the currently-selected trace clears the span (TRACE mode reachable)", () => {
    // Symmetric with the session-reclick contract: re-clicking a selected
    // trace clears the span so DetailsPane can show TRACE aggregate.
    setMock(fixtureRows());
    render(<App />);
    const spanButtons = document.querySelectorAll(
      "[data-span-id]",
    ) as NodeListOf<HTMLButtonElement>;
    fireEvent.click(spanButtons[2]!);
    const heldSpanId = spanButtons[2]!.getAttribute("data-span-id");

    const selectedTrace = document.querySelector(
      '[data-trace-id][data-selected="true"]',
    ) as HTMLButtonElement;
    fireEvent.click(selectedTrace);

    // Span cleared but selectedSpanId may appear in BOTH the trace list
    // AND the waterfall under the same data-span-id — assert the held
    // selection is no longer marked selected anywhere.
    expect(
      document
        .querySelector(`[data-span-id="${heldSpanId}"]`)
        ?.getAttribute("data-selected"),
    ).toBe("false");
    expect(
      document.querySelectorAll('[data-span-id][data-selected="true"]').length,
    ).toBe(0);
  });

  it("selecting a subagent node scopes the middle pane to ONLY that subagent's spans (VOI-386)", () => {
    // Build a claude session with one dispatched subagent. The subagent
    // owns 2 spans (sub-w-1, sub-w-2); the claude root owns the other 2.
    // Selecting the subagent in the sidebar should narrow the trace pane
    // to only the spans owned by the subagent — not the parent's spans.
    const rows: SpanRow[] = [
      span({
        SessionId: "sess-T",
        TraceId: "claude-trace",
        SpanId: "root",
        SpanName: "claude_code.tool.bash",
        Timestamp: "2026-01-01T00:01:01.000000000",
      }),
      span({
        SessionId: "sess-T",
        TraceId: "claude-trace",
        SpanId: "dispatch",
        ParentSpanId: "root",
        SpanName: "claude_code.tool.task",
        Timestamp: "2026-01-01T00:01:02.000000000",
        SpanAttributesRaw: { subagent_type: "ui-implementer" },
      }),
      span({
        SessionId: "sess-T",
        TraceId: "claude-trace",
        SpanId: "sub-w-1",
        ParentSpanId: "dispatch",
        SpanName: "claude_code.tool.edit",
        Timestamp: "2026-01-01T00:01:03.000000000",
        SpanAttributesRaw: { agent_id: "sub-agent-T" },
      }),
      span({
        SessionId: "sess-T",
        TraceId: "claude-trace",
        SpanId: "sub-w-2",
        ParentSpanId: "sub-w-1",
        SpanName: "claude_code.tool.write",
        Timestamp: "2026-01-01T00:01:04.000000000",
        SpanAttributesRaw: { agent_id: "sub-agent-T" },
      }),
    ];
    setMock(rows);
    render(<App />);
    // The subagent node id is `sess-T::subagent::sub-agent-T` per
    // grouping.ts. Click it.
    const subagentId = "sess-T::subagent::sub-agent-T";
    const subagentRow = document.querySelector(
      `[data-session-id="${subagentId}"]`,
    ) as HTMLButtonElement | null;
    expect(subagentRow).not.toBeNull();
    fireEvent.click(subagentRow!);

    // The selected session is the subagent.
    expect(
      document
        .querySelector('[data-session-id][data-selected="true"]')
        ?.getAttribute("data-session-id"),
    ).toBe(subagentId);

    // The middle pane (CollapsibleTraceList) shows only the trace from
    // the subagent's owned spans. Auto-promotion picks the first trace
    // but does NOT expand it, so the span rows aren't rendered until the
    // user clicks the chevron. Expand the auto-promoted trace and assert
    // its span list contains the subagent's spans and excludes the
    // claude-owned root + dispatch.
    const chevron = document.querySelector(
      '[data-testid^="voi-chevron-"]',
    ) as HTMLButtonElement | null;
    expect(chevron).not.toBeNull();
    fireEvent.click(chevron!);

    const traceSpanList = document.querySelector(
      '[data-testid^="voi-spans-"]',
    );
    expect(traceSpanList).not.toBeNull();
    const visibleSpanIds = Array.from(
      traceSpanList!.querySelectorAll("[data-span-id]"),
    ).map((el) => el.getAttribute("data-span-id"));
    expect(visibleSpanIds).toContain("claude-tracesub-w-1");
    expect(visibleSpanIds).toContain("claude-tracesub-w-2");
    expect(visibleSpanIds).not.toContain("claude-traceroot");
    expect(visibleSpanIds).not.toContain("claude-tracedispatch");
  });

  it("Live header + tab counter count only SELF-active nodes (codex P2 2026-05-31)", () => {
    // filterActive retains a stale claude root when a subagent descendant
    // is still active so the operator can drill in via the parent. The
    // header subtitle and the tab counter must count ONLY nodes whose own
    // activityStatus === "active" — otherwise the totals disagree with
    // the row status dots (a stale claude root rendered alongside its
    // active child should be 1 active, not 2).
    //
    // Fixture: claude root last-active 10 min ago (stale), one subagent
    // descendant last-active 30s ago (active). nowMs pinned at 00:11:00.
    const rows: SpanRow[] = [
      span({
        SessionId: "sess-stale-root",
        TraceId: "trace-A",
        SpanId: "root",
        SpanName: "claude_code.tool.bash",
        Timestamp: "2026-01-01T00:01:00.000000000",
      }),
      span({
        SessionId: "sess-stale-root",
        TraceId: "trace-A",
        SpanId: "dispatch",
        ParentSpanId: "root",
        SpanName: "claude_code.tool.task",
        Timestamp: "2026-01-01T00:01:01.000000000",
        SpanAttributesRaw: { subagent_type: "implementer" },
      }),
      span({
        SessionId: "sess-stale-root",
        TraceId: "trace-A",
        SpanId: "sub-live",
        ParentSpanId: "dispatch",
        SpanName: "claude_code.tool.edit",
        Timestamp: "2026-01-01T00:10:30.000000000",
        SpanAttributesRaw: { agent_id: "sub-agent-live" },
      }),
    ];
    mockState = {
      sessions: groupSpans(rows),
      // 30s after sub-live → child is active (≤5min); root last seen
      // 10min ago → stale. nowMs = 00:11:00.
      nowMs: Date.UTC(2026, 0, 1, 0, 11, 0),
      error: null,
      loading: false,
      truncated: false,
    };
    render(<App />);

    // Both root and child render in the sidebar (root retained as
    // context for its active descendant), but the active count is 1.
    const subtitle = screen.getByText(/^\/\/ live · \d+ of \d+ sessions active$/);
    expect(subtitle.textContent).toBe("// live · 1 of 2 sessions active");

    // The tab counter mirrors the subtitle's active count.
    const liveBtn = screen.getByRole("button", { name: /Live/ });
    expect(liveBtn.textContent).toContain("1");
  });

  it("removing the selected session promotes the next-best deterministically", () => {
    setMock(fixtureRows());
    const { rerender } = render(<App />);
    const beforeId = document
      .querySelector('[data-session-id][data-selected="true"]')
      ?.getAttribute("data-session-id");
    expect(beforeId).not.toBeNull();

    // Refresh with only sess2's rows; sess1 is gone.
    const remaining = fixtureRows().filter((r) => r.SessionId !== beforeId);
    act(() => {
      setMock(remaining);
      rerender(<App />);
    });

    const sessionButtons = document.querySelectorAll("[data-session-id]");
    expect(sessionButtons.length).toBe(1);
    const nextSelected = document
      .querySelector('[data-session-id][data-selected="true"]')
      ?.getAttribute("data-session-id");
    expect(nextSelected).not.toBeNull();
    expect(nextSelected).not.toBe(beforeId);
  });
});
