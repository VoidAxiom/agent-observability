/*
 * SpanTree — right pane (top half). Renders the span tree for the selected
 * trace using TraceGroup.spans (already preorder-sorted by
 * computeTreeOrder in grouping.ts; depth pre-stamped).
 *
 * Per-row family color via familyToAccentVar (single source of truth).
 * Vertical tick connector at (depth-1)*16 + 8 px when depth > 0, colored
 * to match the child's family per cyberpunk § "Vertical tick connector".
 */

import { type CSSProperties } from "react";
import type { SpanRow, TraceGroup } from "../lib/grouping";
import { spanRowId } from "../lib/grouping";
import { familyToAccentVar, spanNameToFamily } from "../lib/spanFamily";

export interface SpanTreeProps {
  trace: TraceGroup | null;
  selectedSpanId: string | null;
  onSelect: (spanId: string) => void;
  emptyMessage?: string;
}

const INDENT_PX = 16;

export function SpanTree({
  trace,
  selectedSpanId,
  onSelect,
  emptyMessage,
}: SpanTreeProps) {
  if (!trace) {
    return (
      <section aria-label="Span tree" style={emptyPaneStyle}>
        <p style={emptyTextStyle}>
          {emptyMessage ?? "// select a trace to load its span tree"}
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Span tree" style={paneStyle}>
      <header style={paneHeaderStyle}>
        <h2 style={paneHeaderTitleStyle}>SPANS</h2>
        <span style={paneHeaderHintStyle}>{`// ${trace.spans.length}`}</span>
      </header>
      <ul style={listStyle}>
        {trace.spans.map((span) => {
          const id = spanRowId(span);
          return (
            <SpanTreeRow
              key={id}
              span={span}
              spanId={id}
              selected={id === selectedSpanId}
              onSelect={onSelect}
            />
          );
        })}
      </ul>
    </section>
  );
}

interface SpanTreeRowProps {
  span: SpanRow;
  spanId: string;
  selected: boolean;
  onSelect: (spanId: string) => void;
}

function SpanTreeRow({ span, spanId, selected, onSelect }: SpanTreeRowProps) {
  const family = spanNameToFamily(span.SpanName);
  const accent = familyToAccentVar(family);
  const depth = span.depth;
  const indent = depth * INDENT_PX;
  const durationMs = span.Duration / 1_000_000;

  const rowStyle: CSSProperties = {
    position: "relative",
    paddingLeft: `${indent + 12}px`,
    paddingRight: "10px",
    paddingTop: "6px",
    paddingBottom: "6px",
    background: selected ? "var(--surface-raised)" : "transparent",
    color: "var(--text)",
    border: "none",
    cursor: "pointer",
    fontFamily: "var(--font-mono)",
    width: "100%",
    textAlign: "left",
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    transition: "var(--motion-snap)",
    transitionProperty: "background-color, box-shadow",
    boxShadow: selected ? "var(--text-shadow-glow)" : "none",
  };

  const selectionBarStyle: CSSProperties = {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    width: "2px",
    background: "var(--accent-1)",
  };

  const selectionTintStyle: CSSProperties = {
    position: "absolute",
    inset: 0,
    background: "var(--accent-1)",
    opacity: 0.08,
    pointerEvents: "none",
  };

  // Vertical tick: 1px line in the child's family color, anchored at the
  // parent's gutter column ((depth-1)*INDENT + 8). Render only when depth>0
  // so roots don't paint a stray connector.
  const tickStyle: CSSProperties | null =
    depth > 0
      ? {
          position: "absolute",
          top: 0,
          bottom: 0,
          left: `${(depth - 1) * INDENT_PX + 8}px`,
          width: "1px",
          background: accent,
          opacity: 0.5,
          pointerEvents: "none",
        }
      : null;

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(spanId)}
        aria-pressed={selected}
        data-selected={selected ? "true" : "false"}
        data-span-id={spanId}
        data-depth={depth}
        style={rowStyle}
      >
        {selected ? (
          <>
            <span aria-hidden="true" style={selectionTintStyle} />
            <span aria-hidden="true" style={selectionBarStyle} />
          </>
        ) : null}
        {tickStyle ? <span aria-hidden="true" style={tickStyle} /> : null}
        <span style={rowMainStyle}>
          <span
            aria-hidden="true"
            style={{ ...familyDotStyle, background: accent }}
          />
          <span style={nameStyle}>{span.SpanName}</span>
        </span>
        <span style={metaStyle}>{`// ${formatMs(durationMs)}`}</span>
      </button>
    </li>
  );
}

function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0ms";
  if (ms < 1) return `${ms.toFixed(2)}ms`;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

const paneStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "8px",
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
};

const rowMainStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  position: "relative",
  zIndex: 1,
};

const familyDotStyle: CSSProperties = {
  width: "6px",
  height: "6px",
  borderRadius: "50%",
  flexShrink: 0,
};

const nameStyle: CSSProperties = {
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
  position: "relative",
  zIndex: 1,
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
