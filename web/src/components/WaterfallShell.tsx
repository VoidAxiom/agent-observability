/*
 * WaterfallShell — wraps <Waterfall> with the chip header + collapse toggle.
 *
 * The chip is keyboard-focusable, activates on Enter/Space, and writes a
 * `data-collapsed` attribute the parent CSS uses to shrink the bottom
 * row to 32px. Collapse state lives here (uncontrolled) since no other
 * surface needs to read it.
 */

import { useMemo, type CSSProperties } from "react";
import { Waterfall, type WaterfallProps } from "./Waterfall";
import { earliestParseableStart } from "../lib/grouping";
import { formatAbsoluteEstWithDate } from "../lib/formatTime";

export interface WaterfallShellProps extends WaterfallProps {
  /**
   * Controlled collapsed state. App.tsx owns this so the parent row CSS
   * class and the inner body render stay in lockstep — a previous version
   * kept a local useState here and only notified the parent on toggle,
   * which would desync on any future remount (HMR, suspense boundary,
   * key-on-trace-id refactor) and leave the body rendered inside a
   * 32px-collapsed row.
   */
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /**
   * Canonical trace duration (seconds). Passed in from the parent's
   * `activeTrace.durationSeconds` so the chip stays in lockstep with
   * the trace list and DetailsPane. Previously this component computed
   * its own duration from the spans array via a parseTimestamp scan; if
   * every span's Timestamp failed to parse, the chip silently printed
   * "0s" above a non-empty waterfall body — and even when timestamps
   * parsed, the chip's duration could disagree with CollapsibleTraceList
   * by a few ms because both sides walked the spans independently.
   * Codex round-4 P2 2026-05-30.
   */
  durationSeconds: number;
}

export function WaterfallShell({
  collapsed,
  onToggleCollapsed,
  durationSeconds,
  ...waterfallProps
}: WaterfallShellProps) {
  const spans = waterfallProps.spans;
  // VOI-389: surface the trace's wall-clock start as an EST/EDT chip so
  // the operator can read absolute context without leaving the waterfall.
  // Uses the shared earliestParseableStart helper (grouping.ts) — VOI-389
  // round-5 codex altitude fix collapsed three open-coded copies of this
  // loop into one. Returns NaN when no span has a parseable Timestamp,
  // which the formatter's fallback renders as "--".
  const rootStartMs = useMemo(() => earliestParseableStart(spans), [spans]);
  const startedAbs = formatAbsoluteEstWithDate(rootStartMs);
  const chipText = `// waterfall · ${spans.length} spans · ${durationSeconds.toFixed(3)}s · started ${startedAbs}`;

  return (
    // Plain <div> — the inner <Waterfall> is the landmark; nesting three
    // aria-labeled landmarks (App row + Shell + Waterfall) for one
    // logical region trips landmark-uniqueness a11y audits and makes
    // screen-readers announce the area three times.
    <div
      style={shellStyle}
      data-collapsed={collapsed ? "true" : "false"}
      data-testid="voi-waterfall-shell"
    >
      <button
        type="button"
        onClick={onToggleCollapsed}
        aria-expanded={!collapsed}
        // aria-controls must reference an element that exists in the DOM.
        // The body div is unmounted when collapsed=true, so advertise the
        // relation only when the controlled region is actually present.
        // Codex round-4 P1 2026-05-30 (dangling aria-controls reference).
        aria-controls={collapsed ? undefined : "voi-waterfall-body"}
        data-tooltip={collapsed ? "click to expand" : "click to collapse"}
        data-testid="voi-waterfall-chip"
        style={chipButtonStyle}
      >
        <span style={chipChevronStyle} aria-hidden="true">
          {collapsed ? "▸" : "▾"}
        </span>
        <span style={chipTextStyle}>{chipText}</span>
      </button>
      {!collapsed ? (
        <div id="voi-waterfall-body" style={bodyStyle}>
          <Waterfall {...waterfallProps} />
        </div>
      ) : null}
    </div>
  );
}

const shellStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  width: "100%",
  height: "100%",
  minHeight: 0,
};

const chipButtonStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  padding: "6px 12px",
  background: "var(--surface)",
  border: "none",
  borderBottom: "1px solid var(--border-base)",
  borderRadius: 0,
  cursor: "pointer",
  fontFamily: "var(--font-mono)",
  fontSize: "11px",
  color: "var(--text-muted)",
  letterSpacing: "0.04em",
  height: "32px",
  flexShrink: 0,
  textAlign: "left",
  position: "relative",
};

const chipChevronStyle: CSSProperties = {
  display: "inline-block",
  width: "12px",
  textAlign: "center",
  color: "var(--accent-3)",
};

const chipTextStyle: CSSProperties = {
  flex: 1,
};

const bodyStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};
