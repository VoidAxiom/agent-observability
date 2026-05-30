/*
 * CollapsibleTraceList — middle pane. Replaces TraceList. Each trace row
 * has a chevron that expands inline to show its spans as an indented list.
 * Subagent spans get an ALL-CAPS family-colored badge after the name.
 *
 * Expansion state is LIFTED to App.tsx (so 5-second polling refresh
 * doesn't collapse user-expanded traces). Selection rules mirror the
 * sibling list components (2px magenta left-edge + 8% magenta tint).
 *
 * Span row depth comes from computeTreeOrder (already applied in
 * grouping.ts); indent = depth * 16px. Click selects the span and bubbles
 * via the onSelectSpan callback.
 */

import { type CSSProperties } from "react";
import { formatHeroDurationMs } from "../lib/formatHero";
import type { SpanRow, TraceGroup } from "../lib/grouping";
import { spanRowId } from "../lib/grouping";
import { familyToAccentVar, spanNameToFamily } from "../lib/spanFamily";
import { isSubagent, subagentIds, subagentType } from "../lib/isSubagent";

export interface CollapsibleTraceListProps {
  traces: TraceGroup[];
  selectedTraceId: string | null;
  selectedSpanId: string | null;
  expandedTraceIds: Set<string>;
  onSelectTrace: (traceId: string) => void;
  onSelectSpan: (spanId: string) => void;
  onToggleExpand: (traceId: string) => void;
  emptyMessage?: string;
}

function traceAccent(trace: TraceGroup): string {
  // Mirror SessionSidebar.dominantFamilyAccent: spanNameToFamily('')
  // returns 'claude_code.tool' which maps to --accent-1 (magenta, the
  // reserved selection color). A cycle-only trace or any row dropped by
  // computeTreeOrder would therefore paint a magenta border colliding
  // with the 2px magenta selection bar — the user can't tell whether
  // the trace is selected or just has no head. Fall back to --accent-3
  // (informational accent, never the selection color in any theme).
  const headSpanName = trace.spans[0]?.SpanName ?? "";
  if (headSpanName === "") return "var(--accent-3)";
  return familyToAccentVar(spanNameToFamily(headSpanName));
}

export function CollapsibleTraceList({
  traces,
  selectedTraceId,
  selectedSpanId,
  expandedTraceIds,
  onSelectTrace,
  onSelectSpan,
  onToggleExpand,
  emptyMessage,
}: CollapsibleTraceListProps) {
  if (traces.length === 0) {
    return (
      <section aria-label="Traces" style={emptyPaneStyle}>
        <p style={emptyTextStyle}>
          {emptyMessage ?? "// select a session to load its traces"}
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Traces" style={paneStyle}>
      <header style={paneHeaderStyle}>
        <h2 style={paneHeaderTitleStyle}>TRACES</h2>
        <span style={paneHeaderHintStyle}>{`// ${traces.length}`}</span>
      </header>
      <ul style={listStyle}>
        {traces.map((trace) => (
          <TraceItem
            key={trace.id}
            trace={trace}
            selected={trace.id === selectedTraceId}
            expanded={expandedTraceIds.has(trace.id)}
            selectedSpanId={selectedSpanId}
            onSelectTrace={onSelectTrace}
            onSelectSpan={onSelectSpan}
            onToggleExpand={onToggleExpand}
          />
        ))}
      </ul>
    </section>
  );
}

interface TraceItemProps {
  trace: TraceGroup;
  selected: boolean;
  expanded: boolean;
  selectedSpanId: string | null;
  onSelectTrace: (traceId: string) => void;
  onSelectSpan: (spanId: string) => void;
  onToggleExpand: (traceId: string) => void;
}

function TraceItem({
  trace,
  selected,
  expanded,
  selectedSpanId,
  onSelectTrace,
  onSelectSpan,
  onToggleExpand,
}: TraceItemProps) {
  const accent = traceAccent(trace);

  const rowStyle: CSSProperties = {
    position: "relative",
    background: selected ? "var(--surface-raised)" : "var(--surface)",
    color: "var(--text)",
    border: `1px solid ${accent}`,
    borderRadius: "var(--radius-sm)",
    padding: "6px 10px 6px 8px",
    listStyle: "none",
    // No cursor here — the outer <div> has no onClick. The inner chevron
    // + label buttons set their own cursor. Codex round-5 P1 2026-05-30
    // (dead click zone between the two inner buttons).
    fontFamily: "var(--font-body)",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    width: "100%",
    textAlign: "left",
    boxShadow: selected ? "var(--text-shadow-glow)" : "none",
    transition: "var(--motion-snap)",
    transitionProperty: "border-color, box-shadow, background-color",
  };

  const selectionBarStyle: CSSProperties = {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    width: "2px",
    background: "var(--accent-1)",
    borderTopLeftRadius: "var(--radius-sm)",
    borderBottomLeftRadius: "var(--radius-sm)",
  };

  const selectionTintStyle: CSSProperties = {
    position: "absolute",
    inset: 0,
    background: "var(--accent-1)",
    opacity: 0.08,
    borderRadius: "var(--radius-sm)",
    pointerEvents: "none",
  };

  return (
    <li>
      <div style={rowStyle}>
        {selected ? (
          <>
            <span aria-hidden="true" style={selectionTintStyle} />
            <span aria-hidden="true" style={selectionBarStyle} />
          </>
        ) : null}
        <button
          type="button"
          aria-label={expanded ? `collapse ${trace.displayLabel}` : `expand ${trace.displayLabel}`}
          aria-expanded={expanded}
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand(trace.id);
          }}
          data-tooltip={expanded ? "collapse trace" : "expand trace"}
          data-testid={`voi-chevron-${trace.id}`}
          style={{ ...chevronStyle, color: accent, transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
        >
          <span aria-hidden="true">›</span>
        </button>
        <button
          type="button"
          onClick={() => onSelectTrace(trace.id)}
          // Single-select semantic — aria-current, not aria-pressed.
          // Codex round-4 P1 2026-05-30.
          aria-current={selected ? "true" : undefined}
          data-trace-id={trace.id}
          data-selected={selected ? "true" : "false"}
          style={traceLabelButtonStyle}
        >
          <span style={mainStyle}>
            <span style={labelStyle}>{trace.displayLabel}</span>
            <span style={metaStyle}>
              {`// ${trace.spanCount} spans · ${formatHeroDurationMs(trace.durationSeconds * 1000)}`}
            </span>
          </span>
        </button>
      </div>
      {expanded ? (
        <ul style={spansListStyle} data-testid={`voi-spans-${trace.id}`}>
          {trace.spans.map((span) => (
            <SpanRowItem
              key={spanRowId(span)}
              span={span}
              selected={spanRowId(span) === selectedSpanId}
              onSelect={(spanId) => {
                // Promote the parent trace before setting the span so
                // DetailsPane/Waterfall switch to the new trace context.
                // Without this, expanding trace B (different from the
                // currently-selected trace A) and clicking one of B's
                // span rows leaves selectedTraceId=A; activeSpan looks
                // up the click in A's spans (not found) and DetailsPane
                // stays on A's aggregate while the row is highlighted
                // — a desync. Codex round-6 P2 2026-05-30.
                if (!selected) onSelectTrace(trace.id);
                onSelectSpan(spanId);
              }}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

interface SpanRowItemProps {
  span: SpanRow;
  selected: boolean;
  onSelect: (spanId: string) => void;
}

function SpanRowItem({ span, selected, onSelect }: SpanRowItemProps) {
  const family = spanNameToFamily(span.SpanName);
  const accent = familyToAccentVar(family);
  const sub = isSubagent(span);
  const subType = sub ? subagentType(span) : "";
  const { agentId, parentAgentId } = sub
    ? subagentIds(span)
    : { agentId: "", parentAgentId: "" };
  const tooltipText = sub
    ? `subagent_type=${subType}${agentId ? ` · agent_id=${agentId}` : ""}${parentAgentId ? ` · parent=${parentAgentId}` : ""}`
    : "";
  const id = spanRowId(span);
  const indent = Math.min(span.depth, 8) * 16;

  return (
    <li style={{ paddingLeft: `${indent}px` }}>
      <button
        type="button"
        onClick={() => onSelect(id)}
        // aria-current is the correct semantic for "this row is the
        // active selection in a single-select list" — aria-pressed would
        // make NVDA/JAWS announce each row as a per-row toggle button,
        // which doesn't match the interaction (the click flips a global
        // selectedSpanId, not the row's own state). Codex round-4 P1
        // 2026-05-30.
        aria-current={selected ? "true" : undefined}
        data-span-id={id}
        data-depth={span.depth}
        data-selected={selected ? "true" : "false"}
        style={{
          ...spanRowButtonStyle,
          borderLeft: `2px solid ${selected ? "var(--accent-1)" : "transparent"}`,
          background: selected ? "var(--surface-raised)" : "transparent",
        }}
      >
        <span style={{ ...spanDot, background: accent }} aria-hidden="true" />
        <span style={spanNameStyle}>{span.SpanName}</span>
        {sub ? (
          <span
            data-subagent-badge="true"
            data-tooltip={tooltipText}
            style={{ ...subagentBadgeStyle, color: accent, borderColor: accent }}
          >
            {`[${subType.toUpperCase()}]`}
          </span>
        ) : null}
      </button>
    </li>
  );
}

const paneStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "10px",
  padding: "14px 12px",
  overflowY: "auto",
  height: "100%",
};

const paneHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "0 4px",
};

const paneHeaderTitleStyle: CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-numeric)",
  fontSize: "11px",
  letterSpacing: "0.12em",
  color: "var(--text)",
  textTransform: "uppercase",
};

const paneHeaderHintStyle: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "11px",
  color: "var(--text-muted)",
};

const listStyle: CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: "4px",
};

const chevronStyle: CSSProperties = {
  background: "transparent",
  border: "none",
  padding: "2px 4px",
  cursor: "pointer",
  fontFamily: "var(--font-mono)",
  fontSize: "14px",
  lineHeight: 1,
  position: "relative",
  zIndex: 1,
  flexShrink: 0,
  transition: "transform 160ms ease-out",
};

const traceLabelButtonStyle: CSSProperties = {
  background: "transparent",
  border: "none",
  padding: 0,
  margin: 0,
  cursor: "pointer",
  textAlign: "left",
  color: "inherit",
  fontFamily: "inherit",
  flex: 1,
  minWidth: 0,
  position: "relative",
  zIndex: 1,
};

const mainStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "2px",
  minWidth: 0,
};

const labelStyle: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "12px",
  color: "var(--text)",
  letterSpacing: "0.01em",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const metaStyle: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "10px",
  color: "var(--text-muted)",
  letterSpacing: "0.02em",
};

const spansListStyle: CSSProperties = {
  listStyle: "none",
  margin: "4px 0 8px 0",
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: "1px",
};

const spanRowButtonStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "6px",
  width: "100%",
  border: "1px solid transparent",
  borderRadius: "var(--radius-sm)",
  padding: "3px 6px",
  background: "transparent",
  cursor: "pointer",
  textAlign: "left",
  fontFamily: "var(--font-mono)",
  fontSize: "11px",
  color: "var(--text)",
  transition: "background-color 140ms ease-out, border-color 140ms ease-out",
};

const spanDot: CSSProperties = {
  width: "6px",
  height: "6px",
  borderRadius: "50%",
  flexShrink: 0,
};

const spanNameStyle: CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  flex: 1,
  minWidth: 0,
};

const subagentBadgeStyle: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "9px",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  padding: "1px 4px",
  border: "1px solid",
  borderRadius: "var(--radius-sm)",
  flexShrink: 0,
  background: "transparent",
  position: "relative",
};

const emptyPaneStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "center",
  padding: "20px",
  height: "100%",
};

const emptyTextStyle: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "12px",
  color: "var(--text-muted)",
  margin: 0,
};
