/*
 * grouping.ts — session grouping + tree assembly.
 *
 * VOI-386 extends the flat SessionGroup[] into a SessionNode forest:
 * claude → subagent → codex. SessionNode is a SUPERSET of the original
 * SessionGroup shape (all SessionGroup fields preserved), plus tree fields
 * (kind, parentId, children, descendantSpanCount, descendantHasError).
 * `SessionGroup` stays exported as a type alias so existing consumers
 * (DetailsPane, sessionsFilter, App.tsx) keep compiling unchanged.
 *
 * Build algorithm (per docs/session-hierarchy-design.md § "Layer 1 — UI",
 * authoritative; see .codex-runs/voi-386-r1/spec.md for the verbatim quote):
 *   1. claude nodes  — bucket ServiceName=claude-code spans by SessionId
 *      (SpanAttributes['session.id']). Roots of each tree.
 *   2. subagent nodes — within each claude bucket, find dispatch spans
 *      (SpanAttributes['subagent_type'] non-empty); the subagent's
 *      agent_id is the first descendant span's agent_id. Promote work
 *      spans bearing those agent_ids to subagent nodes. Other agent_id
 *      spans (root Claude agent) stay on the claude node.
 *   3. codex nodes   — bucket ServiceName=codex_exec spans by stamped
 *      ResourceAttributes['agent.session.id']. Resolve parent via two-tier
 *      fallback: (a) parent.span.id → walk up to nearest agent_id ancestor
 *      that's in the dispatch map; (b) parent.session.id → that claude
 *      node; (c) else top-level. Un-stamped codex (no agent.session.id)
 *      remains on its inherited claude bucket per stamped-data-only rule.
 *
 * Original SessionGroup invariants preserved:
 *   - Session key fallback for legacy / un-stamped paths:
 *     SpanAttributes['session.id'] > ResourceAttributes['agent.session.id'] > TraceId.
 *   - lastActivity uses span END time (Timestamp + Duration_ns).
 *   - durationSeconds = (max end-time) - (min start-time).
 *   - computeTreeOrder is cycle-safe (per-(TraceId, SpanId) visited set);
 *     sibling order by Timestamp ascending with insertion-order tie-break.
 *   - hasError checks StatusCode + merged span/resource attributes.
 */

export interface SpanRow {
  TraceId: string;
  SpanId: string;
  ParentSpanId: string;
  SpanName: string;
  Timestamp: string;
  ServiceName: string;
  StatusCode: string;
  Duration: number; // nanoseconds; finite, non-negative
  AgentProject: string;
  AgentSessionId: string;
  AgentRunId: string;
  SessionId: string;
  ProjectName: string;
  ResourceAttributesRaw: Record<string, string>;
  SpanAttributesRaw: Record<string, string>;
  depth: number;
}

export interface TraceGroup {
  id: string; // === traceId
  traceId: string;
  displayLabel: string;
  rootStart: number; // ms since epoch; -Infinity sentinel for unparseable
  rootStartText: string;
  lastActivity: number; // ms since epoch
  lastActivityText: string;
  spanCount: number;
  durationSeconds: number;
  hasError: boolean;
  spans: SpanRow[];
}

export type SessionKind = "claude" | "subagent" | "codex";

/**
 * SessionNode — the unified tree-aware session shape. Superset of the
 * historical SessionGroup so DetailsPane, sessionsFilter, and selection
 * reconciliation keep working unchanged (every SessionGroup field is
 * carried; new tree fields are additive).
 *
 * `spans` / `spanCount` / `traceCount` / `durationSeconds` /
 * `lastActivity*` / `hasError` / `traces` are computed from spans OWNED
 * BY THIS NODE — descendants are nested via `children`, NOT folded into
 * this node's totals. `descendantSpanCount` / `descendantHasError` are
 * convenience aggregates for sidebar chips.
 */
export interface SessionNode {
  // SessionGroup-compatible fields (existing consumers keep working):
  id: string;
  sessionKey: string;
  displayLabel: string;
  serviceName: string;
  projectName: string;
  lastActivity: number; // ms since epoch
  lastActivityText: string;
  spanCount: number;
  traceCount: number;
  durationSeconds: number;
  hasError: boolean;
  traces: TraceGroup[];
  // Tree fields:
  kind: SessionKind;
  parentId: string | null;
  children: SessionNode[];
  /** All spans owned by THIS node (not its descendants). Useful for tests
   *  and for components that want the raw spans without going through
   *  `traces`. */
  spans: SpanRow[];
  // Subtree aggregates (post-order over children):
  descendantSpanCount: number;
  descendantHasError: boolean;
}

// Backward-compat alias so existing imports of SessionGroup keep working
// without churning DetailsPane / sessionsFilter / App.tsx. The two names
// are interchangeable; new consumers that traverse `children` should
// import SessionNode for intent.
export type SessionGroup = SessionNode;

export type ActivityStatus = "active" | "idle" | "stale";

export function activityStatus(
  session: SessionGroup,
  nowMs: number,
): ActivityStatus {
  const ageSeconds = (nowMs - session.lastActivity) / 1000;
  if (ageSeconds <= 5 * 60) return "active";
  if (ageSeconds <= 60 * 60) return "idle";
  return "stale";
}

export interface Selection {
  selectedSessionId: string | null;
  selectedTraceId: string | null;
  selectedSpanId: string | null;
}

const DISTANT_PAST = -8.64e15; // sentinel for unparseable timestamps (matches Swift .distantPast semantics)
const CLAUDE_SERVICE = "claude-code";
const CODEX_SERVICE = "codex_exec";

/**
 * Public entry point. `groupSpans` keeps its historical name as a thin
 * alias for `groupSpansToTree` so call sites don't churn; the returned
 * array IS the forest's roots.
 */
export function groupSpans(rows: SpanRow[]): SessionNode[] {
  return groupSpansToTree(rows);
}

export function groupSpansToTree(rows: SpanRow[]): SessionNode[] {
  if (rows.length === 0) return [];

  // Index every span globally by (traceId, spanId) so the codex parent.span.id
  // walk has O(1) ancestor lookup. Cycle safety in the walker is enforced
  // separately by a per-walk visited set; this map is purely lookup.
  const spanByGlobalId = new Map<string, SpanRow>();
  for (const row of rows) {
    spanByGlobalId.set(globalSpanId(row), row);
  }

  // Partition rows into the buckets the algorithm needs.
  // - claudeRows: ServiceName=claude-code with a non-empty SessionId.
  //   These form root nodes + subagent buckets.
  // - codexRows: ServiceName=codex_exec WITH a stamped agent.session.id
  //   (those are the only ones promoted to tree codex nodes, per the
  //   stamped-data-only decision).
  // - legacyRows: everything else (no claude SessionId, or un-stamped codex,
  //   or agent-obs-sdk smoke spans). These fall through to the historical
  //   effective-session-key path and become flat top-level nodes.
  const claudeRowsBySession = new Map<string, SpanRow[]>();
  const codexRowsBySession = new Map<string, SpanRow[]>();
  const legacyRows: SpanRow[] = [];

  for (const row of rows) {
    if (row.ServiceName === CLAUDE_SERVICE && row.SessionId !== "") {
      pushBucket(claudeRowsBySession, row.SessionId, row);
      continue;
    }
    if (row.ServiceName === CODEX_SERVICE) {
      const stampedSessionId = row.ResourceAttributesRaw["agent.session.id"];
      if (stampedSessionId) {
        pushBucket(codexRowsBySession, stampedSessionId, row);
        continue;
      }
    }
    legacyRows.push(row);
  }

  // First pass: build claude nodes + their subagent children.
  // We also collect every dispatch-map agent_id so the codex parent walker
  // knows which agent_ids count as "subagent" (vs root-Claude work spans).
  const claudeNodesBySession = new Map<string, SessionNode>();
  // Map agent_id (across all claude sessions) → the subagent node it
  // resolves to. Used by codex parent.span.id resolution.
  const subagentNodeByAgentId = new Map<string, SessionNode>();

  for (const [sessionId, sessionRows] of claudeRowsBySession) {
    const node = buildClaudeNode(sessionId, sessionRows, subagentNodeByAgentId);
    claudeNodesBySession.set(sessionId, node);
  }

  // Second pass: build codex nodes + resolve their parents.
  const orphanCodexRoots: SessionNode[] = [];
  for (const [codexSessionId, codexRows] of codexRowsBySession) {
    const node = buildCodexNode(codexSessionId, codexRows);
    const parent = resolveCodexParent(
      codexRows,
      spanByGlobalId,
      subagentNodeByAgentId,
      claudeNodesBySession,
    );
    if (parent === "orphan") {
      // Codex carries a parent.session.id but the claude session isn't in
      // window. Mark visually so the operator can tell why it isn't nested.
      node.displayLabel = `${node.displayLabel} // orphan parent`;
      orphanCodexRoots.push(node);
    } else if (parent === null) {
      // Standalone codex — no Claude context. Top-level root.
      orphanCodexRoots.push(node);
    } else {
      node.parentId = parent.id;
      parent.children.push(node);
    }
  }

  // Third pass: any un-stamped codex / agent-obs-sdk / orphaned rows
  // collapse through the historical effective-session-key path so they
  // continue to render (just as flat top-level nodes, not promoted).
  const legacyRoots = buildLegacyNodes(legacyRows);

  // Forest = claude roots + standalone/orphan codex + legacy roots.
  const forest: SessionNode[] = [];
  for (const node of claudeNodesBySession.values()) forest.push(node);
  for (const node of orphanCodexRoots) forest.push(node);
  for (const node of legacyRoots) forest.push(node);

  // Post-order: compute descendant aggregates + sort siblings.
  for (const node of forest) finalizeSubtree(node);
  return sortSiblings(forest);
}

/**
 * Find a node anywhere in the forest by id. DFS, cycle-safe via visited
 * set (children should never cycle, but the guard cheaply removes a
 * footgun for any caller that constructs a hand-rolled forest in tests).
 */
export function findNodeById(
  forest: SessionNode[],
  id: string | null | undefined,
): SessionNode | null {
  if (!id) return null;
  const visited = new Set<string>();
  const stack: SessionNode[] = [...forest];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (visited.has(node.id)) continue;
    visited.add(node.id);
    if (node.id === id) return node;
    for (const child of node.children) stack.push(child);
  }
  return null;
}

export function reconcileSelection(
  sessions: SessionNode[],
  selectedSessionId: string | null | undefined,
  selectedTraceId: string | null | undefined,
  selectedSpanId: string | null | undefined,
): Selection {
  // Walk the entire forest so a selected subagent / codex node (nested
  // child) is preserved, not nulled because it isn't a top-level root.
  const sessionIds = new Set<string>();
  const traceIds = new Set<string>();
  const spanIds = new Set<string>();
  const visit = (node: SessionNode): void => {
    sessionIds.add(node.id);
    for (const t of node.traces) {
      traceIds.add(t.id);
      for (const s of t.spans) spanIds.add(spanRowId(s));
    }
    for (const c of node.children) visit(c);
  };
  for (const s of sessions) visit(s);

  return {
    selectedSessionId:
      selectedSessionId && sessionIds.has(selectedSessionId)
        ? selectedSessionId
        : null,
    selectedTraceId:
      selectedTraceId && traceIds.has(selectedTraceId)
        ? selectedTraceId
        : null,
    selectedSpanId:
      selectedSpanId && spanIds.has(selectedSpanId) ? selectedSpanId : null,
  };
}

export function spanRowId(row: SpanRow): string {
  return row.TraceId + row.SpanId;
}

// ---------- node construction ----------

function buildClaudeNode(
  sessionId: string,
  sessionRows: SpanRow[],
  subagentNodeByAgentId: Map<string, SessionNode>,
): SessionNode {
  // Identify dispatch agent_ids in this session. A dispatch span carries
  // SpanAttributes['subagent_type'] AND its own agent_id is the "parent"
  // (root agent's) — the subagent's own agent_id is on the dispatched
  // work spans (first descendant carrying agent_id). The current SDK
  // emits both the dispatch span and the subagent's own work spans
  // tagged with the SAME subagent_id, so we resolve via tree-walk down
  // ParentSpanId.
  const dispatchAgentIdToSubagentType = buildDispatchAgentIdMap(sessionRows);

  // Partition spans: those with agent_id present in the dispatch map
  // belong to a subagent bucket; everything else stays on the claude node.
  const claudeOwnSpans: SpanRow[] = [];
  const subagentBuckets = new Map<string, SpanRow[]>();
  for (const row of sessionRows) {
    const agentId = row.SpanAttributesRaw["agent_id"] ?? "";
    if (agentId !== "" && dispatchAgentIdToSubagentType.has(agentId)) {
      pushBucket(subagentBuckets, agentId, row);
    } else {
      claudeOwnSpans.push(row);
    }
  }

  const claudeNode = makeSessionNode({
    kind: "claude",
    id: sessionId,
    sessionKey: sessionId,
    parentId: null,
    spans: claudeOwnSpans,
    serviceNameFallback: CLAUDE_SERVICE,
    displayLabelOverride: null,
  });

  // Build subagent children + register them in the cross-session map.
  for (const [agentId, agentSpans] of subagentBuckets) {
    const subagentType = dispatchAgentIdToSubagentType.get(agentId) ?? agentId;
    const subagentId = `${sessionId}::subagent::${agentId}`;
    const subagentNode = makeSessionNode({
      kind: "subagent",
      id: subagentId,
      sessionKey: agentId,
      parentId: claudeNode.id,
      spans: agentSpans,
      serviceNameFallback: CLAUDE_SERVICE,
      displayLabelOverride: subagentType,
    });
    claudeNode.children.push(subagentNode);
    subagentNodeByAgentId.set(agentId, subagentNode);
  }

  return claudeNode;
}

/**
 * Find every (agent_id → subagent_type) pairing in this session. A
 * dispatch span carries subagent_type as a span attribute; the dispatched
 * subagent's own agent_id appears on the first descendant work span via
 * tree-walk down ParentSpanId. Cycle-safe via visited set.
 */
function buildDispatchAgentIdMap(sessionRows: SpanRow[]): Map<string, string> {
  const out = new Map<string, string>();
  // Build a per-trace child index so descendant walks are O(children).
  const childrenByParent = new Map<string, SpanRow[]>();
  for (const row of sessionRows) {
    const parentKey = globalSpanIdFor(row.TraceId, row.ParentSpanId);
    pushBucket(childrenByParent, parentKey, row);
  }

  for (const dispatchSpan of sessionRows) {
    const subagentType =
      dispatchSpan.SpanAttributesRaw["subagent_type"] ?? "";
    if (subagentType === "") continue;
    const agentId = findFirstDescendantAgentId(dispatchSpan, childrenByParent);
    if (agentId === null) continue;
    // First-wins on collisions: a later dispatch span re-using the same
    // agent_id should NOT overwrite the original subagent_type label.
    if (!out.has(agentId)) out.set(agentId, subagentType);
  }
  return out;
}

function findFirstDescendantAgentId(
  start: SpanRow,
  childrenByParent: Map<string, SpanRow[]>,
): string | null {
  const visited = new Set<string>();
  const stack: SpanRow[] = [start];
  while (stack.length > 0) {
    const node = stack.pop()!;
    const key = globalSpanId(node);
    if (visited.has(key)) continue;
    visited.add(key);
    if (node !== start) {
      const candidate = node.SpanAttributesRaw["agent_id"] ?? "";
      if (candidate !== "") return candidate;
    }
    const children = childrenByParent.get(key);
    if (children) {
      for (const child of children) stack.push(child);
    }
  }
  return null;
}

function buildCodexNode(codexSessionId: string, codexRows: SpanRow[]): SessionNode {
  return makeSessionNode({
    kind: "codex",
    id: `codex::${codexSessionId}`,
    sessionKey: codexSessionId,
    parentId: null,
    spans: codexRows,
    serviceNameFallback: CODEX_SERVICE,
    displayLabelOverride: null,
  });
}

/**
 * Resolve a codex node's parent per the two-tier fallback:
 *   1. parent.span.id → walk up ParentSpanId to first ancestor whose
 *      agent_id is in the dispatch map → that subagent node.
 *   2. parent.session.id → that claude session node. If absent from the
 *      window → "orphan" (top-level with a label hint).
 *   3. else null → standalone top-level codex.
 *
 * The walk is bounded by rows.length and cycle-safe via visited set,
 * matching computeTreeOrder's discipline.
 */
function resolveCodexParent(
  codexRows: SpanRow[],
  spanByGlobalId: Map<string, SpanRow>,
  subagentNodeByAgentId: Map<string, SessionNode>,
  claudeNodesBySession: Map<string, SessionNode>,
): SessionNode | null | "orphan" {
  // The resource attributes carrying agent.parent.* are emitted once per
  // process and replicated across every span of the codex invocation. Read
  // them off the first row — any row would do, but spec says
  // ResourceAttributes['agent.parent.span.id'] / ['agent.parent.session.id'].
  const first = codexRows[0];
  if (!first) return null;
  const parentSpanId =
    first.ResourceAttributesRaw["agent.parent.span.id"] ?? "";
  const parentSessionId =
    first.ResourceAttributesRaw["agent.parent.session.id"] ?? "";

  // Tier 1: walk up parent.span.id to find a subagent ancestor.
  if (parentSpanId !== "") {
    // The parent span lives in claude-code's trace, not codex's — so we
    // must search across ALL traces for matching SpanId, not just within
    // a particular TraceId. The global-id map is keyed on TraceId+SpanId
    // which doesn't help here. Build a side index on SpanId once.
    const subagentAncestor = walkToSubagentAncestor(
      parentSpanId,
      spanByGlobalId,
      subagentNodeByAgentId,
    );
    if (subagentAncestor) return subagentAncestor;
  }

  // Tier 2: fall back to parent.session.id → claude node.
  if (parentSessionId !== "") {
    const claudeNode = claudeNodesBySession.get(parentSessionId);
    if (claudeNode) return claudeNode;
    return "orphan";
  }

  return null;
}

function walkToSubagentAncestor(
  startSpanId: string,
  spanByGlobalId: Map<string, SpanRow>,
  subagentNodeByAgentId: Map<string, SessionNode>,
): SessionNode | null {
  // Build a side index on SpanId alone (no TraceId) since the codex stamp
  // doesn't carry the parent's TraceId. If multiple spans across traces
  // share the same SpanId (vanishingly unlikely for 64-bit OTel ids but
  // not impossible), the first match wins — same heuristic computeTreeOrder
  // uses elsewhere when it bounds by rows.length. Built lazily per call to
  // avoid carrying a stale snapshot.
  const bySpanId = new Map<string, SpanRow>();
  for (const row of spanByGlobalId.values()) {
    if (!bySpanId.has(row.SpanId)) bySpanId.set(row.SpanId, row);
  }
  const visited = new Set<string>();
  let currentSpanId: string = startSpanId;
  let depth = 0;
  const maxDepth = Math.min(1000, spanByGlobalId.size);
  while (currentSpanId !== "" && depth < maxDepth) {
    if (visited.has(currentSpanId)) return null;
    visited.add(currentSpanId);
    const row = bySpanId.get(currentSpanId);
    if (!row) return null;
    const agentId = row.SpanAttributesRaw["agent_id"] ?? "";
    if (agentId !== "") {
      const subagent = subagentNodeByAgentId.get(agentId);
      if (subagent) return subagent;
    }
    currentSpanId = row.ParentSpanId;
    if (
      currentSpanId === "" ||
      currentSpanId === "0000000000000000"
    ) {
      return null;
    }
    depth += 1;
  }
  return null;
}

/**
 * Build flat nodes for rows that didn't fit the tree (un-stamped codex,
 * agent-obs-sdk smoke, claude-code without a SessionId). Uses the historical
 * effective-session-key bucketing so legacy data continues to render.
 */
function buildLegacyNodes(rows: SpanRow[]): SessionNode[] {
  if (rows.length === 0) return [];
  const buckets = new Map<string, SpanRow[]>();
  for (const row of rows) {
    pushBucket(buckets, effectiveSessionKey(row), row);
  }
  const nodes: SessionNode[] = [];
  for (const [key, bucketRows] of buckets) {
    // Pick a sensible kind: codex_exec rows → "codex" (even when
    // un-stamped — service.name is enough to color them), claude-code → "claude",
    // everything else → "claude" as the neutral default so the existing
    // CSS/tooltips don't break.
    const kind: SessionKind =
      bucketRows[0]?.ServiceName === CODEX_SERVICE ? "codex" : "claude";
    nodes.push(
      makeSessionNode({
        kind,
        id: key,
        sessionKey: key,
        parentId: null,
        spans: bucketRows,
        serviceNameFallback: bucketRows[0]?.ServiceName ?? "unknown service",
        displayLabelOverride: null,
      }),
    );
  }
  return nodes;
}

interface MakeNodeInput {
  kind: SessionKind;
  id: string;
  sessionKey: string;
  parentId: string | null;
  spans: SpanRow[];
  serviceNameFallback: string;
  /** When set, replaces the default project-prefixed label. Used for
   *  subagent nodes whose label is the subagent_type, and codex nodes
   *  whose label is the agent.session.id. */
  displayLabelOverride: string | null;
}

function makeSessionNode(input: MakeNodeInput): SessionNode {
  const { kind, id, sessionKey, parentId, spans, serviceNameFallback } = input;
  const traces = traceGroups(spans);
  const sortedTraces = [...traces].sort((a, b) => {
    if (a.rootStart === b.rootStart) {
      return a.traceId < b.traceId ? -1 : a.traceId > b.traceId ? 1 : 0;
    }
    return b.rootStart - a.rootStart;
  });
  const projectName =
    firstSortedNonEmpty(spans.map((r) => r.ProjectName)) ??
    firstSortedNonEmpty(spans.map((r) => r.AgentProject)) ??
    "";
  const serviceName =
    firstSortedNonEmpty(spans.map((r) => r.ServiceName)) ??
    serviceNameFallback ??
    "unknown service";
  const dates = datedRows(spans);
  const last = latestEndingRow(dates);
  const duration = durationSecondsFromDates(dates);

  return {
    id,
    sessionKey,
    displayLabel:
      input.displayLabelOverride ?? displayLabel(projectName, sessionKey),
    serviceName,
    projectName,
    lastActivity: last?.endDate ?? DISTANT_PAST,
    lastActivityText: last?.row.Timestamp ?? "",
    spanCount: sortedTraces.reduce((acc, t) => acc + t.spanCount, 0),
    traceCount: sortedTraces.length,
    durationSeconds: duration,
    hasError: sortedTraces.some((t) => t.hasError),
    traces: sortedTraces,
    kind,
    parentId,
    children: [],
    spans,
    descendantSpanCount: 0,
    descendantHasError: false,
  };
}

/**
 * Post-order pass: compute descendant aggregates AND sort each level's
 * siblings by lastActivity desc with the same string tie-break used by
 * the historical groupSpans path.
 */
function finalizeSubtree(node: SessionNode): void {
  for (const child of node.children) finalizeSubtree(child);
  let descSpans = 0;
  let descError = false;
  for (const child of node.children) {
    descSpans += child.spanCount + child.descendantSpanCount;
    if (child.hasError || child.descendantHasError) descError = true;
  }
  node.descendantSpanCount = descSpans;
  node.descendantHasError = descError;
  node.children = sortSiblings(node.children);
}

function sortSiblings(nodes: SessionNode[]): SessionNode[] {
  return [...nodes].sort((a, b) => {
    if (a.lastActivity === b.lastActivity) {
      return a.sessionKey < b.sessionKey
        ? -1
        : a.sessionKey > b.sessionKey
          ? 1
          : 0;
    }
    return b.lastActivity - a.lastActivity;
  });
}

// ---------- shared helpers (preserved from the original file) ----------

interface TreeKey {
  traceId: string;
  spanId: string;
}
function treeKey(k: TreeKey): string {
  return `${k.traceId} ${k.spanId}`;
}

function globalSpanId(row: SpanRow): string {
  return treeKey({ traceId: row.TraceId, spanId: row.SpanId });
}
function globalSpanIdFor(traceId: string, spanId: string): string {
  return treeKey({ traceId, spanId });
}

function pushBucket<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  let bucket = map.get(key);
  if (!bucket) {
    bucket = [];
    map.set(key, bucket);
  }
  bucket.push(value);
}

export function computeTreeOrder(rows: SpanRow[]): SpanRow[] {
  if (rows.length === 0) return [];

  const childrenByParent = new Map<string, SpanRow[]>();
  for (const row of rows) {
    const key = treeKey({ traceId: row.TraceId, spanId: row.ParentSpanId });
    let bucket = childrenByParent.get(key);
    if (!bucket) {
      bucket = [];
      childrenByParent.set(key, bucket);
    }
    bucket.push(row);
  }

  const spanIds = new Set<string>();
  for (const row of rows) {
    spanIds.add(treeKey({ traceId: row.TraceId, spanId: row.SpanId }));
  }

  const sortedByTimestamp = (input: SpanRow[]): SpanRow[] => {
    // Insertion-order tie-break preserved via enumerate.
    return input
      .map((element, offset) => ({ element, offset }))
      .sort((a, b) => {
        if (a.element.Timestamp === b.element.Timestamp) {
          return a.offset - b.offset;
        }
        return a.element.Timestamp < b.element.Timestamp ? -1 : 1;
      })
      .map((entry) => entry.element);
  };

  const roots = sortedByTimestamp(
    rows.filter((row) => {
      const parentKey = treeKey({
        traceId: row.TraceId,
        spanId: row.ParentSpanId,
      });
      return (
        row.ParentSpanId === "" ||
        row.ParentSpanId === "0000000000000000" ||
        !spanIds.has(parentKey)
      );
    }),
  );

  const maxDepth = Math.min(1000, rows.length);
  const visited = new Set<string>();
  const ordered: SpanRow[] = [];

  const visit = (node: SpanRow, depth: number): void => {
    if (depth >= maxDepth) return;
    const nodeKey = treeKey({ traceId: node.TraceId, spanId: node.SpanId });
    if (visited.has(nodeKey)) return;
    visited.add(nodeKey);

    ordered.push({ ...node, depth });

    const children = sortedByTimestamp(childrenByParent.get(nodeKey) ?? []);
    for (const child of children) {
      visit(child, depth + 1);
    }
  };

  for (const root of roots) {
    visit(root, 0);
  }

  return ordered;
}

function traceGroups(rows: SpanRow[]): TraceGroup[] {
  const byTrace = new Map<string, SpanRow[]>();
  for (const row of rows) {
    let bucket = byTrace.get(row.TraceId);
    if (!bucket) {
      bucket = [];
      byTrace.set(row.TraceId, bucket);
    }
    bucket.push(row);
  }

  const groups: TraceGroup[] = [];
  for (const [traceId, traceRows] of byTrace) {
    const orderedRows = computeTreeOrder(traceRows);
    const dates = datedRows(traceRows);
    const firstDate = minBy(dates, (d) => d.date);
    const last = latestEndingRow(dates);

    const headSpanName = orderedRows[0]?.SpanName ?? "";
    let label: string;
    if (headSpanName !== "") {
      label = headSpanName;
    } else {
      const fallback = [...traceRows].sort((a, b) => {
        if (a.Timestamp === b.Timestamp) {
          return a.SpanId < b.SpanId ? -1 : a.SpanId > b.SpanId ? 1 : 0;
        }
        return a.Timestamp < b.Timestamp ? -1 : 1;
      })[0];
      label = fallback?.SpanName ?? "";
    }
    if (label === "") {
      label = shortKey(traceId);
    }

    groups.push({
      id: traceId,
      traceId,
      displayLabel: label,
      rootStart: firstDate?.date ?? DISTANT_PAST,
      rootStartText: firstDate?.row.Timestamp ?? "",
      lastActivity: last?.endDate ?? DISTANT_PAST,
      lastActivityText: last?.row.Timestamp ?? "",
      spanCount: orderedRows.length,
      durationSeconds: durationSecondsFromDates(dates),
      // Error detection scans the raw trace rows (not the ordered/visible set),
      // matching SessionGrouping.swift `traceRows.contains(where: rowHasError)`.
      // A cycle-only trace whose spans were dropped by computeTreeOrder still
      // surfaces as failing — losing that signal would let broken traces look
      // healthy in the session list.
      hasError: traceRows.some(rowHasError),
      spans: orderedRows,
    });
  }
  return groups;
}

function effectiveSessionKey(row: SpanRow): string {
  const candidates = [row.SessionId, row.AgentSessionId, row.TraceId];
  for (const value of candidates) {
    if (value !== "") return value;
  }
  // Stable id fallback used by the Swift "row.id" — TraceId+SpanId.
  return spanRowId(row);
}

export function rowHasError(row: SpanRow): boolean {
  if (row.StatusCode.toUpperCase() === "ERROR") return true;

  // span attributes win on collision, mirroring Swift's `merging(_:_)` rule.
  const merged: Record<string, string> = { ...row.ResourceAttributesRaw };
  for (const [k, v] of Object.entries(row.SpanAttributesRaw)) {
    merged[k] = v;
  }

  const statusCode = (merged["otel.status_code"] ?? merged["status.code"] ?? "")
    .toString()
    .toUpperCase();
  if (statusCode === "ERROR") return true;
  if ((merged["error"] ?? "").toString().toLowerCase() === "true") return true;
  for (const key of Object.keys(merged)) {
    if (key.startsWith("exception.")) return true;
  }
  return false;
}

interface DatedRow {
  row: SpanRow;
  date: number; // ms since epoch; DISTANT_PAST when unparseable.
}

function datedRows(rows: SpanRow[]): DatedRow[] {
  return rows.map((row) => ({
    row,
    date: parseTimestamp(row.Timestamp) ?? DISTANT_PAST,
  }));
}

function endTime(d: DatedRow): number | null {
  if (d.date === DISTANT_PAST) return null;
  // Duration is nanoseconds; convert to ms.
  return d.date + d.row.Duration / 1_000_000;
}

interface EndedRow {
  row: SpanRow;
  endDate: number;
}

function latestEndingRow(dates: DatedRow[]): EndedRow | null {
  let best: EndedRow | null = null;
  for (const d of dates) {
    const e = endTime(d);
    if (e === null) continue;
    if (best === null || e > best.endDate) {
      best = { row: d.row, endDate: e };
    }
  }
  return best;
}

function durationSecondsFromDates(dates: DatedRow[]): number {
  const valid = dates.filter((d) => d.date !== DISTANT_PAST);
  if (valid.length === 0) return 0;
  const first = valid.reduce(
    (acc, cur) => (cur.date < acc.date ? cur : acc),
    valid[0],
  );
  let lastEndMs = first.date;
  for (const d of valid) {
    const e = endTime(d);
    if (e !== null && e > lastEndMs) lastEndMs = e;
  }
  return Math.max(0, (lastEndMs - first.date) / 1000);
}

function displayLabel(projectName: string, key: string): string {
  const shortSession = shortKey(key);
  if (projectName === "") return shortSession;
  return `${projectName} · ${shortSession}`;
}

function shortKey(value: string): string {
  return value.slice(0, 12);
}

function firstSortedNonEmpty(values: string[]): string | null {
  const filtered = values.filter((v) => v !== "").sort();
  return filtered[0] ?? null;
}

function minBy<T>(values: T[], score: (v: T) => number): T | null {
  if (values.length === 0) return null;
  let best = values[0];
  let bestScore = score(best);
  for (let i = 1; i < values.length; i++) {
    const s = score(values[i]);
    if (s < bestScore) {
      best = values[i];
      bestScore = s;
    }
  }
  return best;
}

/**
 * Parse a ClickHouse-style timestamp into ms-since-epoch.
 * Handles both "2026-01-01T00:00:01.000000000" and "...Z" suffix forms,
 * plus space-separated dates. Returns null for unparseable input — same
 * semantics as Swift's optional Date.
 */
export function parseTimestamp(value: string): number | null {
  const normalized = normalizeTimestamp(value);
  if (normalized === null) return null;
  const ms = Date.parse(normalized);
  if (Number.isNaN(ms)) return null;
  return ms;
}

function normalizeTimestamp(value: string): string | null {
  if (!value) return null;
  let s = value.replace(" ", "T");
  // Split off any trailing timezone suffix so we can insert milliseconds
  // before it — appending blindly turns "2026-01-01T00:00:00Z" into
  // "2026-01-01T00:00:00Z.000" which Date.parse rejects.
  const tzMatch = s.match(/([zZ]|[+-]\d{2}:?\d{2})$/);
  const tz = tzMatch ? tzMatch[0] : "";
  const head = tz ? s.slice(0, s.length - tz.length) : s;
  // Find an optional ".<digits>" fractional section on the headless body.
  let normalizedHead: string;
  const dotIdx = head.indexOf(".");
  if (dotIdx >= 0) {
    let cursor = dotIdx + 1;
    let fractional = "";
    while (cursor < head.length && /[0-9]/.test(head[cursor]!)) {
      fractional += head[cursor];
      cursor += 1;
    }
    if (fractional === "") {
      // ".X" with no digits — bail.
      return null;
    }
    if (cursor !== head.length) {
      // Garbage between the fractional digits and the (already-stripped)
      // tz suffix — bail rather than silently truncate.
      return null;
    }
    const ms = fractional.slice(0, 3).padEnd(3, "0");
    normalizedHead = `${head.slice(0, dotIdx)}.${ms}`;
  } else {
    normalizedHead = `${head}.000`;
  }
  // Default to UTC when no timezone is supplied.
  s = `${normalizedHead}${tz || "Z"}`;
  // Quick well-formed gate: must look like an ISO date+time.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}/.test(s)) return null;
  return s;
}
