/*
 * grouping.ts — TypeScript port of app/Sources/AgentObservability/SessionGrouping.swift.
 *
 * Behaviour invariants (preserved from Swift):
 *  - Session key fallback: SpanAttributes['session.id'] (SessionId) >
 *    ResourceAttributes['agent.session.id'] (AgentSessionId) > TraceId.
 *    (VOI-339 r2 spec-corrected order — operator ratified.)
 *  - lastActivity uses span END time (Timestamp + Duration_ns), not start
 *    (VOI-335 r17 fix).
 *  - traceDurationSeconds = (max span end-time) - (min span start-time);
 *    handles single-span and long-child-starting-before-last-child cases
 *    (VOI-335 r12/r13 fix).
 *  - computeTreeOrder is cycle-safe via per-(TraceId, SpanId) visited set;
 *    sibling order is by Timestamp ascending with insertion-order tie-break.
 *    Bookkeeping is scoped by TraceId so colliding SpanIds across traces
 *    don't cross-talk.
 *  - hasError checks StatusCode + merged span/resource attributes for
 *    otel.status_code=ERROR, error=true, or any "exception.*" key.
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

export interface SessionGroup {
  id: string; // === sessionKey
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
}

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

export function groupSpans(rows: SpanRow[]): SessionGroup[] {
  if (rows.length === 0) return [];

  // Bucket by effective session key.
  const sessionBuckets = new Map<string, SpanRow[]>();
  for (const row of rows) {
    const key = effectiveSessionKey(row);
    let bucket = sessionBuckets.get(key);
    if (!bucket) {
      bucket = [];
      sessionBuckets.set(key, bucket);
    }
    bucket.push(row);
  }

  const sessions: SessionGroup[] = [];
  for (const [sessionKey, sessionRows] of sessionBuckets) {
    const traces = traceGroups(sessionRows);
    const sortedTraces = [...traces].sort((a, b) => {
      if (a.rootStart === b.rootStart) {
        return a.traceId < b.traceId ? -1 : a.traceId > b.traceId ? 1 : 0;
      }
      return b.rootStart - a.rootStart;
    });

    const projectName =
      firstSortedNonEmpty(sessionRows.map((r) => r.ProjectName)) ??
      firstSortedNonEmpty(sessionRows.map((r) => r.AgentProject)) ??
      "";
    const serviceName =
      firstSortedNonEmpty(sessionRows.map((r) => r.ServiceName)) ??
      "unknown service";
    const dates = datedRows(sessionRows);
    const last = latestEndingRow(dates);
    const duration = durationSecondsFromDates(dates);

    sessions.push({
      id: sessionKey,
      sessionKey,
      displayLabel: displayLabel(projectName, sessionKey),
      serviceName,
      projectName,
      lastActivity: last?.endDate ?? DISTANT_PAST,
      lastActivityText: last?.row.Timestamp ?? "",
      spanCount: sortedTraces.reduce((acc, t) => acc + t.spanCount, 0),
      traceCount: sortedTraces.length,
      durationSeconds: duration,
      hasError: sortedTraces.some((t) => t.hasError),
      traces: sortedTraces,
    });
  }

  return sessions.sort((a, b) => {
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

export function reconcileSelection(
  sessions: SessionGroup[],
  selectedSessionId: string | null | undefined,
  selectedTraceId: string | null | undefined,
  selectedSpanId: string | null | undefined,
): Selection {
  const sessionIds = new Set(sessions.map((s) => s.id));
  const traceIds = new Set<string>();
  const spanIds = new Set<string>();
  for (const s of sessions) {
    for (const t of s.traces) {
      traceIds.add(t.id);
      for (const span of t.spans) {
        spanIds.add(spanRowId(span));
      }
    }
  }

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

// ---------- internals ----------

interface TreeKey {
  traceId: string;
  spanId: string;
}
function treeKey(k: TreeKey): string {
  return `${k.traceId} ${k.spanId}`;
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

function rowHasError(row: SpanRow): boolean {
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
  // Find an optional ".<digits>" fractional section.
  const dotIdx = s.indexOf(".");
  if (dotIdx >= 0) {
    let cursor = dotIdx + 1;
    let fractional = "";
    while (cursor < s.length && /[0-9]/.test(s[cursor]!)) {
      fractional += s[cursor];
      cursor += 1;
    }
    if (fractional === "") {
      // ".X" with no digits — bail.
      return null;
    }
    const ms = fractional.slice(0, 3).padEnd(3, "0");
    s = `${s.slice(0, dotIdx)}.${ms}${s.slice(cursor)}`;
  } else {
    s += ".000";
  }
  // If it doesn't end in a timezone marker, append Z (UTC).
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) {
    s += "Z";
  }
  // Quick well-formed gate: must look like an ISO date+time.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}/.test(s)) return null;
  return s;
}
