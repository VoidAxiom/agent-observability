/*
 * TraceList — middle pane. Renders TraceGroup[] for the selected session
 * with a visually distinct row shape from SessionSidebar (smaller card,
 * leading chevron glyph) so the M3 "sessions misread as traces" failure
 * mode doesn't re-emerge.
 *
 * Selection rule mirrors SessionSidebar: 2px magenta left-edge bar + 8%
 * magenta background tint via --accent-1.
 */

import { type CSSProperties } from "react";
import type { TraceGroup } from "../lib/grouping";
import { familyToAccentVar, spanNameToFamily } from "../lib/spanFamily";

export interface TraceListProps {
  traces: TraceGroup[];
  selectedTraceId: string | null;
  onSelect: (traceId: string) => void;
  emptyMessage?: string;
}

function traceAccent(trace: TraceGroup): string {
  const headSpanName = trace.spans[0]?.SpanName ?? "";
  return familyToAccentVar(spanNameToFamily(headSpanName));
}

export function TraceList({
  traces,
  selectedTraceId,
  onSelect,
  emptyMessage,
}: TraceListProps) {
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
          <TraceRow
            key={trace.id}
            trace={trace}
            selected={trace.id === selectedTraceId}
            onSelect={onSelect}
          />
        ))}
      </ul>
    </section>
  );
}

interface TraceRowProps {
  trace: TraceGroup;
  selected: boolean;
  onSelect: (traceId: string) => void;
}

function TraceRow({ trace, selected, onSelect }: TraceRowProps) {
  const accent = traceAccent(trace);

  const rowStyle: CSSProperties = {
    position: "relative",
    background: selected ? "var(--surface-raised)" : "var(--surface)",
    color: "var(--text)",
    border: `1px solid ${accent}`,
    borderLeftWidth: "1px",
    borderRadius: "var(--radius-sm)",
    padding: "8px 12px 8px 14px",
    listStyle: "none",
    cursor: "pointer",
    fontFamily: "var(--font-body)",
    display: "flex",
    alignItems: "center",
    gap: "10px",
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
      <button
        type="button"
        onClick={() => onSelect(trace.id)}
        aria-pressed={selected}
        data-selected={selected ? "true" : "false"}
        data-trace-id={trace.id}
        style={rowStyle}
      >
        {selected ? (
          <>
            <span aria-hidden="true" style={selectionTintStyle} />
            <span aria-hidden="true" style={selectionBarStyle} />
          </>
        ) : null}
        <span aria-hidden="true" style={{ ...glyphStyle, color: accent }}>
          ›
        </span>
        <span style={mainStyle}>
          <span style={labelStyle}>{trace.displayLabel}</span>
          <span style={metaStyle}>
            {`// ${trace.spanCount} spans · ${trace.durationSeconds.toFixed(3)}s`}
          </span>
        </span>
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

const glyphStyle: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "14px",
  lineHeight: 1,
  position: "relative",
  zIndex: 1,
  flexShrink: 0,
};

const mainStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "2px",
  minWidth: 0,
  position: "relative",
  zIndex: 1,
  flex: 1,
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
