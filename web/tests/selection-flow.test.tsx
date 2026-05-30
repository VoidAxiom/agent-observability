/*
 * selection-flow.test.tsx — RTL exercise of App.tsx's selection
 * reconciliation against a mocked usePolledSpans hook. Confirms:
 *  - first session/trace/span auto-promote when none selected;
 *  - clicking a session reveals its traces;
 *  - clicking a trace reveals its span tree;
 *  - a refresh that adds a new span keeps the prior selection;
 *  - removing the selected session promotes the next-best per
 *    reconcileSelection's contract.
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
};

vi.mock("../src/lib/usePolledSpans", () => ({
  usePolledSpans: () => mockState,
}));

// Import after mock so App picks up the stubbed hook.
import { App } from "../src/App";

afterEach(() => {
  cleanup();
  mockState = { sessions: [], nowMs: 0, error: null, loading: true };
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
  mockState = {
    sessions: groupSpans(rows),
    nowMs: Date.UTC(2026, 0, 2),
    error: null,
    loading: false,
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
    mockState = { sessions: [], nowMs: 0, error: null, loading: true };
    render(<App />);
    // Both the subtitle and the sidebar empty-state render the same comment
    // text during the awaiting-load state; at least one is sufficient signal.
    expect(
      screen.getAllByText("// awaiting spans from ClickHouse...").length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("auto-promotes first session, trace, and span on initial data load", () => {
    setMock(fixtureRows());
    render(<App />);
    // Selected session, trace, and span buttons all carry data-selected=true.
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
    expect(selectedSpan.length).toBe(1);
  });

  it("clicking a second session swaps traces in the middle pane", () => {
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
    // Trace pane re-promotes to the new session's first trace.
    const selectedTraces = document.querySelectorAll(
      '[data-trace-id][data-selected="true"]',
    );
    expect(selectedTraces.length).toBe(1);
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

  it("re-clicking the currently-selected session preserves the trace+span pick", () => {
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

    expect(
      document
        .querySelector(`[data-trace-id="${heldTraceId}"]`)
        ?.getAttribute("data-selected"),
    ).toBe("true");
    expect(
      document
        .querySelector(`[data-span-id="${heldSpanId}"]`)
        ?.getAttribute("data-selected"),
    ).toBe("true");
  });

  it("re-clicking the currently-selected trace preserves the span pick", () => {
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

    expect(
      document
        .querySelector(`[data-span-id="${heldSpanId}"]`)
        ?.getAttribute("data-selected"),
    ).toBe("true");
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
