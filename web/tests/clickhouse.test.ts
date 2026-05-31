import { describe, expect, it, vi } from "vitest";

import {
  assertConfigValid,
  buildEndpointUrl,
  buildRequestUrl,
  ClickHouseError,
  fetchOnce,
  loadConfigFromEnv,
  loadQueryConfigFromEnv,
} from "../src/lib/clickhouse";

// Vitest gives each module its own `import.meta.env`, so mutating the
// test file's `import.meta.env` is invisible to clickhouse.ts. The loader
// accepts an explicit env object for dependency-injection testing; the
// production caller still defaults to `import.meta.env`.
function envFrom(overrides: Partial<ImportMetaEnv>): ImportMetaEnv {
  return overrides as ImportMetaEnv;
}

describe("buildEndpointUrl", () => {
  it("builds a hostname URL", () => {
    const url = buildEndpointUrl({
      host: "localhost",
      port: 8123,
      database: "default",
      username: "default",
      password: "",
    });
    expect(url).toBe("http://localhost:8123/?database=default");
  });

  it("builds an IPv4 URL", () => {
    const url = buildEndpointUrl({
      host: "127.0.0.1",
      port: 8123,
      database: "default",
      username: "default",
      password: "",
    });
    expect(url).toBe("http://127.0.0.1:8123/?database=default");
  });

  it("preserves bracketed IPv6 literals so URL.hostname accepts them", () => {
    // Regression: an earlier impl stripped the brackets before assigning
    // url.hostname, but the URL spec rejects unbracketed `::1` and silently
    // leaves the prior hostname (the "placeholder" sentinel), retargeting
    // the request to the wrong host.
    const url = buildEndpointUrl({
      host: "[::1]",
      port: 8123,
      database: "default",
      username: "default",
      password: "",
    });
    expect(url).toBe("http://[::1]:8123/?database=default");
  });

  it("rejects invalid hosts", () => {
    expect(() =>
      buildEndpointUrl({
        host: "evil host",
        port: 8123,
        database: "default",
        username: "default",
        password: "",
      }),
    ).toThrow(ClickHouseError);
  });

  it("rejects malformed IPv6 literals the URL parser silently no-ops", () => {
    // Regression: `[::::]` matches HOSTNAME_RE but the WHATWG URL setter
    // rejects it and leaves the sentinel hostname in place, so an earlier
    // impl would ship a request at the wrong host. Now caught at build.
    expect(() =>
      buildEndpointUrl({
        host: "[::::]",
        port: 8123,
        database: "default",
        username: "default",
        password: "",
      }),
    ).toThrow(ClickHouseError);
  });

  it("accepts the http scheme default port (80) which URL canonicalizes to empty", () => {
    // Regression: WHATWG URL drops port=80 on http: URLs to '' as a
    // canonicalization shortcut. An earlier strict equality check
    // incorrectly rejected this legitimate "ClickHouse behind a reverse
    // proxy on :80" case.
    const url = buildEndpointUrl({
      host: "ch.example.com",
      port: 80,
      database: "default",
      username: "default",
      password: "",
    });
    expect(url).toBe("http://ch.example.com/?database=default");
  });

  it("rejects out-of-range ports the URL parser silently drops", () => {
    // Regression: port 65536 passes the local integer check but the URL
    // setter rejects it and drops the port (defaulting to scheme default
    // 80). Catch the silent no-op at the build step instead of shipping
    // a query at the wrong port.
    expect(() =>
      buildEndpointUrl({
        host: "localhost",
        port: 65536,
        database: "default",
        username: "default",
        password: "",
      }),
    ).toThrow(ClickHouseError);
  });
});

describe("loadConfigFromEnv", () => {
  it("returns repo defaults when no env vars are set", () => {
    expect(loadConfigFromEnv(envFrom({}))).toEqual({
      host: "localhost",
      port: 8123,
      database: "default",
      username: "default",
      password: "",
    });
  });

  it("reads the repo-standard CH_* env-var names", () => {
    // Regression: the repo's .env.example + clickhouse/migrate.sh + Swift
    // app all use CH_HOST/CH_HTTP_PORT/etc. An earlier impl only honored
    // the VITE_CH_* prefix, so a CH_HOST=remote setting in the repo .env
    // was silently ignored by the web app while every other tool used it.
    const cfg = loadConfigFromEnv(
      envFrom({
        CH_HOST: "remote.example.com",
        CH_HTTP_PORT: "9000",
        CH_DATABASE: "observability",
        CH_USERNAME: "reader",
        CH_PASSWORD: "secret",
      }),
    );
    expect(cfg).toEqual({
      host: "remote.example.com",
      port: 9000,
      database: "observability",
      username: "reader",
      password: "secret",
    });
  });

  it("falls back to VITE_CH_* when the CH_* counterpart is unset", () => {
    const cfg = loadConfigFromEnv(
      envFrom({
        VITE_CH_HOST: "vite-only.example.com",
        VITE_CH_HTTP_PORT: "8124",
      }),
    );
    expect(cfg.host).toBe("vite-only.example.com");
    expect(cfg.port).toBe(8124);
  });

  it("prefers CH_* over VITE_CH_* when both are set", () => {
    const cfg = loadConfigFromEnv(
      envFrom({ CH_HOST: "repo-standard", VITE_CH_HOST: "vite-prefix" }),
    );
    expect(cfg.host).toBe("repo-standard");
  });

  it("throws on an explicitly-set but out-of-range CH_HTTP_PORT (does NOT silently default)", () => {
    // Regression: an earlier impl silently coerced CH_HTTP_PORT=65536 to
    // the default 8123, so a typo like CH_HTTP_PORT=81234 would boot the
    // dev-proxy + SPA loader against the wrong port and the failure
    // looked like a CH outage instead of a config typo. Now an
    // explicitly-set invalid value throws at load — caught by
    // vite.config.ts's try/catch around assertConfigValid and surfaced
    // as a loud boot-time error.
    expect(() => loadConfigFromEnv(envFrom({ CH_HTTP_PORT: "65536" }))).toThrow(
      ClickHouseError,
    );
    expect(() => loadConfigFromEnv(envFrom({ CH_HTTP_PORT: "81234" }))).toThrow(
      ClickHouseError,
    );
    expect(() =>
      loadConfigFromEnv(envFrom({ CH_HTTP_PORT: "8123x" })),
    ).toThrow(ClickHouseError);
    expect(() => loadConfigFromEnv(envFrom({ CH_HTTP_PORT: "0" }))).toThrow(
      ClickHouseError,
    );
    expect(() => loadConfigFromEnv(envFrom({ CH_HTTP_PORT: "-1" }))).toThrow(
      ClickHouseError,
    );
    expect(() => loadConfigFromEnv(envFrom({ CH_HTTP_PORT: "8123.5" }))).toThrow(
      ClickHouseError,
    );
  });

  it("uses the 8123 default when CH_HTTP_PORT is unset or empty (distinct from set-but-invalid)", () => {
    expect(loadConfigFromEnv(envFrom({})).port).toBe(8123);
    expect(loadConfigFromEnv(envFrom({ CH_HTTP_PORT: "" })).port).toBe(8123);
  });
});

describe("assertConfigValid", () => {
  it("returns void when the config validates (true assertion, not a build-and-discard alias)", () => {
    // Distinct from buildEndpointUrl: callers that need ONLY the
    // validation (fetchOnce in browser-proxy mode, vite.config.ts at
    // boot) read structurally as "validate". The two callers MUST stay
    // in lockstep or env typos produce silent 502s.
    expect(
      assertConfigValid({
        host: "127.0.0.1",
        port: 8123,
        database: "default",
        username: "default",
        password: "",
      }),
    ).toBeUndefined();
  });

  it("throws ClickHouseError on a bad host (so vite.config.ts surfaces an env-typo at boot)", () => {
    expect(() =>
      assertConfigValid({
        host: "evil host",
        port: 8123,
        database: "default",
        username: "default",
        password: "",
      }),
    ).toThrow(ClickHouseError);
  });

  it("throws ClickHouseError on a malformed IPv6 the URL setter would silently no-op", () => {
    expect(() =>
      assertConfigValid({
        host: "[::::]",
        port: 8123,
        database: "default",
        username: "default",
        password: "",
      }),
    ).toThrow(ClickHouseError);
  });
});

describe("buildRequestUrl", () => {
  it("returns a same-origin path so the dev-proxy avoids a CORS preflight", () => {
    // The browser sees /ch?database=... as same-origin (Vite serves the
    // SPA and the proxy alike). An absolute http://127.0.0.1:8123/?...
    // would trip a preflight that ClickHouse's default config rejects.
    const url = buildRequestUrl({
      host: "localhost",
      port: 8123,
      database: "default",
      username: "default",
      password: "",
    });
    expect(url).toBe("/ch?database=default");
  });

  it("URL-encodes database names that need escaping", () => {
    const url = buildRequestUrl({
      host: "localhost",
      port: 8123,
      database: "obs analytics+v2",
      username: "default",
      password: "",
    });
    expect(url).toBe("/ch?database=obs+analytics%2Bv2");
  });
});

describe("loadQueryConfigFromEnv", () => {
  it("returns defaults when no env vars are set (1h window, 50k ceiling)", () => {
    expect(loadQueryConfigFromEnv(envFrom({}))).toEqual({
      windowHours: 1,
      limitCeiling: 50_000,
    });
  });

  it("reads VITE_CH_QUERY_WINDOW_HOURS and VITE_CH_QUERY_LIMIT_CEILING", () => {
    const cfg = loadQueryConfigFromEnv(
      envFrom({
        VITE_CH_QUERY_WINDOW_HOURS: "6",
        VITE_CH_QUERY_LIMIT_CEILING: "100000",
      }),
    );
    expect(cfg).toEqual({ windowHours: 6, limitCeiling: 100_000 });
  });

  it("reads the repo-standard CH_QUERY_* names and prefers them over VITE_CH_QUERY_*", () => {
    // Same convention as loadConfigFromEnv: CH_* is repo-standard
    // (matches .env.example, migrate.sh, docker-compose, Swift app);
    // VITE_CH_* is the web-only fallback. An operator setting
    // CH_QUERY_LIMIT_CEILING in repo-root .env must NOT have it
    // silently ignored.
    const onlyRepoStandard = loadQueryConfigFromEnv(
      envFrom({
        CH_QUERY_WINDOW_HOURS: "12",
        CH_QUERY_LIMIT_CEILING: "200000",
      }),
    );
    expect(onlyRepoStandard).toEqual({
      windowHours: 12,
      limitCeiling: 200_000,
    });

    const bothSet = loadQueryConfigFromEnv(
      envFrom({
        CH_QUERY_WINDOW_HOURS: "12",
        VITE_CH_QUERY_WINDOW_HOURS: "1",
      }),
    );
    expect(bothSet.windowHours).toBe(12);
  });

  it("throws on a present-but-invalid window-hours (not silently defaulted)", () => {
    // Regression discipline: the port loader throws on a present-but-
    // invalid value rather than coercing to the default, because silent
    // coercion of an env typo masks the failure. Same rule here — a
    // typo like VITE_CH_QUERY_WINDOW_HOURS=1h would otherwise make
    // the SPA query the wrong window and look like a polling bug.
    expect(() =>
      loadQueryConfigFromEnv(envFrom({ VITE_CH_QUERY_WINDOW_HOURS: "1h" })),
    ).toThrow(ClickHouseError);
    expect(() =>
      loadQueryConfigFromEnv(envFrom({ VITE_CH_QUERY_WINDOW_HOURS: "0" })),
    ).toThrow(ClickHouseError);
    expect(() =>
      loadQueryConfigFromEnv(envFrom({ VITE_CH_QUERY_WINDOW_HOURS: "-1" })),
    ).toThrow(ClickHouseError);
    expect(() =>
      loadQueryConfigFromEnv(envFrom({ VITE_CH_QUERY_WINDOW_HOURS: "1.5" })),
    ).toThrow(ClickHouseError);
  });

  it("throws on a present-but-invalid limit-ceiling", () => {
    expect(() =>
      loadQueryConfigFromEnv(envFrom({ VITE_CH_QUERY_LIMIT_CEILING: "bogus" })),
    ).toThrow(ClickHouseError);
    expect(() =>
      loadQueryConfigFromEnv(envFrom({ VITE_CH_QUERY_LIMIT_CEILING: "0" })),
    ).toThrow(ClickHouseError);
  });

  it("uses defaults when the env var is set to the empty string", () => {
    expect(
      loadQueryConfigFromEnv(envFrom({ VITE_CH_QUERY_WINDOW_HOURS: "" }))
        .windowHours,
    ).toBe(1);
  });
});

describe("fetchOnce SQL-construction boundary validation", () => {
  it("rejects a non-positive-integer windowHours at the SQL-construction site (not just at the env loader)", async () => {
    // Regression: /code-review round-2 P2 2026-05-30. ClickHouseQueryConfig
    // is typed as `{ windowHours: number; limitCeiling: number }`, so a
    // direct caller (test, future Tauri wiring, anyone constructing the
    // config without going through loadQueryConfigFromEnv) could pass
    // 1.5 / NaN / 0 / Infinity and produce malformed SQL like
    // `INTERVAL NaN HOUR`. Validation lives where the value is consumed.
    const fetchImpl = vi.fn();
    const cfg = {
      host: "localhost",
      port: 8123,
      database: "default",
      username: "default",
      password: "",
    };
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(
        fetchOnce(cfg, fetchImpl as unknown as typeof fetch, {
          windowHours: bad,
          limitCeiling: 100,
        }),
      ).rejects.toThrow(ClickHouseError);
    }
    // Same for limitCeiling.
    for (const bad of [0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(
        fetchOnce(cfg, fetchImpl as unknown as typeof fetch, {
          windowHours: 1,
          limitCeiling: bad,
        }),
      ).rejects.toThrow(ClickHouseError);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("fetchOnce", () => {
  it("POSTs to the same-origin /ch path, not the absolute upstream URL", async () => {
    // Regression: an earlier impl POSTed directly to
    // http://127.0.0.1:8123/?database=default, which triggered a CORS
    // preflight ClickHouse's default config refused, so no rows ever
    // reached the SPA in browser mode. Now the request hits Vite at /ch
    // and the proxy forwards to ClickHouse.
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response("[]", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await fetchOnce(
      {
        host: "localhost",
        port: 8123,
        database: "default",
        username: "default",
        password: "",
      },
      fetchImpl as unknown as typeof fetch,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchImpl.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(calledUrl).toBe("/ch?database=default");
    expect(init.method).toBe("POST");
  });

  it("SELECT body carries a Timestamp> windowing predicate (VOI-382 regression guard)", async () => {
    // Regression guard: before VOI-382, the SELECT was
    // `ORDER BY Timestamp DESC LIMIT 1000` with no WHERE clause; at
    // sustained 67 spans/sec ingest that covered only ~15s of history
    // and sessions flapped in/out. This test fails if anyone removes
    // the Timestamp> predicate or hardcodes the LIMIT back to 1000.
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response("[]", { status: 200 }),
    );
    await fetchOnce(
      {
        host: "localhost",
        port: 8123,
        database: "default",
        username: "default",
        password: "",
      },
      fetchImpl as unknown as typeof fetch,
      { windowHours: 3, limitCeiling: 12345 },
    );
    const init = fetchImpl.mock.calls[0]![1] as RequestInit;
    const body = String(init.body);
    expect(body).toMatch(/WHERE Timestamp > now\(\) - INTERVAL 3 HOUR/);
    expect(body).toMatch(/LIMIT 12345/);
    // Hard floor: the SELECT must not regress to a bare LIMIT 1000 with
    // no WHERE clause.
    expect(body).not.toMatch(/^[^W]*LIMIT 1000$/m);
  });

  it("returns truncated=true when row count meets the limit ceiling", async () => {
    // Three rows; ceiling=3 → truncated. The flag drives the
    // SessionSidebar's "// window truncated" chip; without it the operator
    // has no signal that older sessions were silently dropped.
    const fixtureRow = {
      TraceId: "t",
      SpanId: "s",
      ParentSpanId: "",
      SpanName: "x",
      Timestamp: "2026-01-01T00:00:00",
      ServiceName: "svc",
      AgentProject: "p",
      AgentSessionId: "as",
      AgentRunId: "r",
      SessionId: "sid",
      ProjectName: "p",
      ResourceAttributesRaw: {},
      SpanAttributesRaw: {},
      StatusCode: "",
      Duration: 0,
    };
    const body = JSON.stringify([fixtureRow, fixtureRow, fixtureRow]);
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(body, { status: 200 }),
    );
    const result = await fetchOnce(
      {
        host: "localhost",
        port: 8123,
        database: "default",
        username: "default",
        password: "",
      },
      fetchImpl as unknown as typeof fetch,
      { windowHours: 1, limitCeiling: 3 },
    );
    expect(result.rows.length).toBe(3);
    expect(result.truncated).toBe(true);
  });

  it("truncated detection uses raw row count, NOT parsed-row count (a single malformed JSONEachRow line must not produce a false-negative when CH actually hit the cap)", async () => {
    // Regression: /code-review round-1 P2 2026-05-30. decodeRows silently
    // skips malformed JSONEachRow lines (matches Swift's log+continue).
    // If truncation were computed from parsed rows.length, a single bad
    // line when CH returned EXACTLY limitCeiling rows would silently flip
    // the chip off — recreating the "silent data loss" failure mode that
    // VOI-382 was filed to surface in the first place.
    const goodRow = JSON.stringify({
      TraceId: "t",
      SpanId: "s",
      ParentSpanId: "",
      SpanName: "x",
      Timestamp: "2026-01-01T00:00:00",
      ServiceName: "svc",
      AgentProject: "p",
      AgentSessionId: "as",
      AgentRunId: "r",
      SessionId: "sid",
      ProjectName: "p",
      ResourceAttributesRaw: {},
      SpanAttributesRaw: {},
      StatusCode: "",
      Duration: 0,
    });
    // 3 "raw" rows: 2 good + 1 malformed (starts with `{` but is
    // unparseable). countRawRows must report 3, so with ceiling=3 we
    // detect truncation even though decodeRows only emits 2 rows.
    const body = `${goodRow}\n${goodRow}\n{ this is not valid json }`;
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(body, { status: 200 }),
    );
    const result = await fetchOnce(
      {
        host: "localhost",
        port: 8123,
        database: "default",
        username: "default",
        password: "",
      },
      fetchImpl as unknown as typeof fetch,
      { windowHours: 1, limitCeiling: 3 },
    );
    expect(result.rows.length).toBe(2);
    expect(result.truncated).toBe(true);
  });

  it("returns truncated=false when row count is below the ceiling", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response("[]", { status: 200 }),
    );
    const result = await fetchOnce(
      {
        host: "localhost",
        port: 8123,
        database: "default",
        username: "default",
        password: "",
      },
      fetchImpl as unknown as typeof fetch,
      { windowHours: 1, limitCeiling: 100 },
    );
    expect(result.rows).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it("still validates host/port at the fetch boundary", async () => {
    // Validation lives in buildEndpointUrl and fetchOnce calls it for
    // its side-effect — a misconfigured CH_HOST must surface a
    // ClickHouseError BEFORE we ship a half-built request.
    const fetchImpl = vi.fn();
    await expect(
      fetchOnce(
        {
          host: "evil host",
          port: 8123,
          database: "default",
          username: "default",
          password: "",
        },
        fetchImpl as unknown as typeof fetch,
      ),
    ).rejects.toThrow(ClickHouseError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
