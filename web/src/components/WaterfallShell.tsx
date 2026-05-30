/*
 * WaterfallShell — wraps <Waterfall> with the chip header + collapse toggle.
 *
 * The chip is keyboard-focusable, activates on Enter/Space, and writes a
 * `data-collapsed` attribute the parent CSS uses to shrink the bottom
 * row to 32px. Collapse state lives here (uncontrolled) since no other
 * surface needs to read it.
 */

import { useState, type CSSProperties } from "react";
import { Waterfall, type WaterfallProps } from "./Waterfall";

export interface WaterfallShellProps extends WaterfallProps {
  /** Optional override for tests that want to pin the collapsed state. */
  defaultCollapsed?: boolean;
  /** Notified when the user toggles collapse so App.tsx can update the row class. */
  onCollapsedChange?: (collapsed: boolean) => void;
}

function formatChipDuration(spans: WaterfallProps["spans"]): string {
  if (spans.length === 0) return "0s";
  let earliest = Number.POSITIVE_INFINITY;
  let latest = Number.NEGATIVE_INFINITY;
  for (const s of spans) {
    const t = Date.parse(s.Timestamp);
    if (!Number.isFinite(t)) continue;
    const end = t + s.Duration / 1_000_000;
    if (t < earliest) earliest = t;
    if (end > latest) latest = end;
  }
  if (!Number.isFinite(earliest) || !Number.isFinite(latest)) return "0s";
  const seconds = Math.max(0, (latest - earliest) / 1000);
  return `${seconds.toFixed(3)}s`;
}

export function WaterfallShell({
  defaultCollapsed = false,
  onCollapsedChange,
  ...waterfallProps
}: WaterfallShellProps) {
  const [collapsed, setCollapsed] = useState<boolean>(defaultCollapsed);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    onCollapsedChange?.(next);
  };

  const spans = waterfallProps.spans;
  const chipText = `// waterfall · ${spans.length} spans · ${formatChipDuration(spans)}`;

  return (
    <section
      aria-label="Waterfall shell"
      style={shellStyle}
      data-collapsed={collapsed ? "true" : "false"}
      data-testid="voi-waterfall-shell"
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        aria-controls="voi-waterfall-body"
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
    </section>
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
