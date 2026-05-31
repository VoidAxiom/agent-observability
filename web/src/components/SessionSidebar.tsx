/*
 * SessionSidebar — left pane of the 3-pane navigation.
 *
 * VOI-386: replaced top-level service buckets with a recursive
 * SessionNode forest (claude → subagent → codex). Disclosure triangles
 * per node toggle expansion; expansion state is owned by App.tsx and
 * passed in (mirrors expandedTraceIds discipline). The kind chip beside
 * each label preserves the service-grouping signal the bucket headers
 * used to carry.
 *
 * Cyberpunk discipline (docs/web-ui-cyberpunk-discipline.md § "Sessions /
 * traces list"): bordered cards on --surface, hairline family-colored border,
 * 2px magenta left-edge bar on selection + 8% magenta background tint, family-
 * colored status dot, terminal-comment metadata.
 *
 * Token-only — no hex outside themes.css.
 */

import { type CSSProperties } from "react";
import {
  activityStatus,
  type ActivityStatus,
  type SessionKind,
  type SessionNode,
} from "../lib/grouping";
import { familyToAccentVar, spanNameToFamily } from "../lib/spanFamily";

export interface SessionSidebarProps {
  sessions: SessionNode[];
  selectedSessionId: string | null;
  onSelect: (sessionId: string) => void;
  /** Set of node ids currently expanded. Pure-controlled state owned by
   *  App.tsx, mirroring expandedTraceIds. */
  expandedNodeIds: Set<string>;
  onToggleExpand: (nodeId: string) => void;
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

// Lead with the repo-standard CH_* primary (matches .env.example,
// migrate.sh, docker-compose, Swift app). VITE_* is the web-only
// fallback per loadQueryConfigFromEnv — mention it in the title hover
// so the operator knows both work.
const TRUNCATION_CHIP_TEXT =
  "// window truncated · raise CH_QUERY_LIMIT_CEILING";
const TRUNCATION_TITLE =
  "ClickHouse returned the row-count safety ceiling; older spans within the configured time window were dropped. Raise CH_QUERY_LIMIT_CEILING (or VITE_CH_QUERY_LIMIT_CEILING as a web-only fallback), or shorten CH_QUERY_WINDOW_HOURS.";

function dominantFamilyAccent(session: SessionNode): string {
  // Use the session's most-recent trace's head span (the spans array is
  // already preorder-traversal-sorted from computeTreeOrder, so [0] is the
  // root). Mirrors SessionRow.swift's "dominant family of the most recent
  // trace" heuristic. Falls back to --accent-3 (non-magenta in every
  // theme) when the head span isn't resolvable.
  const latestTrace = session.traces[0];
  const headSpanName = latestTrace?.spans[0]?.SpanName ?? "";
  if (headSpanName === "") return "var(--accent-3)";
  return familyToAccentVar(spanNameToFamily(headSpanName));
}

export function SessionSidebar({
  sessions,
  selectedSessionId,
  onSelect,
  expandedNodeIds,
  onToggleExpand,
  nowMs,
  emptyMessage,
  truncated = false,
}: SessionSidebarProps) {
  // Chip is rendered at a single position in BOTH branches via the
  // same JSX node with a stable React `key` so the DOM node is
  // preserved across the empty → populated transition. role="status"
  // is an implicit aria-live="polite" region; without the stable
  // identity, assistive tech would re-announce the same text every
  // time `sessions` transitions from [] → [...] while truncated stays
  // true.
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

  // Tree-wide node count for the header hint — counts EVERY visible
  // node across the forest, not just roots, so "// 8" reflects what the
  // operator sees when everything is expanded.
  const totalNodeCount = countAllNodes(sessions);

  if (sessions.length === 0) {
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
        <span style={paneHeaderHintStyle}>{`// ${totalNodeCount}`}</span>
      </header>
      {chip}
      <ul style={rootListStyle}>
        {sessions.map((node) => (
          <SessionTreeNode
            key={node.id}
            node={node}
            depth={0}
            selectedSessionId={selectedSessionId}
            onSelect={onSelect}
            expandedNodeIds={expandedNodeIds}
            onToggleExpand={onToggleExpand}
            nowMs={nowMs}
          />
        ))}
      </ul>
    </aside>
  );
}

interface SessionTreeNodeProps {
  node: SessionNode;
  depth: number;
  selectedSessionId: string | null;
  onSelect: (sessionId: string) => void;
  expandedNodeIds: Set<string>;
  onToggleExpand: (nodeId: string) => void;
  nowMs: number;
}

function SessionTreeNode({
  node,
  depth,
  selectedSessionId,
  onSelect,
  expandedNodeIds,
  onToggleExpand,
  nowMs,
}: SessionTreeNodeProps) {
  const hasChildren = node.children.length > 0;
  const expanded = expandedNodeIds.has(node.id);
  const childrenListId = `voi-session-children-${node.id}`;

  return (
    <li style={treeItemStyle}>
      <SessionRow
        node={node}
        depth={depth}
        selected={node.id === selectedSessionId}
        onSelect={onSelect}
        nowMs={nowMs}
        hasChildren={hasChildren}
        expanded={expanded}
        onToggleExpand={onToggleExpand}
        childrenListId={childrenListId}
      />
      {hasChildren && expanded ? (
        <ul id={childrenListId} style={childListStyle}>
          {node.children.map((child) => (
            <SessionTreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedSessionId={selectedSessionId}
              onSelect={onSelect}
              expandedNodeIds={expandedNodeIds}
              onToggleExpand={onToggleExpand}
              nowMs={nowMs}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

interface SessionRowProps {
  node: SessionNode;
  depth: number;
  selected: boolean;
  onSelect: (sessionId: string) => void;
  nowMs: number;
  hasChildren: boolean;
  expanded: boolean;
  onToggleExpand: (nodeId: string) => void;
  childrenListId: string;
}

function SessionRow({
  node,
  depth,
  selected,
  onSelect,
  nowMs,
  hasChildren,
  expanded,
  onToggleExpand,
  childrenListId,
}: SessionRowProps) {
  const accent = dominantFamilyAccent(node);
  const status = activityStatus(node, nowMs);
  const lastActivityAgeSeconds = Math.max(
    0,
    Math.round((nowMs - node.lastActivity) / 1000),
  );

  // Per-depth indentation. The wrapper carries the padding so the
  // disclosure triangle's hit target ALSO shifts right with depth —
  // putting the padding on the button alone would leave the triangle
  // pinned at depth 0 visually.
  const wrapperStyle: CSSProperties = {
    ...rowWrapperStyle,
    paddingLeft: 16 + depth * 14,
  };

  const rowStyle: CSSProperties = {
    position: "relative",
    background: selected ? "var(--surface-raised)" : "var(--surface)",
    color: "var(--text)",
    border: `1px solid ${accent}`,
    borderRadius: "var(--radius-card)",
    padding: "10px 12px 10px 16px",
    cursor: "pointer",
    fontFamily: "var(--font-body)",
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    boxShadow: selected ? "var(--text-shadow-glow)" : "none",
    transition: "var(--motion-snap)",
    transitionProperty: "border-color, box-shadow, background-color",
    flex: 1,
    minWidth: 0,
    textAlign: "left",
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
    <div style={wrapperStyle}>
      {hasChildren ? (
        <button
          type="button"
          onClick={() => onToggleExpand(node.id)}
          aria-expanded={expanded}
          aria-controls={childrenListId}
          aria-label={expanded ? "Collapse" : "Expand"}
          data-disclosure="true"
          data-node-id={node.id}
          style={disclosureButtonStyle}
        >
          {expanded ? "▾" : "▸"}
        </button>
      ) : (
        // Reserve the disclosure column even on leaf rows so labels stay
        // aligned across siblings — without this, a claude root with no
        // dispatched subagents would visually shift left relative to one
        // with children.
        <span aria-hidden="true" style={disclosureSpacerStyle} />
      )}
      <button
        type="button"
        onClick={() => onSelect(node.id)}
        aria-current={selected ? "true" : undefined}
        data-selected={selected ? "true" : "false"}
        data-session-id={node.id}
        data-kind={node.kind}
        data-depth={depth}
        style={rowStyle}
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
            hasError={node.hasError}
            accent={accent}
            ageSeconds={lastActivityAgeSeconds}
          />
          <span
            style={sessionLabelStyle}
            data-tooltip={`service.name=${node.serviceName}`}
          >
            {node.displayLabel}
          </span>
          <KindChip kind={node.kind} />
        </span>
        <span style={sessionMetaStyle}>
          {buildMetaLine(node)}
        </span>
      </button>
    </div>
  );
}

function buildMetaLine(node: SessionNode): string {
  const base = `// ${node.traceCount} traces · ${node.spanCount} spans`;
  if (node.descendantSpanCount > 0) {
    return `${base} · +${node.descendantSpanCount} nested`;
  }
  return base;
}

interface KindChipProps {
  kind: SessionKind;
}

function KindChip({ kind }: KindChipProps) {
  return (
    <span
      data-kind-chip={kind}
      title={`kind=${kind}`}
      style={kindChipStyle}
    >
      {kind}
    </span>
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

function countAllNodes(nodes: SessionNode[]): number {
  let n = 0;
  const stack: SessionNode[] = [...nodes];
  while (stack.length > 0) {
    const node = stack.pop()!;
    n += 1;
    for (const child of node.children) stack.push(child);
  }
  return n;
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

const rootListStyle: CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: "6px",
};

const treeItemStyle: CSSProperties = {
  listStyle: "none",
  display: "flex",
  flexDirection: "column",
  gap: "6px",
};

const childListStyle: CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: "6px",
};

const rowWrapperStyle: CSSProperties = {
  display: "flex",
  alignItems: "stretch",
  gap: "6px",
  paddingRight: 4,
};

const disclosureButtonStyle: CSSProperties = {
  flex: "0 0 18px",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 18,
  height: 18,
  alignSelf: "center",
  padding: 0,
  margin: 0,
  background: "transparent",
  border: "1px solid transparent",
  borderRadius: 3,
  color: "var(--text-muted)",
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  cursor: "pointer",
  lineHeight: 1,
};

const disclosureSpacerStyle: CSSProperties = {
  flex: "0 0 18px",
  width: 18,
  height: 18,
  display: "inline-block",
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
  flex: 1,
  minWidth: 0,
};

const kindChipStyle: CSSProperties = {
  flexShrink: 0,
  fontFamily: "var(--font-mono)",
  fontSize: "9px",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--accent-3)",
  border: "1px solid var(--accent-3)",
  borderRadius: 3,
  padding: "1px 5px",
  background: "transparent",
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
