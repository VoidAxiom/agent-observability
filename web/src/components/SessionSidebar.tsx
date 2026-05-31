/*
 * SessionSidebar — left pane of the 3-pane navigation.
 *
 * Cyberpunk discipline (docs/web-ui-cyberpunk-discipline.md § "Sessions /
 * traces list"): bordered cards on --surface, hairline family-colored border,
 * 2px magenta left-edge bar on selection + 8% magenta background tint, family-
 * colored status dot, terminal-comment metadata.
 *
 * Token-only — no hex outside themes.css. All families resolved via the
 * single source of truth in SignatureSpanCard (familyToAccentVar /
 * spanNameToFamily).
 */

import { useMemo, type CSSProperties } from "react";
import {
  activityStatus,
  type ActivityStatus,
  type SessionGroup,
} from "../lib/grouping";
import { familyToAccentVar, spanNameToFamily } from "../lib/spanFamily";

export interface SessionSidebarProps {
  sessions: SessionGroup[];
  selectedSessionId: string | null;
  onSelect: (sessionId: string) => void;
  nowMs: number;
  emptyMessage?: string;
  /**
   * When true, render a terminal-comment chip in the pane header signalling
   * that the polling query hit its row-count safety ceiling and older
   * spans-within-the-window were dropped. Surfaces VOI-382's truncation
   * signal to the operator so they know to raise the ceiling.
   */
  truncated?: boolean;
}

interface ServiceBucket {
  serviceName: string;
  sessions: SessionGroup[];
}

// Lead with the repo-standard CH_* primary (matches .env.example,
// migrate.sh, docker-compose, Swift app). VITE_* is the web-only
// fallback per loadQueryConfigFromEnv — mention it in the title hover
// so the operator knows both work.
const TRUNCATION_CHIP_TEXT =
  "// window truncated · raise CH_QUERY_LIMIT_CEILING";
const TRUNCATION_TITLE =
  "ClickHouse returned the row-count safety ceiling; older spans within the configured time window were dropped. Raise CH_QUERY_LIMIT_CEILING (or VITE_CH_QUERY_LIMIT_CEILING as a web-only fallback), or shorten CH_QUERY_WINDOW_HOURS.";

function bucketByService(sessions: SessionGroup[]): ServiceBucket[] {
  const order: string[] = [];
  const buckets = new Map<string, SessionGroup[]>();
  for (const s of sessions) {
    const key = s.serviceName || "unknown service";
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = [];
      buckets.set(key, bucket);
      order.push(key);
    }
    bucket.push(s);
  }
  return order.map((name) => ({
    serviceName: name,
    sessions: buckets.get(name) ?? [],
  }));
}

function dominantFamilyAccent(session: SessionGroup): string {
  // Use the session's most-recent trace's head span (the spans array is
  // already preorder-traversal-sorted from computeTreeOrder, so [0] is the
  // root). Mirrors SessionRow.swift's "dominant family of the most recent
  // trace" heuristic.
  //
  // Fall back to --accent-3 (non-magenta in every theme) when the head
  // span isn't resolvable — a cycle-only trace whose rows were dropped by
  // computeTreeOrder would otherwise default to magenta (--accent-1) via
  // spanNameToFamily(''), colliding with the selection bar on a selected
  // row. --accent-3 is "informational accent" in the theme system and is
  // never the selection color in any of the 21 styles.
  const latestTrace = session.traces[0];
  const headSpanName = latestTrace?.spans[0]?.SpanName ?? "";
  if (headSpanName === "") return "var(--accent-3)";
  return familyToAccentVar(spanNameToFamily(headSpanName));
}

export function SessionSidebar({
  sessions,
  selectedSessionId,
  onSelect,
  nowMs,
  emptyMessage,
  truncated = false,
}: SessionSidebarProps) {
  const buckets = useMemo(() => bucketByService(sessions), [sessions]);

  // Chip is rendered at a single position in BOTH branches via the
  // same JSX node with a stable React `key` so the DOM node is
  // preserved across the empty → populated transition. role="status"
  // is an implicit aria-live="polite" region; without the stable
  // identity, assistive tech would re-announce the same text every
  // time `sessions` transitions from [] → [...] while truncated stays
  // true. Codex P2 round-4 2026-05-30.
  const chip = truncated ? (
    <p
      key="truncation-chip"
      role="status"
      data-truncation-chip="true"
      style={truncationChipStyle}
      title={TRUNCATION_TITLE}
    >
      {TRUNCATION_CHIP_TEXT}
    </p>
  ) : null;

  if (sessions.length === 0) {
    // When the chip is shown we use the stacked-from-top layout (chip
    // at top, message below it) so the chip reads as a header banner.
    // When there's no chip, fall back to the centered awaiting-message
    // style. Layout split inline (rather than two style objects) so the
    // intent reads in one place: the chip is what changes the layout.
    return (
      <aside
        aria-label="Sessions"
        style={truncated ? emptyStateWithChipStyle : emptyStateStyle}
      >
        {chip}
        <p style={emptyStateTextStyle}>
          {emptyMessage ?? "// awaiting spans from ClickHouse..."}
        </p>
      </aside>
    );
  }

  return (
    <aside aria-label="Sessions" style={paneStyle}>
      <header style={paneHeaderStyle}>
        <h2
          style={paneHeaderTitleStyle}
          title="● active = pulsing accent · idle = family color · error = warning accent"
        >
          SESSIONS
        </h2>
        <span style={paneHeaderHintStyle}>{`// ${sessions.length}`}</span>
      </header>
      {chip}
      {buckets.map((bucket) => (
        <section key={bucket.serviceName} style={bucketStyle}>
          <h3 style={bucketHeaderStyle}>{bucket.serviceName}</h3>
          <ul style={listStyle}>
            {bucket.sessions.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                selected={session.id === selectedSessionId}
                onSelect={onSelect}
                nowMs={nowMs}
              />
            ))}
          </ul>
        </section>
      ))}
    </aside>
  );
}

interface SessionRowProps {
  session: SessionGroup;
  selected: boolean;
  onSelect: (sessionId: string) => void;
  nowMs: number;
}

function SessionRow({ session, selected, onSelect, nowMs }: SessionRowProps) {
  const accent = dominantFamilyAccent(session);
  const status = activityStatus(session, nowMs);
  const lastActivityAgeSeconds = Math.max(
    0,
    Math.round((nowMs - session.lastActivity) / 1000),
  );

  const rowStyle: CSSProperties = {
    position: "relative",
    background: selected ? "var(--surface-raised)" : "var(--surface)",
    color: "var(--text)",
    border: `1px solid ${accent}`,
    borderRadius: "var(--radius-card)",
    padding: "10px 12px 10px 16px",
    listStyle: "none",
    cursor: "pointer",
    fontFamily: "var(--font-body)",
    display: "flex",
    flexDirection: "column",
    gap: "4px",
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
    borderTopLeftRadius: "var(--radius-card)",
    borderBottomLeftRadius: "var(--radius-card)",
  };

  const selectionTintStyle: CSSProperties = {
    position: "absolute",
    inset: 0,
    background: "var(--accent-1)",
    opacity: 0.08,
    borderRadius: "var(--radius-card)",
    pointerEvents: "none",
  };

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(session.id)}
        // Single-select semantic — aria-current, not aria-pressed (which
        // would announce each row as a per-row toggle). Codex round-4 P1
        // 2026-05-30.
        aria-current={selected ? "true" : undefined}
        data-selected={selected ? "true" : "false"}
        data-session-id={session.id}
        style={{ ...rowStyle, width: "100%", textAlign: "left" }}
      >
        {selected ? (
          <>
            <span aria-hidden="true" style={selectionTintStyle} />
            <span aria-hidden="true" style={selectionBarStyle} />
          </>
        ) : null}
        <span style={rowTopLineStyle}>
          <StatusDot
            status={status}
            hasError={session.hasError}
            accent={accent}
            ageSeconds={lastActivityAgeSeconds}
          />
          <span
            style={sessionLabelStyle}
            data-tooltip={`service.name=${session.serviceName}`}
          >
            {session.displayLabel}
          </span>
        </span>
        <span style={sessionMetaStyle}>
          {`// ${session.traceCount} traces · ${session.spanCount} spans`}
        </span>
      </button>
    </li>
  );
}

interface StatusDotProps {
  status: ActivityStatus;
  hasError: boolean;
  accent: string;
  ageSeconds: number;
}

function StatusDot({ status, hasError, accent, ageSeconds }: StatusDotProps) {
  let color = accent;
  let animation: string | undefined;
  let label: string;
  if (hasError) {
    // Magenta (--accent-1) is reserved for selection; reusing it for the
    // error dot collides with the selection bar on a selected error row.
    // --accent-2 is the per-theme warn/secondary slot (orange/yellow in
    // most themes, purple in neon-tokyo) — visually distinct from the
    // magenta selection bar while staying alarm-coded across themes.
    color = "var(--accent-2)";
    animation = "voi-error-strobe 0.6s ease-out 1";
    label = "error";
  } else if (status === "active") {
    color = "var(--accent-3)";
    animation = "voi-active-pulse 1.4s ease-in-out infinite";
    label = "active";
  } else if (status === "idle") {
    label = "idle";
  } else {
    label = "stale";
  }
  const tooltipText = `${label}, last activity ${ageSeconds}s ago`;
  return (
    <span
      aria-label={label}
      role="img"
      title={tooltipText}
      data-tooltip={tooltipText}
      style={{
        display: "inline-block",
        width: "8px",
        height: "8px",
        borderRadius: "50%",
        background: color,
        animation,
        flexShrink: 0,
        position: "relative",
      }}
    />
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
  cursor: "help",
};

const paneHeaderHintStyle: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "11px",
  color: "var(--text-muted)",
};

const truncationChipStyle: CSSProperties = {
  // position:sticky keeps the chip pinned to the top of the scrolling
  // <aside> in the populated branch so it stays visible after the
  // operator scrolls down through buckets. Without it, the chip
  // scrolls out of viewport alongside the header in any pane with
  // ~10+ sessions — defeating the chip's signaling purpose precisely
  // when truncation has produced enough sessions to fill the pane.
  // Codex P2 round-5 2026-05-30.
  position: "sticky",
  top: 0,
  zIndex: 2,
  margin: "2px 4px 0",
  padding: "4px 8px",
  fontFamily: "var(--font-mono)",
  fontSize: "10px",
  color: "var(--accent-2)",
  background: "var(--surface-raised)",
  border: "1px solid var(--accent-2)",
  borderRadius: "var(--radius-card)",
  letterSpacing: "0.02em",
  cursor: "help",
};

const bucketStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "6px",
};

const bucketHeaderStyle: CSSProperties = {
  margin: "8px 4px 2px",
  fontFamily: "var(--font-numeric)",
  fontSize: "10px",
  letterSpacing: "0.14em",
  color: "var(--text-muted)",
  textTransform: "uppercase",
};

const listStyle: CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: "6px",
};

const rowTopLineStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  position: "relative",
  zIndex: 1,
};

const sessionLabelStyle: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "12px",
  color: "var(--text)",
  letterSpacing: "0.01em",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const sessionMetaStyle: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "10px",
  color: "var(--text-muted)",
  letterSpacing: "0.02em",
  position: "relative",
  zIndex: 1,
};

const emptyStateStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "center",
  padding: "20px",
  height: "100%",
};

// Variant of emptyStateStyle used when the truncation chip is also
// rendered in the empty-state path. flexDirection:column so the chip
// stacks above the message (the default row direction crowded them
// side-by-side — codex P2 round-3 2026-05-30).
const emptyStateWithChipStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "stretch",
  justifyContent: "flex-start",
  gap: "10px",
  padding: "14px 12px",
  height: "100%",
};

const emptyStateTextStyle: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "12px",
  color: "var(--text-muted)",
  margin: 0,
};
