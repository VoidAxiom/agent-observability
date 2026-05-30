/*
 * LiveHistoryTabs — top-header tab strip that switches the sessions
 * sidebar between the 5-min-window "Live" filter and the unfiltered
 * "History" view.
 *
 * State + URL hash:
 *  - The active tab is the source of truth in App.tsx (lifted state), so
 *    children that depend on it (SessionSidebar, empty messages) can re-
 *    render without prop drilling through 3 levels.
 *  - The tab persists in `window.location.hash` (`#live` / `#history`) so
 *    a page reload restores. On mount the parent reads the hash; on tab
 *    click the parent writes it via setter callback.
 *
 * A11y:
 *  - This is intentionally NOT a WAI-ARIA tablist. The full tablist
 *    pattern requires arrow-key navigation + roving tabIndex + a
 *    role=tabpanel target — we don't want any of those obligations
 *    here (the panel is the entire `<main>` landmark, not a dedicated
 *    tabpanel; and the tab strip lives in the page header where users
 *    expect Tab/Shift-Tab traversal). Codex round-5 P1 2026-05-30
 *    correctly flagged the old role=tab + aria-controls=<main>
 *    combination as malformed.
 *  - Instead: real <button>s in a <nav aria-label=...>; the active
 *    button carries aria-current="page" (the single-select semantic
 *    used everywhere else in this UI). Enter + Space activate via
 *    default button semantics. data-tooltip on each carries the hint.
 */

import { type CSSProperties } from "react";

export type TabKey = "live" | "history";

export interface LiveHistoryTabsProps {
  active: TabKey;
  onChange: (tab: TabKey) => void;
  activeCount: number;
  totalCount: number;
}

export function LiveHistoryTabs({
  active,
  onChange,
  activeCount,
  totalCount,
}: LiveHistoryTabsProps) {
  return (
    <nav aria-label="Sessions filter" style={tablistStyle}>
      <TabButton
        tab="live"
        active={active === "live"}
        onClick={() => onChange("live")}
        label="Live"
        count={activeCount}
        tooltip="5-min activity window"
      />
      <TabButton
        tab="history"
        active={active === "history"}
        onClick={() => onChange("history")}
        label="History"
        count={totalCount}
        tooltip="all sessions, no filter"
      />
    </nav>
  );
}

interface TabButtonProps {
  tab: TabKey;
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  tooltip: string;
}

function TabButton({ tab, active, onClick, label, count, tooltip }: TabButtonProps) {
  return (
    <button
      type="button"
      // aria-current="page" is the WAI-ARIA single-select semantic for
      // navigation buttons; same family used on session/trace/span rows.
      // No role=tab, no aria-controls — see file header.
      aria-current={active ? "page" : undefined}
      data-tab={tab}
      data-active={active ? "true" : "false"}
      data-tooltip={tooltip}
      onClick={onClick}
      style={active ? tabButtonActiveStyle : tabButtonStyle}
    >
      <span style={tabLabelStyle}>{label}</span>
      <span style={tabCountStyle}>{`// ${count}`}</span>
    </button>
  );
}

const tablistStyle: CSSProperties = {
  display: "flex",
  alignItems: "stretch",
  gap: "2px",
  border: "1px solid var(--border-base)",
  borderRadius: "var(--radius-sm)",
  padding: "2px",
  background: "var(--surface)",
};

const tabButtonBase: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: "8px",
  padding: "4px 10px",
  // Longhand properties only so React doesn't warn about mixing
  // shorthand `border` with longhand `borderColor` on the active variant.
  borderStyle: "solid",
  borderWidth: "1px",
  borderColor: "transparent",
  borderRadius: "var(--radius-sm)",
  background: "transparent",
  color: "var(--text-muted)",
  cursor: "pointer",
  fontFamily: "var(--font-mono)",
  fontSize: "12px",
  letterSpacing: "0.04em",
  position: "relative",
};

const tabButtonStyle: CSSProperties = { ...tabButtonBase };

const tabButtonActiveStyle: CSSProperties = {
  ...tabButtonBase,
  background: "var(--surface-raised)",
  borderColor: "var(--accent-3)",
  color: "var(--text)",
  boxShadow: "var(--text-shadow-glow)",
};

const tabLabelStyle: CSSProperties = {
  fontWeight: 500,
};

const tabCountStyle: CSSProperties = {
  fontSize: "10px",
  opacity: 0.7,
};
