/*
 * tabs — pins LiveHistoryTabs UI + URL hash sync + filterActive behavior.
 *  - Click History → aria-current="page" on History, URL hash → `#history`.
 *  - filterActive only retains sessions whose activityStatus === 'active'
 *    (5-minute window via lastActivity timestamp + nowMs).
 *
 * Note (codex round-5 P1 2026-05-30): LiveHistoryTabs is deliberately
 * NOT a WAI-ARIA tablist — see the component's file header. The single-
 * select semantic uses aria-current="page" matching session/trace/span
 * rows, not role=tab/aria-selected (which would obligate full arrow-key
 * navigation + roving tabIndex + a role=tabpanel target).
 */

import { afterEach, describe, expect, it } from "vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  LiveHistoryTabs,
  type TabKey,
} from "../src/components/LiveHistoryTabs";
import { filterActive } from "../src/lib/sessionsFilter";
import type { SessionGroup } from "../src/lib/grouping";

function session(id: string, lastActivity: number): SessionGroup {
  return {
    id,
    sessionKey: id,
    displayLabel: id,
    serviceName: "claude-code",
    projectName: "proj",
    lastActivity,
    lastActivityText: "",
    spanCount: 1,
    traceCount: 1,
    durationSeconds: 0,
    hasError: false,
    traces: [],
  };
}

function TabsHarness({ initial }: { initial: TabKey }) {
  const [tab, setTab] = useState<TabKey>(initial);
  return (
    <LiveHistoryTabs
      active={tab}
      onChange={(t) => {
        setTab(t);
        window.location.hash = `#${t}`;
      }}
      activeCount={3}
      totalCount={10}
    />
  );
}

afterEach(() => {
  cleanup();
  window.location.hash = "";
});

describe("LiveHistoryTabs", () => {
  it("clicking History activates the History button and writes #history to the URL hash", () => {
    render(<TabsHarness initial="live" />);
    const liveBtn = screen.getByRole("button", { name: /Live/ });
    const historyBtn = screen.getByRole("button", { name: /History/ });
    expect(liveBtn.getAttribute("aria-current")).toBe("page");
    expect(historyBtn.getAttribute("aria-current")).toBeNull();

    fireEvent.click(historyBtn);

    expect(liveBtn.getAttribute("aria-current")).toBeNull();
    expect(historyBtn.getAttribute("aria-current")).toBe("page");
    expect(window.location.hash).toBe("#history");
  });

  it("clicking Live activates the Live button", () => {
    render(<TabsHarness initial="history" />);
    const liveBtn = screen.getByRole("button", { name: /Live/ });
    expect(liveBtn.getAttribute("aria-current")).toBeNull();
    fireEvent.click(liveBtn);
    expect(liveBtn.getAttribute("aria-current")).toBe("page");
    expect(window.location.hash).toBe("#live");
  });

  it("each button carries a data-tooltip with its explanatory hint", () => {
    render(<TabsHarness initial="live" />);
    const liveBtn = screen.getByRole("button", { name: /Live/ });
    const historyBtn = screen.getByRole("button", { name: /History/ });
    expect(liveBtn.getAttribute("data-tooltip")).toContain("5-min");
    expect(historyBtn.getAttribute("data-tooltip")).toContain("all sessions");
  });

  it("renders as a <nav> (button group) — NOT a WAI-ARIA tablist", () => {
    // Asserting the architectural decision so a future contributor
    // doesn't reintroduce role=tab/aria-selected without the matching
    // arrow-key + roving-tabIndex contract.
    render(<TabsHarness initial="live" />);
    expect(document.querySelector('[role="tablist"]')).toBeNull();
    expect(document.querySelectorAll('[role="tab"]').length).toBe(0);
    expect(document.querySelector('nav[aria-label="Sessions filter"]')).not.toBeNull();
  });
});

describe("filterActive", () => {
  it("keeps only sessions whose activityStatus is 'active' (≤5 min)", () => {
    const now = 10_000_000; // arbitrary ms
    const active = session("a", now - 60_000); // 1 min ago
    const idle = session("b", now - 10 * 60_000); // 10 min ago → idle
    const stale = session("c", now - 2 * 60 * 60_000); // 2 h ago → stale
    const result = filterActive([active, idle, stale], now);
    expect(result.map((s) => s.id)).toEqual(["a"]);
  });

  it("returns an empty array when no session is active", () => {
    const now = 10_000_000;
    const idle = session("b", now - 10 * 60_000);
    expect(filterActive([idle], now)).toEqual([]);
  });

  it("returns input order for multiple active sessions", () => {
    const now = 10_000_000;
    const a = session("a", now - 1000);
    const b = session("b", now - 2000);
    const c = session("c", now - 3000);
    const result = filterActive([a, b, c], now);
    expect(result.map((s) => s.id)).toEqual(["a", "b", "c"]);
  });
});
