import {
  useCallback,
  useEffect,
  useMemo,
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
  reconcileSelection,
  spanRowId,
  type SessionGroup,
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
  const { sessions, nowMs, error, loading } = usePolledSpans();
  const [tab, setTab] = useState<TabKey>(() => readTabFromHash());
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null,
  );
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);
  const [expandedTraceIds, setExpandedTraceIds] = useState<Set<string>>(
    () => new Set(),
  );
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
  const activeCount = activeSessions.length;
  const totalCount = sessions.length;

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

    if (!nextSessionId) {
      nextSessionId = visibleSessions[0]?.id ?? null;
      nextTraceId = null;
      nextSpanId = null;
    }

    const activeSession =
      visibleSessions.find((s) => s.id === nextSessionId) ?? null;
    if (activeSession) {
      if (!nextTraceId || !activeSession.traces.some((t) => t.id === nextTraceId)) {
        nextTraceId = activeSession.traces[0]?.id ?? null;
        nextSpanId = null;
      }
    } else {
      nextTraceId = null;
      nextSpanId = null;
    }

    const activeTrace =
      activeSession?.traces.find((t) => t.id === nextTraceId) ?? null;
    if (activeTrace) {
      if (
        !nextSpanId ||
        !activeTrace.spans.some((s) => spanRowId(s) === nextSpanId)
      ) {
        const firstSpan = activeTrace.spans[0];
        nextSpanId = firstSpan ? spanRowId(firstSpan) : null;
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

  const onSelectSession = useCallback(
    (id: string) => {
      if (id === selectedSessionId) return;
      setSelectedSessionId(id);
      setSelectedTraceId(null);
      setSelectedSpanId(null);
    },
    [selectedSessionId],
  );
  const onSelectTrace = useCallback(
    (id: string) => {
      if (id === selectedTraceId) return;
      setSelectedTraceId(id);
      setSelectedSpanId(null);
    },
    [selectedTraceId],
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

  const activeSession: SessionGroup | null = useMemo(
    () => visibleSessions.find((s) => s.id === selectedSessionId) ?? null,
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

      <main className="voi-top-row" id="voi-sessions-panel">
        <div style={paneContainerStyle}>
          <SessionSidebar
            sessions={visibleSessions}
            selectedSessionId={selectedSessionId}
            onSelect={onSelectSession}
            nowMs={nowMs}
            emptyMessage={sidebarEmpty}
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
      </main>

      <div className="voi-waterfall-row">
        <WaterfallShell
          spans={activeTrace?.spans ?? []}
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
