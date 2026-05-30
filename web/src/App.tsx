import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { ThemeProvider } from "./theme/ThemeProvider";
import { ThemePicker } from "./theme/ThemePicker";
import { SessionSidebar } from "./components/SessionSidebar";
import { TraceList } from "./components/TraceList";
import { SpanTree } from "./components/SpanTree";
import { InspectorPane } from "./components/InspectorPane";
import { usePolledSpans } from "./lib/usePolledSpans";
import {
  reconcileSelection,
  spanRowId,
  type SessionGroup,
  type SpanRow,
  type TraceGroup,
} from "./lib/grouping";

export function App() {
  return (
    <ThemeProvider>
      <Shell />
    </ThemeProvider>
  );
}

function Shell() {
  const { sessions, nowMs, error, loading } = usePolledSpans();
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null,
  );
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);

  // Reconcile selection against each refresh; auto-promote first
  // session/trace/span on initial data load so the UI is never empty when
  // data exists.
  useEffect(() => {
    if (sessions.length === 0) {
      if (selectedSessionId || selectedTraceId || selectedSpanId) {
        setSelectedSessionId(null);
        setSelectedTraceId(null);
        setSelectedSpanId(null);
      }
      return;
    }

    const reconciled = reconcileSelection(
      sessions,
      selectedSessionId,
      selectedTraceId,
      selectedSpanId,
    );

    let nextSessionId = reconciled.selectedSessionId;
    let nextTraceId = reconciled.selectedTraceId;
    let nextSpanId = reconciled.selectedSpanId;

    if (!nextSessionId) {
      nextSessionId = sessions[0]?.id ?? null;
      nextTraceId = null;
      nextSpanId = null;
    }

    const activeSession = sessions.find((s) => s.id === nextSessionId) ?? null;
    if (activeSession) {
      // If the trace selection is stale (e.g. removed) OR unset, promote
      // the most-recent trace of the active session so the middle pane
      // is never blank when traces exist.
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
  }, [sessions, selectedSessionId, selectedTraceId, selectedSpanId]);

  const onSelectSession = (id: string) => {
    setSelectedSessionId(id);
    setSelectedTraceId(null);
    setSelectedSpanId(null);
  };
  const onSelectTrace = (id: string) => {
    setSelectedTraceId(id);
    setSelectedSpanId(null);
  };
  const onSelectSpan = (id: string) => {
    setSelectedSpanId(id);
  };

  const activeSession: SessionGroup | null = useMemo(
    () => sessions.find((s) => s.id === selectedSessionId) ?? null,
    [sessions, selectedSessionId],
  );
  const activeTrace: TraceGroup | null = useMemo(
    () => activeSession?.traces.find((t) => t.id === selectedTraceId) ?? null,
    [activeSession, selectedTraceId],
  );
  const activeSpan: SpanRow | null = useMemo(() => {
    if (!activeTrace) return null;
    return activeTrace.spans.find((s) => spanRowId(s) === selectedSpanId) ?? null;
  }, [activeTrace, selectedSpanId]);

  const totalSpans = useMemo(
    () => sessions.reduce((acc, s) => acc + s.spanCount, 0),
    [sessions],
  );

  const subtitle = buildSubtitle({
    loading,
    error,
    sessionCount: sessions.length,
    totalSpans,
  });

  const sidebarEmpty = loading
    ? "// awaiting spans from ClickHouse..."
    : error
      ? `// ClickHouse error: ${error}`
      : "// no spans yet · run cc-launch.sh to emit one";

  return (
    <div style={shellStyle}>
      <header style={headerStyle}>
        <div style={titleColumnStyle}>
          <h1 style={titleStyle}>agent-observability</h1>
          <p style={subtitleStyle}>{subtitle}</p>
        </div>
        <ThemePicker />
      </header>

      <main style={gridStyle}>
        <div style={paneContainerStyle}>
          <SessionSidebar
            sessions={sessions}
            selectedSessionId={selectedSessionId}
            onSelect={onSelectSession}
            nowMs={nowMs}
            emptyMessage={sidebarEmpty}
          />
        </div>
        <div style={{ ...paneContainerStyle, ...verticalRuleStyle }}>
          <TraceList
            traces={activeSession?.traces ?? []}
            selectedTraceId={selectedTraceId}
            onSelect={onSelectTrace}
            emptyMessage={
              activeSession
                ? "// no traces in this session"
                : "// select a session to load its traces"
            }
          />
        </div>
        <div style={{ ...paneContainerStyle, ...verticalRuleStyle }}>
          <div style={spansHalfStyle}>
            <SpanTree
              trace={activeTrace}
              selectedSpanId={selectedSpanId}
              onSelect={onSelectSpan}
            />
          </div>
          <div style={inspectorHalfStyle}>
            <InspectorPane span={activeSpan} />
          </div>
        </div>
      </main>
    </div>
  );
}

interface SubtitleInputs {
  loading: boolean;
  error: string | null;
  sessionCount: number;
  totalSpans: number;
}

function buildSubtitle({
  loading,
  error,
  sessionCount,
  totalSpans,
}: SubtitleInputs): string {
  if (loading) return "// awaiting spans from ClickHouse...";
  if (error) return `// ClickHouse error: ${error}`;
  return `// ${sessionCount} sessions · ${totalSpans} spans`;
}

const shellStyle: CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  flexDirection: "column",
  background: "var(--bg)",
  color: "var(--text)",
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "16px",
  padding: "16px 24px",
  borderBottom: "1px solid var(--border-base)",
  flexWrap: "wrap",
};

const titleColumnStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "4px",
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

const gridStyle: CSSProperties = {
  flex: 1,
  display: "grid",
  gridTemplateColumns: "minmax(280px, 320px) minmax(320px, 360px) 1fr",
  gap: 0,
  minHeight: 0,
};

const paneContainerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  overflow: "hidden",
};

const verticalRuleStyle: CSSProperties = {
  borderLeft: "1px solid var(--border-base)",
};

const spansHalfStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
};

const inspectorHalfStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  borderTop: "1px solid var(--border-base)",
};
