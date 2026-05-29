/*
 * clickhouse.ts — typed HTTP client + SELECT shape matching VOI-335's
 * app/Sources/AgentObservability/ClickHouseQueryService.swift (12-column
 * payload with raw attribute maps). Defaults match the Swift impl exactly
 * (localhost / 8123 / default / default / "").
 */

import type { SpanRow } from "./grouping";

const SELECT = `SELECT
  TraceId, SpanId, ParentSpanId, SpanName, Timestamp, ServiceName,
  ResourceAttributes['agent.project']    AS AgentProject,
  ResourceAttributes['agent.session.id'] AS AgentSessionId,
  SpanAttributes['agent.run.id']         AS AgentRunId,
  SpanAttributes['session.id']           AS SessionId,
  ResourceAttributes['project.name']     AS ProjectName,
  ResourceAttributes                     AS ResourceAttributesRaw,
  SpanAttributes                         AS SpanAttributesRaw,
  StatusCode,
  Duration
FROM otel_traces
ORDER BY Timestamp DESC
LIMIT 1000
FORMAT JSONEachRow`;

export interface ClickHouseConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
}

// Hostname grammar accepted by buildEndpointUrl. Conservative: DNS labels +
// IPv4 + bracketed IPv6. Rejects userinfo (`@`), path (`/`), query (`?`),
// fragment (`#`), and any other URL syntax that would silently retarget the
// request when interpolated into a URL template.
const HOSTNAME_RE = /^(?:\[[0-9a-fA-F:]+\]|[A-Za-z0-9][A-Za-z0-9.-]*)$/;

export function loadConfigFromEnv(): ClickHouseConfig {
  const env = (import.meta as ImportMeta).env ?? {};
  const portRaw = env.VITE_CH_HTTP_PORT ?? "";
  // Use Number() not parseInt() so trailing garbage ("8123x") returns NaN
  // instead of silently parsing as 8123.
  const portNum = typeof portRaw === "string" ? Number(portRaw) : NaN;
  return {
    host: env.VITE_CH_HOST ?? "localhost",
    port:
      Number.isFinite(portNum) && portNum > 0 && Number.isInteger(portNum)
        ? portNum
        : 8123,
    database: env.VITE_CH_DATABASE ?? "default",
    username: env.VITE_CH_USERNAME ?? "default",
    password: env.VITE_CH_PASSWORD ?? "",
  };
}

export function buildEndpointUrl(config: ClickHouseConfig): string {
  if (!HOSTNAME_RE.test(config.host)) {
    throw new ClickHouseError(
      `Invalid ClickHouse host ${JSON.stringify(config.host)}: must be a hostname, IPv4 address, or bracketed IPv6 address`,
      0,
    );
  }
  // Build via assignment rather than template interpolation so URL parser
  // can't be fooled by characters that survive the regex check.
  const url = new URL("http://placeholder/");
  url.hostname = config.host.startsWith("[")
    ? config.host.slice(1, -1)
    : config.host;
  url.port = String(config.port);
  url.pathname = "/";
  url.searchParams.set("database", config.database);
  return url.toString();
}

function authorizationHeader(config: ClickHouseConfig): string {
  const credentials = `${config.username}:${config.password}`;
  // btoa accepts only Latin1 codepoints, so a password containing accented
  // characters or emoji would throw InvalidCharacterError. UTF-8-encode
  // first via TextEncoder, then base64 the byte sequence.
  const bytes = new TextEncoder().encode(credentials);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i] as number);
  }
  return `Basic ${btoa(binary)}`;
}

export async function fetchOnce(
  config: ClickHouseConfig = loadConfigFromEnv(),
  fetchImpl: typeof fetch = fetch,
): Promise<SpanRow[]> {
  const endpoint = buildEndpointUrl(config);
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain; charset=UTF-8",
      Authorization: authorizationHeader(config),
    },
    body: SELECT,
  });
  if (!response.ok) {
    throw new ClickHouseError(
      `ClickHouse HTTP ${response.status}: ${response.statusText}`,
      response.status,
    );
  }
  const text = await response.text();
  return decodeRows(text);
}

export class ClickHouseError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ClickHouseError";
  }
}

/**
 * Decode a JSONEachRow-style payload. Tolerant of both:
 *   - one JSON-array containing the rows (`[ {..}, {..} ]`)
 *   - JSONEachRow proper (one object per line)
 *   - a single top-level object (pretty-printed single-row fixture)
 */
export function decodeRows(text: string): SpanRow[] {
  const trimmed = text.trim();
  if (trimmed === "") return [];

  // Try array first.
  if (trimmed[0] === "[") {
    try {
      const arr = JSON.parse(trimmed) as unknown;
      if (Array.isArray(arr)) {
        return arr
          .map((item) => coerceRow(item))
          .filter((r): r is SpanRow => r !== null);
      }
    } catch {
      // fall through to line-by-line.
    }
  }

  // Try single top-level object (only valid if the ENTIRE trimmed body parses).
  if (trimmed[0] === "{") {
    try {
      const obj = JSON.parse(trimmed) as unknown;
      if (obj && typeof obj === "object" && !Array.isArray(obj)) {
        const row = coerceRow(obj);
        return row ? [row] : [];
      }
    } catch {
      // fall through.
    }
  }

  // JSONEachRow: split on newlines.
  const rows: SpanRow[] = [];
  for (const rawLine of trimmed.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "") continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      const row = coerceRow(parsed);
      if (row) rows.push(row);
    } catch {
      // skip malformed lines; matches Swift behavior (log+continue).
    }
  }
  return rows;
}

function coerceRow(input: unknown): SpanRow | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const obj = input as Record<string, unknown>;
  const duration = parseDuration(obj.Duration);
  return {
    TraceId: asString(obj.TraceId),
    SpanId: asString(obj.SpanId),
    ParentSpanId: asString(obj.ParentSpanId),
    SpanName: asString(obj.SpanName),
    Timestamp: asString(obj.Timestamp),
    ServiceName: asString(obj.ServiceName),
    StatusCode: asString(obj.StatusCode),
    Duration: duration,
    AgentProject: asString(obj.AgentProject),
    AgentSessionId: asString(obj.AgentSessionId),
    AgentRunId: asString(obj.AgentRunId),
    SessionId: asString(obj.SessionId),
    ProjectName: asString(obj.ProjectName),
    ResourceAttributesRaw: asStringMap(obj.ResourceAttributesRaw),
    SpanAttributesRaw: asStringMap(obj.SpanAttributesRaw),
    depth: 0,
  };
}

function asString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

function asStringMap(v: unknown): Record<string, string> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, value] of Object.entries(v as Record<string, unknown>)) {
    if (typeof value === "string") out[k] = value;
    else if (typeof value === "number" || typeof value === "boolean") {
      out[k] = String(value);
    }
  }
  return out;
}

function parseDuration(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v;
  if (typeof v === "string") {
    const parsed = Number(v);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return 0;
}
