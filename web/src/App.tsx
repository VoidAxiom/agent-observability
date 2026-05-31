import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { ThemeProvider } from "./theme/ThemeProvider";
import { ThemePicker } from "./theme/ThemePicker";
import { SessionSidebar } from "./components/SessionSidebar";
import { CollapsibleTraceList } from "./components/CollapsibleTraceList";
import { WaterfallShell } from "./components/WaterfallShell";
import { DetailsPane } from "./components/DetailsPane";
import { LiveHistoryTabs, type TabKey } from "./components/LiveHistoryTabs";
import { usePolledSpans } from "./lib/usePolledSpans";
import {
  findNodeById,
  reconcileSelection,
  spanRowId,
  type SessionGroup,
  type SessionNode,
  type SpanRow,
  type TraceGroup,
} from "./lib/grouping";
import { filterActive } from "./lib/sessionsFilter";
import "./app.css";

export function App() {
  return (
    <ThemeProvider>
      <Shell />
    </ThemeProvider>
  );
}

function readTabFromHash(): TabKey {
  if (typeof window === "undefined") return "live";
  const raw = window.location.hash.replace(/^#/, "").toLowerCase();
  if (raw === "history") return "history";
  return "live";
}

function Shell() {
  const { sessions, nowMs, error, loading, truncated } = usePolledSpans();
  const [tab, setTab] = useState<TabKey>(() => readTabFromHash());
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null,
  );
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);
  const [expandedTraceIds, setExpandedTraceIds] = useState<Set<string>>(
    () => new Set(),
  );
  // VOI-386: per-node expansion state mirroring expandedTraceIds. Root
  // claude nodes auto-expand on first appearance (useEffect below);
  // subagent + codex nodes start collapsed so the operator opts in to
  // depth. autoExpandedSeenRef tracks which root ids we've already
  // auto-expanded so a user collapse isn't undone the next time the
  // sessions array reference changes.
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(
    () => new Set(),
  );
  const autoExpandedSeenRef = useRef<Set<string>>(new Set());
  const [waterfallCollapsed, setWaterfallCollapsed] = useState<boolean>(false);

  // Keep the tab in sync with browser back/forward (the user may navigate
  // via the URL bar). Hashchange fires when location.hash mutates from
  // any source — including our own setter — so the comparison guards
  // against a feedback loop.
  useEffect(() => {
    const onHashChange = () => {
      const next = readTabFromHash();
      setTab((cur) => (cur === next ? cur : next));
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // Compute the active subset ONCE per tick and derive both
  // visibleSessions and the header active-count from it — the prior
  // version called filterActive three times per render (memo + header
  // subtitle + tabs counter), re-walking sessions O(N) twice for free.
  const activeSessions = useMemo<SessionGroup[]>(
    () => filterActive(sessions, nowMs),
    [sessions, nowMs],
  );
  const visibleSessions = useMemo<SessionGroup[]>(
    () => (tab === "live" ? activeSessions : sessions),
    [tab, activeSessions, sessions],
  );
  // VOI-386: counts walk the whole forest so subagent + codex children
  // count toward "// live · 3 of 8 sessions active", not just root claude
  // sessions. The header subtitle uses these.
  const activeCount = useMemo(
    () => countAllNodes(activeSessions),
    [activeSessions],
  );
  const totalCount = useMemo(() => countAllNodes(sessions), [sessions]);

  // Reconcile selection against the VISIBLE sessions set so when the user
  // switches Live → History (or vice versa) we don't keep a selection that
  // would render an "active" trace pane for a session that's hidden behind
  // a filter.
  useEffect(() => {
    if (visibleSessions.length === 0) {
      if (selectedSessionId || selectedTraceId || selectedSpanId) {
        setSelectedSessionId(null);
        setSelectedTraceId(null);
        setSelectedSpanId(null);
      }
      return;
    }

    const reconciled = reconcileSelection(
      visibleSessions,
      selectedSessionId,
      selectedTraceId,
      selectedSpanId,
    );

    let nextSessionId = reconciled.selectedSessionId;
    let nextTraceId = reconciled.selectedTraceId;
    let nextSpanId = reconciled.selectedSpanId;

    // Session-level auto-promotion: when no valid session exists (initial
    // load OR the prior session was evicted by data churn), fall back to
    // visibleSessions[0]. The fallback clears trace/span only when the
    // selected session actually changed — otherwise we'd nuke the user's
    // existing trace/span pick on every reconcile tick.
    if (!nextSessionId) {
      nextSessionId = visibleSessions[0]?.id ?? null;
      if (nextSessionId !== selectedSessionId) {
        nextTraceId = null;
        nextSpanId = null;
      }
    }

    // VOI-386: tree-aware lookup so a previously-selected subagent / codex
    // child node is preserved, not nulled because it isn't a top-level root.
    const activeSession = findNodeById(visibleSessions, nextSessionId);
    // Trace-level auto-promotion: ONLY when the session identity just
    // changed (initial load, data-churn eviction, or the user clicked a
    // different session). When the user clicks the SAME session and
    // explicitly cleared trace/span via onSelectSession's contract
    // (trace=null, span=null), the session is unchanged here — leave
    // trace null so DetailsPane renders the SESSION aggregate. Without
    // this guard, the user can never reach the trace/session aggregate
    // views because the deepest item is always re-promoted (codex P2
    // 2026-05-30).
    // Trace-level auto-promotion. The earlier logic always auto-promoted
    // the first trace whenever none was selected; that re-promoted the
    // first trace after the user clicked a session to view its aggregate,
    // making the SESSION mode of DetailsPane unreachable (codex P2
    // 2026-05-30). New rule: auto-promote ONLY when (a) the session
    // identity just changed (initial load / data-churn fall-back), or
    // (b) the held trace ID got evicted by data churn (selectedTraceId
    // was non-null on entry but reconcile nulled it). When the user
    // explicitly cleared trace via onSelectSession on the SAME session,
    // we leave trace null so DetailsPane renders SESSION mode.
    const sessionJustChanged = nextSessionId !== selectedSessionId;
    const traceWasEvicted =
      selectedTraceId !== null && reconciled.selectedTraceId === null;
    if (activeSession) {
      const traceStillValid =
        nextTraceId !== null &&
        activeSession.traces.some((t) => t.id === nextTraceId);
      if (!traceStillValid && (sessionJustChanged || traceWasEvicted)) {
        nextTraceId = activeSession.traces[0]?.id ?? null;
        nextSpanId = null;
      }
    } else {
      nextTraceId = null;
      nextSpanId = null;
    }

    // Span: never auto-promote. The trace aggregate is the more useful
    // default view; the user clicks an individual span to drill in.
    // If the held span ID becomes invalid (data eviction, user-cleared,
    // or trace just changed), drop it — DetailsPane falls back to TRACE
    // mode automatically.
    const activeTrace =
      activeSession?.traces.find((t) => t.id === nextTraceId) ?? null;
    if (activeTrace) {
      const spanStillValid =
        nextSpanId !== null &&
        activeTrace.spans.some((s) => spanRowId(s) === nextSpanId);
      if (!spanStillValid) {
        nextSpanId = null;
      }
    } else {
      nextSpanId = null;
    }

    if (nextSessionId !== selectedSessionId) setSelectedSessionId(nextSessionId);
    if (nextTraceId !== selectedTraceId) setSelectedTraceId(nextTraceId);
    if (nextSpanId !== selectedSpanId) setSelectedSpanId(nextSpanId);
  }, [
    visibleSessions,
    selectedSessionId,
    selectedTraceId,
    selectedSpanId,
  ]);

  // Prune expandedTraceIds against the trace IDs currently present in
  // ALL sessions (not just visibleSessions — History switches the filter
  // off and shouldn't drop expansion state for stale-but-still-listed
  // traces). Without this the Set accumulates dead keys for the lifetime
  // of a long-running tab, AND a re-emitted trace_id (fixture replay,
  // idempotent rerun) would auto-expand without the user clicking the
  // chevron — silently violating uncontrolled-collapse expectations.
  useEffect(() => {
    if (expandedTraceIds.size === 0) return;
    // Walk the whole forest — traces can live on any node (claude /
    // subagent / codex), and pruning only against root-level traces
    // would drop expansion state for traces visible inside expanded
    // subagent / codex children.
    const live = new Set<string>();
    forEachNode(sessions, (node) => {
      for (const t of node.traces) live.add(t.id);
    });
    let stale = false;
    for (const id of expandedTraceIds) {
      if (!live.has(id)) {
        stale = true;
        break;
      }
    }
    if (!stale) return;
    setExpandedTraceIds((prev) => {
      const next = new Set<string>();
      for (const id of prev) {
        if (live.has(id)) next.add(id);
      }
      return next;
    });
  }, [sessions, expandedTraceIds]);

  // VOI-386: auto-expand any new root claude node on first appearance so
  // operators see the nested tree without having to click. Idempotent —
  // never re-adds a node the user has explicitly collapsed (the union
  // with prev only adds NEW ids). Subagent + codex nodes stay collapsed
  // by default; operator opts in.
  useEffect(() => {
    if (sessions.length === 0) return;
    const seen = autoExpandedSeenRef.current;
    const toAdd: string[] = [];
    for (const root of sessions) {
      if (root.kind === "claude" && !seen.has(root.id)) {
        toAdd.push(root.id);
        seen.add(root.id);
      }
    }
    if (toAdd.length === 0) return;
    setExpandedNodeIds((prev) => {
      const next = new Set(prev);
      for (const id of toAdd) next.add(id);
      return next;
    });
  }, [sessions]);

  // VOI-386: prune expandedNodeIds against ALL live node ids in the
  // forest (not just visibleSessions — switching tabs shouldn't drop
  // state for a node visible in History but hidden in Live).
  // Compose the live-id set once per `sessions` reference and reuse it
  // in BOTH the auto-expanded-seen prune (sessions-driven) and the
  // expandedNodeIds-stale check (also sessions-driven). The earlier
  // single-effect version listed expandedNodeIds in deps, so every
  // chevron click forced a full-forest walk + Set rebuild even when
  // sessions hadn't changed — wasted O(N) work on every interaction.
  // Split per Claude /code-review round-2 P3 #1, 2026-05-31.
  const liveNodeIds = useMemo(() => {
    const live = new Set<string>();
    forEachNode(sessions, (node) => live.add(node.id));
    return live;
  }, [sessions]);

  // Prune the auto-expanded-seen tracking against live ids. Sessions-only
  // dep — auto-expand bookkeeping is independent of user toggles.
  useEffect(() => {
    const seen = autoExpandedSeenRef.current;
    if (seen.size === 0) return;
    let stale = false;
    for (const id of seen) {
      if (!liveNodeIds.has(id)) {
        stale = true;
        break;
      }
    }
    if (!stale) return;
    const pruned = new Set<string>();
    for (const id of seen) {
      if (liveNodeIds.has(id)) pruned.add(id);
    }
    autoExpandedSeenRef.current = pruned;
  }, [liveNodeIds]);

  // Prune expandedNodeIds against live ids. Sessions-only dep — a chevron
  // click can never make an id stale (it just toggles membership), so
  // listing expandedNodeIds in deps would trigger needless full-forest
  // walks on every interaction.
  useEffect(() => {
    setExpandedNodeIds((prev) => {
      if (prev.size === 0) return prev;
      let stale = false;
      for (const id of prev) {
        if (!liveNodeIds.has(id)) {
          stale = true;
          break;
        }
      }
      if (!stale) return prev;
      const next = new Set<string>();
      for (const id of prev) {
        if (liveNodeIds.has(id)) next.add(id);
      }
      return next;
    });
  }, [liveNodeIds]);

  const onSelectSession = useCallback(
    (id: string) => {
      // Always clear descendants on click — including when re-clicking the
      // already-selected session. With the post-VOI-346 SPAN>TRACE>SESSION
      // priority in DetailsPane, the SESSION aggregate is reachable ONLY
      // when trace+span are null; otherwise DetailsPane falls through to
      // TRACE/SPAN mode. The initial-load auto-promotion of the first
      // trace means a fresh load puts DetailsPane in TRACE mode, and a
      // bare-no-op early-return here would leave the user with no way to
      // reach SESSION mode for that auto-promoted session — they'd have
      // to navigate away to a different session and back. Codex round-5
      // P2 2026-05-30.
      setSelectedSessionId(id);
      setSelectedTraceId(null);
      setSelectedSpanId(null);
    },
    [],
  );
  const onSelectTrace = useCallback(
    (id: string) => {
      // Symmetric with onSelectSession: re-clicking the selected trace
      // clears the span so DetailsPane can show TRACE mode. Without this,
      // a span auto-promotion (none currently, but historically possible)
      // would lock the user into SPAN mode for that trace.
      setSelectedTraceId(id);
      setSelectedSpanId(null);
    },
    [],
  );
  const onSelectSpan = useCallback(
    (id: string) => {
      if (id === selectedSpanId) return;
      setSelectedSpanId(id);
    },
    [selectedSpanId],
  );
  const onToggleExpand = useCallback((traceId: string) => {
    setExpandedTraceIds((prev) => {
      const next = new Set(prev);
      if (next.has(traceId)) next.delete(traceId);
      else next.add(traceId);
      return next;
    });
  }, []);
  const onToggleNode = useCallback((nodeId: string) => {
    setExpandedNodeIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  const onTabChange = useCallback((next: TabKey) => {
    setTab(next);
    if (typeof window !== "undefined") {
      const desired = `#${next}`;
      if (window.location.hash !== desired) {
        // Use replaceState so tab toggles don't bloat the back-stack.
        window.history.replaceState(null, "", desired);
      }
    }
  }, []);

  // VOI-386: tree-aware lookup so a selected subagent / codex child node
  // resolves to the correct SessionNode (not null), and DetailsPane /
  // Waterfall / middle-pane scope to THAT node's spans (not the root).
  const activeSession: SessionNode | null = useMemo(
    () => findNodeById(visibleSessions, selectedSessionId),
    [visibleSessions, selectedSessionId],
  );
  const activeTrace: TraceGroup | null = useMemo(
    () => activeSession?.traces.find((t) => t.id === selectedTraceId) ?? null,
    [activeSession, selectedTraceId],
  );
  const activeSpan: SpanRow | null = useMemo(() => {
    if (!activeTrace) return null;
    return activeTrace.spans.find((s) => spanRowId(s) === selectedSpanId) ?? null;
  }, [activeTrace, selectedSpanId]);

  const sidebarEmpty = loading
    ? "// awaiting spans from ClickHouse..."
    : error
      ? `// ClickHouse error: ${error}`
      : tab === "live"
        ? "// no active sessions · switch to History for older"
        : "// no spans yet · run cc-launch.sh to emit one";

  return (
    <div className="voi-app" data-waterfall-collapsed={waterfallCollapsed ? "true" : "false"}>
      <header style={headerStyle}>
        <div style={titleColumnStyle}>
          <h1 style={titleStyle}>agent-observability</h1>
          <p style={subtitleStyle}>{buildSubtitle({ loading, error, tab, activeCount, totalCount })}</p>
        </div>
        <div style={headerControlsStyle}>
          <LiveHistoryTabs
            active={tab}
            onChange={onTabChange}
            activeCount={activeCount}
            totalCount={totalCount}
          />
          <ThemePicker />
        </div>
      </header>

      {/*
        The `<main>` landmark must contain ALL primary content. Previously
        only the top 3-pane row carried role=main and the waterfall sat as
        a sibling, so an assistive-tech user hitting the "main" landmark
        shortcut landed in the 3-pane grid only — the waterfall (the most
        time-consuming surface in the UI) was outside the main landmark.
        Codex round-4 P1 2026-05-30. The waterfall's own region landmark
        inside WaterfallShell still names the sub-region for screen-readers.
      */}
      <main className="voi-main" id="voi-sessions-panel">
        <div className="voi-top-row">
          <div style={paneContainerStyle}>
            <SessionSidebar
              sessions={visibleSessions}
              selectedSessionId={selectedSessionId}
              onSelect={onSelectSession}
              expandedNodeIds={expandedNodeIds}
              onToggleExpand={onToggleNode}
              nowMs={nowMs}
              emptyMessage={sidebarEmpty}
              truncated={truncated}
            />
          </div>
          <div style={paneContainerStyle}>
            <CollapsibleTraceList
              traces={activeSession?.traces ?? []}
              selectedTraceId={selectedTraceId}
              selectedSpanId={selectedSpanId}
              expandedTraceIds={expandedTraceIds}
              onSelectTrace={onSelectTrace}
              onSelectSpan={onSelectSpan}
              onToggleExpand={onToggleExpand}
              emptyMessage={
                activeSession
                  ? "// no traces in this session"
                  : "// select a session to load its traces"
              }
            />
          </div>
          <div style={paneContainerStyle}>
            <DetailsPane
              span={activeSpan}
              trace={activeTrace}
              session={activeSession}
              nowMs={nowMs}
              emptyMessage={
                loading
                  ? "// awaiting spans from ClickHouse..."
                  : error
                    ? `// ClickHouse error: ${error}`
                    : visibleSessions.length === 0
                      ? tab === "live"
                        ? "// no active sessions · switch to History for older"
                        : "// no spans yet · run cc-launch.sh to emit one"
                      : "// select a span to inspect its attributes"
              }
            />
          </div>
        </div>

        <div className="voi-waterfall-row">
          <WaterfallShell
            spans={activeTrace?.spans ?? []}
            durationSeconds={activeTrace?.durationSeconds ?? 0}
            selectedSpanId={selectedSpanId}
            onSelect={onSelectSpan}
            nowMs={nowMs}
            emptyMessage={
              activeTrace
                ? "// no spans in this trace"
                : "// select a trace to load its waterfall"
            }
            collapsed={waterfallCollapsed}
            onToggleCollapsed={() => setWaterfallCollapsed((c) => !c)}
          />
        </div>
      </main>
    </div>
  );
}

interface SubtitleInputs {
  loading: boolean;
  error: string | null;
  tab: TabKey;
  activeCount: number;
  totalCount: number;
}

// VOI-386: walk every node across the forest (root + nested children).
// Used by App for the header counts and the prune effects so subagent +
// codex children participate in the "// live · X of Y sessions active"
// count.
function forEachNode(
  nodes: SessionNode[],
  visit: (node: SessionNode) => void,
): void {
  const stack: SessionNode[] = [...nodes];
  while (stack.length > 0) {
    const node = stack.pop()!;
    visit(node);
    for (const child of node.children) stack.push(child);
  }
}

function countAllNodes(nodes: SessionNode[]): number {
  let n = 0;
  forEachNode(nodes, () => {
    n += 1;
  });
  return n;
}

function buildSubtitle({ loading, error, tab, activeCount, totalCount }: SubtitleInputs): string {
  if (loading) return "// awaiting spans from ClickHouse...";
  if (error) return `// ClickHouse error: ${error}`;
  if (tab === "live") {
    return `// live · ${activeCount} of ${totalCount} sessions active`;
  }
  return `// history · ${totalCount} sessions`;
}

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "16px",
  padding: "12px 24px",
  borderBottom: "1px solid var(--border-base)",
  flexWrap: "wrap",
  background: "var(--surface)",
};

const titleColumnStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "2px",
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-numeric)",
  fontSize: "20px",
  letterSpacing: "0.08em",
  color: "var(--text)",
};

const subtitleStyle: CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-mono)",
  fontSize: "11px",
  color: "var(--text-muted)",
};

const headerControlsStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "12px",
  flexWrap: "wrap",
};

const paneContainerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  overflow: "hidden",
};
