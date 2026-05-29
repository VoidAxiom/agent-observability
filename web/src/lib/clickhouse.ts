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

export function loadConfigFromEnv(
  env: ImportMetaEnv = (import.meta as ImportMeta).env ?? ({} as ImportMetaEnv),
): ClickHouseConfig {
  // Repo-standard names (`CH_*`) win — match clickhouse/migrate.sh,
  // docker-compose.yml, and the Swift app — falling back to the
  // `VITE_CH_*` prefix for web-only overrides during dev. vite.config.ts
  // adds `CH_` to `envPrefix` so Vite actually exposes them to client code.
  const portRaw = env.CH_HTTP_PORT ?? env.VITE_CH_HTTP_PORT ?? "";
  // Use Number() not parseInt() so trailing garbage ("8123x") returns NaN
  // instead of silently parsing as 8123.
  const portNum = typeof portRaw === "string" ? Number(portRaw) : NaN;
  return {
    host: env.CH_HOST ?? env.VITE_CH_HOST ?? "localhost",
    // Cap to the WHATWG URL port range so an out-of-range value (e.g.
    // 65536) doesn't pass the local check only to be silently dropped by
    // `url.port`, which would otherwise default the endpoint to port 80.
    port:
      Number.isFinite(portNum) &&
      portNum > 0 &&
      portNum <= 65535 &&
      Number.isInteger(portNum)
        ? portNum
        : 8123,
    database: env.CH_DATABASE ?? env.VITE_CH_DATABASE ?? "default",
    username: env.CH_USERNAME ?? env.VITE_CH_USERNAME ?? "default",
    password: env.CH_PASSWORD ?? env.VITE_CH_PASSWORD ?? "",
  };
}

// True assertion: returns void, throws ClickHouseError on a host/port
// the WHATWG URL parser wouldn't accept. Distinct from buildEndpointUrl
// (which returns the URL) so callers that need ONLY the validation
// (fetchOnce in browser-proxy mode, vite.config.ts's dev-proxy
// boot-time check) read structurally as "validate", not as "build the
// URL and discard it". The two callers MUST stay in lockstep — the
// proxy target the dev-server forwards to has to use the same host/port
// the SPA loader accepts, or env typos produce a silent 502.
export function assertConfigValid(config: ClickHouseConfig): void {
  buildEndpointUrl(config);
}

export function buildEndpointUrl(config: ClickHouseConfig): string {
  if (!HOSTNAME_RE.test(config.host)) {
    throw new ClickHouseError(
      `Invalid ClickHouse host ${JSON.stringify(config.host)}: must be a hostname, IPv4 address, or bracketed IPv6 address`,
      0,
    );
  }
  // Build via assignment rather than template interpolation so URL parser
  // can't be fooled by characters that survive the regex check. IPv6
  // literals must keep their brackets when assigned to `hostname` — the
  // URL spec rejects unbracketed `::1` and silently leaves the previous
  // hostname (the "placeholder" sentinel) in place, so the eventual
  // request would target the wrong host.
  // The WHATWG URL setters silently no-op when the value is rejected
  // (e.g. `[::::]` matches HOSTNAME_RE but is not a valid IPv6 literal,
  // so `url.hostname` stays as the sentinel). Build with a sentinel and
  // assert the setters actually mutated it before returning, so fetchOnce
  // can't ship a request at the wrong host. The sentinel is a name that
  // HOSTNAME_RE rejects, so a legitimate host can never collide with it.
  const HOSTNAME_SENTINEL = "placeholder.invalid";
  const PORT_SENTINEL = "1";
  const url = new URL(`http://${HOSTNAME_SENTINEL}:${PORT_SENTINEL}/`);
  url.hostname = config.host;
  if (url.hostname === HOSTNAME_SENTINEL) {
    throw new ClickHouseError(
      `Invalid ClickHouse host ${JSON.stringify(config.host)}: rejected by URL parser`,
      0,
    );
  }
  // WHATWG URL canonicalizes a scheme-default port (http=80) to an empty
  // `url.port` string while still routing requests at that port — so a
  // strict equality check would falsely reject the legitimate `port: 80`
  // case (ClickHouse behind an HTTP reverse proxy). Accept the empty
  // canonicalization for the http scheme's default port; reject everything
  // else (e.g. the silent-drop case where `port: 65536` leaves `url.port`
  // empty too).
  const portStr = String(config.port);
  url.port = portStr;
  const portAccepted =
    url.port === portStr || (url.port === "" && config.port === 80);
  if (!portAccepted) {
    throw new ClickHouseError(
      `Invalid ClickHouse port ${config.port}: rejected by URL parser`,
      0,
    );
  }
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

// Request path used by fetchOnce in the browser. Same-origin under Vite's
// dev-proxy (vite.config.ts maps /ch → http://<chHost>:<chPort>), so the
// browser never sees a cross-origin request and there's no CORS preflight.
// buildEndpointUrl is kept for its hostname/port validation and for the
// Tauri runtime path (VOI-347), where the HTTP plugin bypasses the browser
// origin model entirely and needs the absolute upstream URL.
export function buildRequestUrl(config: ClickHouseConfig): string {
  const params = new URLSearchParams({ database: config.database });
  return `/ch?${params.toString()}`;
}

export async function fetchOnce(
  config: ClickHouseConfig = loadConfigFromEnv(),
  fetchImpl: typeof fetch = fetch,
): Promise<SpanRow[]> {
  // Validate host/port up front so a misconfigured CH_HOST surfaces a
  // ClickHouseError at the same boundary it did before the proxy switch,
  // even though the actual fetch goes to the same-origin /ch path.
  assertConfigValid(config);
  const endpoint = buildRequestUrl(config);
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
