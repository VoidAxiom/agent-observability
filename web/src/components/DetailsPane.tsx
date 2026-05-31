/*
 * DetailsPane — right pane of the top 3-pane grid. Context-sensitive
 * rendering: SPAN > TRACE > SESSION priority. The deepest selected
 * entity drives the view.
 *
 *  - SPAN mode: hero numerals (duration, tokens, ttft) + 4 attribute
 *    group cards (REQUEST / RESPONSE / IDENTITY / ENVIRONMENT) + OTHER.
 *    Hidden-keys filter applied via attributeGroups.ts.
 *  - TRACE mode: hero duration (seconds) + 3 small stats + terminal
 *    comment summary.
 *  - SESSION mode: hero span count + 2 small stats + terminal comment
 *    summary.
 *  - Empty: placeholder text.
 *
 * Carries forward the hero-numeral + per-card structure from InspectorPane;
 * the SPAN branch IS the prior InspectorPane (modulo the hidden-keys filter).
 */

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { Copy } from "lucide-react";
import type { SessionGroup, SpanRow, TraceGroup } from "../lib/grouping";
import { rowHasError } from "../lib/grouping";
import { familyToAccentVar, spanNameToFamily } from "../lib/spanFamily";
import {
  groupAttributes,
  type AttributeGroup,
  type GroupedAttributes,
} from "../lib/attributeGroups";
import { formatHeroDurationMs, formatHeroMagnitude } from "../lib/formatHero";
import {
  formatAbsoluteEst,
  formatAbsoluteEstWithDate,
  isAbsoluteTimeAvailable,
} from "../lib/formatTime";
import "./DetailsPane.css";

export interface DetailsPaneProps {
  span: SpanRow | null;
  trace: TraceGroup | null;
  session: SessionGroup | null;
  nowMs: number;
  /**
   * Context-aware empty-state message. Cold-start ("// awaiting spans
   * from ClickHouse...") differs from steady-state ("// select a span
   * to inspect..."); App supplies whichever applies so the empty pane
   * never lies about whether there's anything to select.
   */
  emptyMessage?: string;
}

interface HeroNumeral {
  key: string;
  label: string;
  /** Magnitude-formatted display value (e.g. "524.9k", "12.4s"). */
  display: string;
  /** Exact value for the tooltip (e.g. "524,913", "12.439s"). */
  exact: string;
  color: string;
}

const TOAST_DURATION_MS = 1500;

export function DetailsPane({ span, trace, session, nowMs, emptyMessage }: DetailsPaneProps) {
  if (span) {
    // Key the SpanDetails instance on the span identity so its internal
    // state (copy-toast + in-flight setTimeout) resets when the user
    // switches spans. Without this, a "copied request_id" toast started
    // for span A lingers over span B's identity card until the original
    // 1.5s timer fires. Codex round-4 P1 2026-05-30.
    return <SpanDetails key={`${span.TraceId}|${span.SpanId}`} span={span} />;
  }
  if (trace) {
    return <TraceDetails trace={trace} />;
  }
  if (session) {
    return <SessionDetails session={session} nowMs={nowMs} />;
  }
  return (
    <section aria-label="Details" style={emptyPaneStyle}>
      <p style={emptyTextStyle}>
        {emptyMessage ?? "// select a span to inspect its attributes"}
      </p>
    </section>
  );
}

// ===========================================================================
// SPAN mode (the prior InspectorPane, with the hidden-keys filter applied
// via attributeGroups.groupAttributes()).
// ===========================================================================

interface SpanDetailsProps {
  span: SpanRow;
}

function SpanDetails({ span }: SpanDetailsProps) {
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (toast === null) return;
    const handle = window.setTimeout(() => setToast(null), TOAST_DURATION_MS);
    return () => window.clearTimeout(handle);
  }, [toast]);

  const mergedAttrs = useMemo(() => {
    const merged: Record<string, string> = { ...span.ResourceAttributesRaw };
    for (const [k, v] of Object.entries(span.SpanAttributesRaw)) {
      merged[k] = v;
    }
    // Promote top-level identity columns so the IDENTITY card carries
    // TraceId/SpanId (spec acceptance) — they live as SpanRow columns,
    // not in the otel attribute maps.
    if (span.TraceId) merged.TraceId = span.TraceId;
    if (span.SpanId) merged.SpanId = span.SpanId;
    return merged;
  }, [span]);

  const grouped = useMemo<GroupedAttributes[]>(
    () => groupAttributes(mergedAttrs),
    [mergedAttrs],
  );

  const heroNumerals = useMemo<HeroNumeral[]>(() => {
    return buildSpanHeroNumerals(span, mergedAttrs);
  }, [span, mergedAttrs]);

  const handleCopy = useCallback(async (label: string, value: string) => {
    if (
      typeof navigator === "undefined" ||
      !navigator.clipboard?.writeText
    ) {
      setToast("copy unavailable");
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      setToast(`copied ${label}`);
    } catch {
      setToast("copy failed");
    }
  }, []);

  const family = spanNameToFamily(span.SpanName);
  const accent = familyToAccentVar(family);
  const statusText = resolveStatusText(span.StatusCode);

  return (
    <section aria-label="Details" style={paneStyle}>
      <header style={headerStyle}>
        <div style={headerTopStyle}>
          <span aria-hidden="true" style={{ ...accentDot, background: accent }} />
          <h2 style={titleStyle}>{span.SpanName}</h2>
          <span style={statusPillStyle} data-status={statusText}>
            {statusText}
          </span>
        </div>
        <p style={metaCommentStyle}>{`// ${family} · ${span.ServiceName}`}</p>
      </header>

      {heroNumerals.length > 0 ? (
        <div style={heroBandStyle} data-testid="voi-hero-band">
          {heroNumerals.map((n) => (
            <HeroCell key={n.key} numeral={n} />
          ))}
        </div>
      ) : null}

      <div style={groupsStackStyle}>
        {grouped.map(({ group, entries }) => (
          <AttributeCard
            key={group.name}
            group={group}
            entries={entries}
            onCopy={handleCopy}
          />
        ))}
      </div>

      {toast ? (
        <div role="status" aria-live="polite" style={toastStyle}>
          {toast}
        </div>
      ) : null}
    </section>
  );
}

// ===========================================================================
// TRACE mode
// ===========================================================================

interface TraceDetailsProps {
  trace: TraceGroup;
}

function TraceDetails({ trace }: TraceDetailsProps) {
  const cyan = "var(--accent-3)";
  const services = useMemo(() => {
    const set = new Set<string>();
    for (const s of trace.spans) {
      if (s.ServiceName) set.add(s.ServiceName);
    }
    return Array.from(set);
  }, [trace.spans]);
  // Use the canonical rowHasError predicate (4 shapes: StatusCode,
  // merged otel.status_code, error attr, exception.* keys) so this
  // count agrees with session.hasError / trace.hasError — a span that
  // sets exception.message but UNSET StatusCode would otherwise show as
  // errors:0 here while the sidebar marks the row as failing.
  const errorCount = trace.spans.reduce((n, s) => (rowHasError(s) ? n + 1 : n), 0);
  const rootName = trace.spans[0]?.SpanName ?? trace.displayLabel;

  // Use the canonical hero formatter so the trace hero number matches
  // the span hero band's ms precision rules (e.g. 47.3ms not 47ms under
  // 100ms). Hand-rolling the formatter here let the two surfaces drift
  // — codex round-4 P2 2026-05-30.
  const durationDisplay = formatHeroDurationMs(trace.durationSeconds * 1000);
  const durationExact = `${trace.durationSeconds.toFixed(6)}s`;

  // VOI-389 round-5 (codex P2 altitude fix, follow-up): trace.rootStart
  // is now trustworthy — grouping filters the DISTANT_PAST sentinel
  // BEFORE picking the trace min, so partially-valid traces no longer
  // poison this value. Consume the prop directly instead of re-deriving.
  const hasRootStart = isAbsoluteTimeAvailable(trace.rootStart);

  return (
    <section aria-label="Details" style={paneStyle}>
      <header style={headerStyle}>
        <div style={headerTopStyle}>
          <span aria-hidden="true" style={{ ...accentDot, background: cyan }} />
          <h2 style={titleStyle}>{trace.displayLabel}</h2>
          <span style={statusPillStyle}>TRACE</span>
        </div>
        <p style={metaCommentStyle}>{`// root ${rootName}`}</p>
      </header>

      <div style={heroBandStyle} data-testid="voi-hero-band">
        <HeroCell
          numeral={{
            key: "duration",
            label: "duration",
            display: durationDisplay,
            exact: durationExact,
            color: cyan,
          }}
        />
      </div>

      <div style={miniStatsRowStyle}>
        <MiniStat label="spans" value={String(trace.spanCount)} />
        <MiniStat label="errors" value={String(errorCount)} />
        <MiniStat label="services" value={String(services.length)} />
        {/* VOI-389: absolute EST wall-clock start. trace.rootStart is
            the earliest PARSEABLE Timestamp across the trace's spans
            (grouping filters the DISTANT_PAST sentinel before picking
            the min — VOI-389 round-5 codex altitude fix). All-unparseable
            still falls back to the sentinel, which the formatter
            renders as "--" and the title suppresses (see
            traceStartTitle above). */}
        <MiniStat
          label="started"
          value={formatAbsoluteEst(trace.rootStart)}
          title={hasRootStart ? formatAbsoluteEstWithDate(trace.rootStart) : undefined}
        />
      </div>

      <p style={summaryCommentStyle}>
        {`// ${trace.spanCount} spans across ${services.length} service${services.length === 1 ? "" : "s"} · root ${rootName}`}
      </p>
    </section>
  );
}

// ===========================================================================
// SESSION mode
// ===========================================================================

interface SessionDetailsProps {
  session: SessionGroup;
  nowMs: number;
}

function SessionDetails({ session, nowMs }: SessionDetailsProps) {
  const cyan = "var(--accent-3)";
  // VOI-389: prefer absolute EST wall-clock for the visible value; keep
  // the relative-seconds form in the hover title so operators correlating
  // against logs still get the secondary signal. Guard against the
  // DISTANT_PAST sentinel — without this, lastActivitySeconds is ~8.64e12
  // and the title leaks "-- · 8640000000000s ago" (Claude /code-review
  // P1 2026-05-31).
  const lastActivityAbs = formatAbsoluteEst(session.lastActivity);
  const hasAbsoluteTime = isAbsoluteTimeAvailable(session.lastActivity);
  const lastActivitySeconds = hasAbsoluteTime
    ? Math.max(0, Math.round((nowMs - session.lastActivity) / 1000))
    : null;
  const lastActivityTitle = hasAbsoluteTime
    ? `${formatAbsoluteEstWithDate(session.lastActivity)} · ${lastActivitySeconds}s ago`
    : "last activity unknown";

  const heroDisplay = formatHeroMagnitude(session.spanCount);
  const heroExact = session.spanCount.toLocaleString("en-US");

  return (
    <section aria-label="Details" style={paneStyle}>
      <header style={headerStyle}>
        <div style={headerTopStyle}>
          <span aria-hidden="true" style={{ ...accentDot, background: cyan }} />
          <h2 style={titleStyle}>{session.displayLabel}</h2>
          <span style={statusPillStyle}>SESSION</span>
        </div>
        <p style={metaCommentStyle}>{`// service ${session.serviceName}`}</p>
      </header>

      <div style={heroBandStyle} data-testid="voi-hero-band">
        <HeroCell
          numeral={{
            key: "spans",
            label: "spans",
            display: heroDisplay,
            exact: heroExact,
            color: cyan,
          }}
        />
      </div>

      <div style={miniStatsRowStyle}>
        <MiniStat label="traces" value={String(session.traceCount)} />
        <MiniStat
          label="last_activity"
          value={lastActivityAbs}
          title={lastActivityTitle}
        />
      </div>

      <p style={summaryCommentStyle}>
        {`// project=${session.projectName || "—"} · service=${session.serviceName}`}
      </p>
    </section>
  );
}

// ===========================================================================
// Shared cells
// ===========================================================================

interface HeroCellProps {
  numeral: HeroNumeral;
}

function HeroCell({ numeral }: HeroCellProps) {
  return (
    <div style={heroCellStyle} data-hero-key={numeral.key}>
      <span
        style={{ ...heroNumeralValueStyle, color: numeral.color }}
        data-tooltip={numeral.exact}
      >
        {numeral.display}
      </span>
      <span style={heroNumeralLabelStyle}>{`// ${numeral.label}`}</span>
    </div>
  );
}

interface MiniStatProps {
  label: string;
  value: string;
  /**
   * Optional title for hover — used by VOI-389 to surface the date +
   * relative-seconds form on the EST absolute-time MiniStats without
   * losing the secondary context.
   */
  title?: string;
}

function MiniStat({ label, value, title }: MiniStatProps) {
  return (
    <div style={miniStatStyle} title={title}>
      <span style={miniStatValueStyle}>{value}</span>
      <span style={miniStatLabelStyle}>{`// ${label}`}</span>
    </div>
  );
}

interface AttributeCardProps {
  group: AttributeGroup;
  entries: Array<[string, string]>;
  onCopy: (label: string, value: string) => void;
}

function AttributeCard({ group, entries, onCopy }: AttributeCardProps) {
  const isIdentity = group.name === "IDENTITY";
  return (
    <article
      style={cardStyle}
      data-group={group.name}
      aria-label={`${group.name} attributes`}
    >
      <header style={cardHeaderStyle}>
        <span
          aria-hidden="true"
          style={{
            ...groupDotStyle,
            background: group.dotVar,
            opacity: group.dotOpacity,
          }}
        />
        <h3 style={cardTitleStyle}>{group.name}</h3>
        <span style={cardCountStyle}>{`// ${entries.length}`}</span>
      </header>
      <dl style={dlStyle}>
        {entries.map(([key, value]) => (
          <div key={key} className="voi-inspector-row">
            <dt style={keyStyle}>{key}</dt>
            <dd style={valueStyle}>{value}</dd>
            {isIdentity ? (
              <button
                type="button"
                className="voi-inspector-copy"
                aria-label={`copy ${key}`}
                onClick={() => onCopy(key, value)}
                data-testid={`voi-copy-${key}`}
              >
                <Copy size={11} aria-hidden="true" />
              </button>
            ) : (
              <span aria-hidden="true" />
            )}
          </div>
        ))}
      </dl>
    </article>
  );
}

function buildSpanHeroNumerals(
  span: SpanRow,
  attrs: Record<string, string>,
): HeroNumeral[] {
  const cyan = "var(--accent-3)";
  const purple = "var(--accent-2)";

  const numerals: HeroNumeral[] = [];
  const durationMs = span.Duration / 1_000_000;
  numerals.push({
    key: "duration",
    label: "duration",
    display: formatHeroDurationMs(durationMs),
    exact: `${durationMs.toFixed(3)}ms`,
    color: cyan,
  });

  const inputTokens = readNumeric(attrs, [
    "input_tokens",
    "gen_ai.usage.input_tokens",
    "gen_ai.usage.prompt_tokens",
    "llm.usage.prompt_tokens",
  ]);
  if (inputTokens !== null) {
    numerals.push({
      key: "input_tokens",
      label: "in_tokens",
      display: formatHeroMagnitude(inputTokens),
      exact: inputTokens.toLocaleString("en-US"),
      color: cyan,
    });
  }

  const outputTokens = readNumeric(attrs, [
    "output_tokens",
    "gen_ai.usage.output_tokens",
    "gen_ai.usage.completion_tokens",
    "llm.usage.completion_tokens",
  ]);
  if (outputTokens !== null) {
    numerals.push({
      key: "output_tokens",
      label: "out_tokens",
      display: formatHeroMagnitude(outputTokens),
      exact: outputTokens.toLocaleString("en-US"),
      color: cyan,
    });
  }

  const cacheRead = readNumeric(attrs, [
    "cache_read_tokens",
    "gen_ai.usage.cache_read_tokens",
  ]);
  if (cacheRead !== null && numerals.length < 4) {
    numerals.push({
      key: "cache_read_tokens",
      label: "cache_read",
      display: formatHeroMagnitude(cacheRead),
      exact: cacheRead.toLocaleString("en-US"),
      color: cyan,
    });
  }

  const ttftMs = readNumeric(attrs, ["ttft", "gen_ai.response.ttft", "ttft_ms"]);
  if (ttftMs !== null && numerals.length < 4) {
    numerals.push({
      key: "ttft",
      label: "ttft",
      display: formatHeroDurationMs(ttftMs),
      exact: `${ttftMs.toFixed(3)}ms`,
      color: purple,
    });
  }

  return numerals.slice(0, 4);
}

function resolveStatusText(code: string): string {
  const upper = code.toUpperCase();
  if (upper === "" || upper === "STATUS_CODE_UNSET" || upper === "UNSET") {
    return "UNSET";
  }
  if (upper === "STATUS_CODE_OK") return "OK";
  if (upper === "STATUS_CODE_ERROR") return "ERROR";
  return code;
}

function readNumeric(
  attrs: Record<string, string>,
  candidates: string[],
): number | null {
  for (const key of candidates) {
    const raw = attrs[key];
    if (raw === undefined) continue;
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

const paneStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "16px",
  padding: "16px 14px",
  overflowY: "auto",
  height: "100%",
  position: "relative",
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
  flexWrap: "wrap",
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
  flex: "1 1 auto",
  minWidth: 0,
};

const statusPillStyle: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "10px",
  color: "var(--text-muted)",
  letterSpacing: "0.06em",
  border: "1px solid var(--border-base)",
  borderRadius: "var(--radius-sm)",
  padding: "1px 6px",
  textTransform: "uppercase",
};

const metaCommentStyle: CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-mono)",
  fontSize: "11px",
  color: "var(--text-muted)",
  letterSpacing: "0.02em",
};

const heroBandStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "32px",
  paddingTop: "4px",
};

const heroCellStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "4px",
  minWidth: 0,
};

const heroNumeralValueStyle: CSSProperties = {
  fontFamily: "var(--font-numeric)",
  fontSize: "56px",
  fontWeight: 500,
  letterSpacing: "-0.02em",
  lineHeight: 1,
  position: "relative",
  cursor: "help",
};

const heroNumeralLabelStyle: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "11px",
  color: "var(--text-muted)",
  letterSpacing: "0.05em",
};

const miniStatsRowStyle: CSSProperties = {
  display: "flex",
  gap: "24px",
  flexWrap: "wrap",
};

const miniStatStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "2px",
};

const miniStatValueStyle: CSSProperties = {
  fontFamily: "var(--font-numeric)",
  fontSize: "20px",
  color: "var(--text)",
  lineHeight: 1,
};

const miniStatLabelStyle: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "10px",
  color: "var(--text-muted)",
  letterSpacing: "0.04em",
};

const summaryCommentStyle: CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-mono)",
  fontSize: "11px",
  color: "var(--text-muted)",
};

const groupsStackStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "12px",
};

const cardStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "8px",
  padding: "12px",
  background: "var(--surface-raised)",
  border: "1px solid var(--border-base)",
  borderRadius: "var(--radius-card)",
};

const cardHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
};

const groupDotStyle: CSSProperties = {
  width: "6px",
  height: "6px",
  borderRadius: "50%",
  flexShrink: 0,
};

const cardTitleStyle: CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-numeric)",
  fontSize: "11px",
  letterSpacing: "0.15em",
  color: "var(--text)",
  textTransform: "uppercase",
  flex: "1 1 auto",
};

const cardCountStyle: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "10px",
  color: "var(--text-muted)",
  letterSpacing: "0.02em",
};

const dlStyle: CSSProperties = {
  margin: 0,
  display: "flex",
  flexDirection: "column",
  gap: "2px",
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

const toastStyle: CSSProperties = {
  position: "absolute",
  bottom: "12px",
  right: "12px",
  background: "var(--surface-raised)",
  border: "1px solid var(--accent-1)",
  color: "var(--accent-1)",
  fontFamily: "var(--font-mono)",
  fontSize: "11px",
  padding: "4px 10px",
  borderRadius: "var(--radius-sm)",
  letterSpacing: "0.04em",
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
