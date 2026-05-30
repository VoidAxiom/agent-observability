/*
 * InspectorPane — right pane (bottom half). Renders the selected span's
 * raw SpanAttributesRaw + ResourceAttributesRaw maps.
 *
 * Per VOI-345 Linear acceptance, scope is RAW attributes; the
 * Request/Response/Identity/Environment grouping ships in VOI-346.
 */

import { useMemo, type CSSProperties } from "react";
import type { SpanRow } from "../lib/grouping";
import { familyToAccentVar, spanNameToFamily } from "../lib/spanFamily";

export interface InspectorPaneProps {
  span: SpanRow | null;
  emptyMessage?: string;
}

export function InspectorPane({ span, emptyMessage }: InspectorPaneProps) {
  const spanEntries = useMemo(
    () => (span ? sortedEntries(span.SpanAttributesRaw) : []),
    [span],
  );
  const resourceEntries = useMemo(
    () => (span ? sortedEntries(span.ResourceAttributesRaw) : []),
    [span],
  );

  if (!span) {
    return (
      <section aria-label="Inspector" style={emptyPaneStyle}>
        <p style={emptyTextStyle}>
          {emptyMessage ?? "// select a span to inspect its attributes"}
        </p>
      </section>
    );
  }

  const accent = familyToAccentVar(spanNameToFamily(span.SpanName));
  const durationMs = span.Duration / 1_000_000;
  const heroValue = formatHeroMs(durationMs);
  const heroUnit = durationMs >= 10000 ? "" : " ms";

  return (
    <section aria-label="Inspector" style={paneStyle}>
      <header style={headerStyle}>
        <div style={headerTopStyle}>
          <span aria-hidden="true" style={{ ...accentDot, background: accent }} />
          <h2 style={titleStyle}>{span.SpanName}</h2>
        </div>
        <p style={{ ...heroNumeralStyle, color: accent }}>
          {heroValue}
          {heroUnit ? <span style={heroUnitStyle}>{heroUnit}</span> : null}
        </p>
        <p style={metaCommentStyle}>
          {`// ${spanEntries.length} attributes · ${resourceEntries.length} resource`}
        </p>
      </header>

      <AttributeList title="ATTRIBUTES" entries={spanEntries} />
      <AttributeList title="RESOURCE" entries={resourceEntries} />
    </section>
  );
}

interface AttributeListProps {
  title: string;
  entries: ReadonlyArray<readonly [string, string]>;
}

function AttributeList({ title, entries }: AttributeListProps) {
  return (
    <div style={listGroupStyle}>
      <h3 style={listHeaderStyle}>{title}</h3>
      {entries.length === 0 ? (
        <p style={listEmptyStyle}>{"// none"}</p>
      ) : (
        <dl style={dlStyle}>
          {entries.map(([k, v]) => (
            <div key={k} style={rowStyle}>
              <dt style={keyStyle}>{k}</dt>
              <dd style={valueStyle}>{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function sortedEntries(
  map: Record<string, string>,
): ReadonlyArray<readonly [string, string]> {
  return Object.entries(map).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

function formatHeroMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0";
  if (ms >= 10000) return `${(ms / 1000).toFixed(2)}s`;
  if (ms >= 100) return Math.round(ms).toString();
  if (ms >= 1) return ms.toFixed(1);
  return ms.toFixed(2);
}

const paneStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "16px",
  padding: "16px 14px",
  overflowY: "auto",
  height: "100%",
};

const headerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "6px",
};

const headerTopStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
};

const accentDot: CSSProperties = {
  width: "8px",
  height: "8px",
  borderRadius: "50%",
  flexShrink: 0,
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-mono)",
  fontSize: "13px",
  fontWeight: 500,
  color: "var(--text)",
  letterSpacing: "0.01em",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const heroNumeralStyle: CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-numeric)",
  fontSize: "44px",
  fontWeight: 500,
  letterSpacing: "-0.02em",
  lineHeight: 1,
};

const heroUnitStyle: CSSProperties = {
  fontSize: "16px",
  marginLeft: "6px",
  letterSpacing: "0.05em",
  color: "var(--text-muted)",
};

const metaCommentStyle: CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-mono)",
  fontSize: "11px",
  color: "var(--text-muted)",
  letterSpacing: "0.02em",
};

const listGroupStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "6px",
};

const listHeaderStyle: CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-numeric)",
  fontSize: "10px",
  letterSpacing: "0.14em",
  color: "var(--text-muted)",
  textTransform: "uppercase",
};

const listEmptyStyle: CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-mono)",
  fontSize: "11px",
  color: "var(--text-muted)",
};

const dlStyle: CSSProperties = {
  margin: 0,
  display: "grid",
  gridTemplateColumns: "minmax(120px, 220px) 1fr",
  rowGap: "4px",
  columnGap: "12px",
};

const rowStyle: CSSProperties = {
  display: "contents",
};

const keyStyle: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "11px",
  color: "var(--text-muted)",
  letterSpacing: "0.02em",
  wordBreak: "break-word",
};

const valueStyle: CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-mono)",
  fontSize: "11px",
  color: "var(--text)",
  letterSpacing: "0.01em",
  wordBreak: "break-word",
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
