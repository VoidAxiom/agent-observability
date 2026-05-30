/*
 * tabs — pins LiveHistoryTabs UI + URL hash sync + filterActive behavior.
 *  - Click History → tab aria-selected=true on History, URL hash becomes
 *    `#history`.
 *  - filterActive only retains sessions whose activityStatus === 'active'
 *    (5-minute window via lastActivity timestamp + nowMs).
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
  it("clicking History activates the History tab and writes #history to the URL hash", () => {
    render(<TabsHarness initial="live" />);
    const liveBtn = screen.getByRole("tab", { name: /Live/ });
    const historyBtn = screen.getByRole("tab", { name: /History/ });
    expect(liveBtn.getAttribute("aria-selected")).toBe("true");
    expect(historyBtn.getAttribute("aria-selected")).toBe("false");

    fireEvent.click(historyBtn);

    expect(liveBtn.getAttribute("aria-selected")).toBe("false");
    expect(historyBtn.getAttribute("aria-selected")).toBe("true");
    expect(window.location.hash).toBe("#history");
  });

  it("clicking Live activates the Live tab", () => {
    render(<TabsHarness initial="history" />);
    const liveBtn = screen.getByRole("tab", { name: /Live/ });
    expect(liveBtn.getAttribute("aria-selected")).toBe("false");
    fireEvent.click(liveBtn);
    expect(liveBtn.getAttribute("aria-selected")).toBe("true");
    expect(window.location.hash).toBe("#live");
  });

  it("each tab carries a data-tooltip with its explanatory hint", () => {
    render(<TabsHarness initial="live" />);
    const liveBtn = screen.getByRole("tab", { name: /Live/ });
    const historyBtn = screen.getByRole("tab", { name: /History/ });
    expect(liveBtn.getAttribute("data-tooltip")).toContain("5-min");
    expect(historyBtn.getAttribute("data-tooltip")).toContain("all sessions");
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
