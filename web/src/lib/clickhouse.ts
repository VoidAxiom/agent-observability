/*
 * clickhouse.ts — typed HTTP client + SELECT shape matching VOI-335's
 * app/Sources/AgentObservability/ClickHouseQueryService.swift (12-column
 * payload with raw attribute maps). Defaults match the Swift impl exactly
 * (localhost / 8123 / default / default / "").
 */

import type { SpanRow } from "./grouping";

// SELECT shape matches VOI-335's Swift ClickHouseQueryService (12-column
// payload with raw attribute maps). The shape is templated on a
// time-window predicate + a safety ceiling, both driven by
// ClickHouseQueryConfig (VOI-382): the prior unbounded
// `ORDER BY Timestamp DESC LIMIT 1000` covered only ~15s of history at
// sustained 67 spans/sec ingest, so any session that hadn't emitted in
// that window vanished and reappeared on alternating polls — flicker.
// Windowed query keeps a 1h scrollback by default; the ceiling is a
// safety cap so a quiet table can never load the entire history.
function buildSelect(windowHours: number, limitCeiling: number): string {
  // Validate at the SQL-construction boundary, not just at the env loader.
  // ClickHouseQueryConfig is typed as `{ windowHours: number; limitCeiling: number }`,
  // so a direct caller (test, future Tauri runtime wiring, anyone
  // constructing the config without going through loadQueryConfigFromEnv)
  // could pass 1.5, NaN, Infinity, or 0 and produce malformed SQL like
  // `INTERVAL NaN HOUR` or `LIMIT 1.5`. The discipline lives where the
  // value is consumed.
  assertPositiveInt(windowHours, "windowHours");
  assertPositiveInt(limitCeiling, "limitCeiling");
  return `SELECT
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
WHERE Timestamp > now() - INTERVAL ${windowHours} HOUR
ORDER BY Timestamp DESC
LIMIT ${limitCeiling}
FORMAT JSONEachRow`;
}

export interface ClickHouseConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
}

/**
 * Query-shape config — distinct from connection config (ClickHouseConfig)
 * so the loader can change query semantics (window, ceiling) without
 * touching connection plumbing. windowHours bounds how far back the
 * polling SELECT looks; limitCeiling is a safety cap on row count so a
 * silent table can never load the entire history. See VOI-382: prior
 * `LIMIT 1000` covered only ~15s at 67 spans/sec ingest, causing
 * sessions to flap.
 */
export interface ClickHouseQueryConfig {
  windowHours: number;
  limitCeiling: number;
}

const DEFAULT_WINDOW_HOURS = 1;
const DEFAULT_LIMIT_CEILING = 50_000;

function assertPositiveInt(n: number, name: string): void {
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    throw new ClickHouseError(
      `Invalid ${name} ${JSON.stringify(n)}: must be a positive integer`,
      0,
    );
  }
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
  const portRaw = env.CH_HTTP_PORT ?? env.VITE_CH_HTTP_PORT;
  let port = 8123;
  if (portRaw !== undefined && portRaw !== "") {
    // Use Number() not parseInt() so trailing garbage ("8123x") returns NaN
    // instead of silently parsing as 8123.
    const portNum = typeof portRaw === "string" ? Number(portRaw) : NaN;
    // Cap to the WHATWG URL port range so an out-of-range value (e.g.
    // 65536) doesn't pass the local check only to be silently dropped by
    // `url.port`, which would otherwise default the endpoint to port 80.
    // CRITICAL: distinguish "unset" (use default 8123) from "set but
    // invalid" (throw). Silently coercing a bad CH_HTTP_PORT=81234 to
    // 8123 would mask env typos — the dev-proxy and SPA loader would
    // happily point at the wrong port and the failure would look like
    // a CH outage instead of a config typo.
    if (
      !Number.isFinite(portNum) ||
      portNum <= 0 ||
      portNum > 65535 ||
      !Number.isInteger(portNum)
    ) {
      throw new ClickHouseError(
        `Invalid CH_HTTP_PORT / VITE_CH_HTTP_PORT ${JSON.stringify(portRaw)}: must be an integer in [1, 65535]`,
        0,
      );
    }
    port = portNum;
  }
  return {
    host: env.CH_HOST ?? env.VITE_CH_HOST ?? "localhost",
    port,
    database: env.CH_DATABASE ?? env.VITE_CH_DATABASE ?? "default",
    username: env.CH_USERNAME ?? env.VITE_CH_USERNAME ?? "default",
    password: env.CH_PASSWORD ?? env.VITE_CH_PASSWORD ?? "",
  };
}

/**
 * Read query-shape overrides from env. Both knobs (window + ceiling) are
 * positive-integer-only; an explicitly-set-but-invalid value throws (same
 * fail-loud discipline as the port loader) rather than silently coercing
 * to the default — a typo like `VITE_CH_QUERY_WINDOW_HOURS=1h` would
 * otherwise make the SPA query the wrong window and the failure would look
 * like a polling bug.
 */
export function loadQueryConfigFromEnv(
  env: ImportMetaEnv = (import.meta as ImportMeta).env ?? ({} as ImportMetaEnv),
): ClickHouseQueryConfig {
  // Honor BOTH the repo-standard CH_* convention (matches loadConfigFromEnv,
  // migrate.sh, docker-compose.yml, the Swift app) AND the VITE_CH_*
  // fallback for web-only overrides. Without this, an operator who sets
  // CH_QUERY_LIMIT_CEILING in repo-root .env (because that's the
  // convention every OTHER knob uses) would have it silently ignored
  // while the loader looked at VITE_CH_QUERY_LIMIT_CEILING only. The
  // error message names whichever variant the operator actually set, so
  // the typo callout points at the right line in their .env.
  // `windowEnv` not `window` — `window` would shadow the browser global
  // (this file is bundled into a hook that uses window.setInterval). No
  // bug today, but the shadow is a footgun if the helper grows.
  const windowEnv = pickRawEnv(
    env,
    "CH_QUERY_WINDOW_HOURS",
    "VITE_CH_QUERY_WINDOW_HOURS",
  );
  const ceilingEnv = pickRawEnv(
    env,
    "CH_QUERY_LIMIT_CEILING",
    "VITE_CH_QUERY_LIMIT_CEILING",
  );
  return {
    windowHours: parsePositiveIntEnv(
      windowEnv.raw,
      DEFAULT_WINDOW_HOURS,
      windowEnv.name,
    ),
    limitCeiling: parsePositiveIntEnv(
      ceilingEnv.raw,
      DEFAULT_LIMIT_CEILING,
      ceilingEnv.name,
    ),
  };
}

function pickRawEnv(
  env: ImportMetaEnv,
  primary: "CH_QUERY_WINDOW_HOURS" | "CH_QUERY_LIMIT_CEILING",
  fallback:
    | "VITE_CH_QUERY_WINDOW_HOURS"
    | "VITE_CH_QUERY_LIMIT_CEILING",
): { raw: string | undefined; name: string } {
  const primaryRaw = (env as Record<string, string | undefined>)[primary];
  if (primaryRaw !== undefined && primaryRaw !== "") {
    return { raw: primaryRaw, name: primary };
  }
  const fallbackRaw = (env as Record<string, string | undefined>)[fallback];
  if (fallbackRaw !== undefined && fallbackRaw !== "") {
    return { raw: fallbackRaw, name: fallback };
  }
  // Pass empty/undefined through; parser will return the default.
  return { raw: primaryRaw ?? fallbackRaw, name: primary };
}

function parsePositiveIntEnv(
  raw: string | undefined,
  fallback: number,
  name: string,
): number {
  if (raw === undefined || raw === "") return fallback;
  // Use Number() not parseInt() so trailing garbage ("1h") returns NaN
  // instead of silently parsing as 1. Matches the port loader's discipline.
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    throw new ClickHouseError(
      `Invalid ${name} ${JSON.stringify(raw)}: must be a positive integer`,
      0,
    );
  }
  return n;
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

export interface FetchResult {
  rows: SpanRow[];
  /**
   * True iff the raw CH response contained at least limitCeiling rows
   * (counted BEFORE coercion drops any malformed ones). Indicates the
   * window-query hit its safety cap and earlier spans were silently
   * dropped — SessionSidebar surfaces it as a "// window truncated"
   * chip so the operator knows to raise CH_QUERY_LIMIT_CEILING (or
   * VITE_CH_QUERY_LIMIT_CEILING as the web-only fallback) or shorten
   * CH_QUERY_WINDOW_HOURS.
   */
  truncated: boolean;
  /**
   * Number of row UNITS in the raw CH response (before coercion).
   * Distinct from rows.length, which can be smaller when individual
   * rows fail JSON.parse or coerceRow. Useful for diagnostics — the
   * truncation console.warn cites this so the logged count matches the
   * count truncated was actually decided from. Codex P2 round-3 2026-05-30.
   */
  rawRowCount: number;
}

export async function fetchOnce(
  config: ClickHouseConfig = loadConfigFromEnv(),
  fetchImpl: typeof fetch = fetch,
  queryConfig: ClickHouseQueryConfig = loadQueryConfigFromEnv(),
): Promise<FetchResult> {
  // Validate host/port up front so a misconfigured CH_HOST surfaces a
  // ClickHouseError at the same boundary it did before the proxy switch,
  // even though the actual fetch goes to the same-origin /ch path.
  assertConfigValid(config);
  const endpoint = buildRequestUrl(config);
  const body = buildSelect(queryConfig.windowHours, queryConfig.limitCeiling);
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain; charset=UTF-8",
      Authorization: authorizationHeader(config),
    },
    body,
  });
  if (!response.ok) {
    throw new ClickHouseError(
      `ClickHouse HTTP ${response.status}: ${response.statusText}`,
      response.status,
    );
  }
  const text = await response.text();
  // Single-pass decode that also reports the raw row count CH sent us
  // (NOT the parsed-row count — decodeRows silently skips malformed
  // JSONEachRow lines, so a single bad row at exactly limitCeiling rows
  // would otherwise false-negative the truncation chip and recreate the
  // silent-data-loss failure mode VOI-382 was filed to surface).
  const { rows, rawRowCount } = decodeRowsWithCount(text);
  return {
    rows,
    truncated: rawRowCount >= queryConfig.limitCeiling,
    rawRowCount,
  };
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
  return decodeRowsWithCount(text).rows;
}

/**
 * Same as decodeRows but ALSO reports the raw row count CH sent — i.e.
 * the number of row UNITS in the payload before coercion drops any that
 * fail to parse. Used by fetchOnce to detect "result hit the safety
 * ceiling" robustly: a single malformed JSONEachRow line must not flip
 * the truncation chip off when CH actually returned limitCeiling rows.
 * Folded into the decoder so the full text isn't scanned twice per poll
 * (default ceiling is 50k rows; a multi-MB payload every 5s is enough
 * that doing the same line-split twice adds up).
 */
export function decodeRowsWithCount(text: string): {
  rows: SpanRow[];
  rawRowCount: number;
} {
  const trimmed = text.trim();
  if (trimmed === "") return { rows: [], rawRowCount: 0 };

  // Try array first.
  if (trimmed[0] === "[") {
    try {
      const arr = JSON.parse(trimmed) as unknown;
      if (Array.isArray(arr)) {
        const rows = arr
          .map((item) => coerceRow(item))
          .filter((r): r is SpanRow => r !== null);
        // Array length is the authoritative raw count — even items that
        // fail coerceRow are still "rows CH sent" for cap-hit detection.
        return { rows, rawRowCount: arr.length };
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
        return { rows: row ? [row] : [], rawRowCount: 1 };
      }
    } catch {
      // fall through.
    }
  }

  // JSONEachRow: split on newlines. rawRowCount counts every non-empty
  // line as one "row CH sent", even ones that fail JSON.parse — this is
  // what makes the truncation chip robust to malformed-row drops.
  const rows: SpanRow[] = [];
  let rawRowCount = 0;
  for (const rawLine of trimmed.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "") continue;
    rawRowCount += 1;
    try {
      const parsed = JSON.parse(line) as unknown;
      const row = coerceRow(parsed);
      if (row) rows.push(row);
    } catch {
      // skip malformed lines; matches Swift behavior (log+continue).
    }
  }
  return { rows, rawRowCount };
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
