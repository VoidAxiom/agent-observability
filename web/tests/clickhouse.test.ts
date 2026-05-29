import { describe, expect, it, vi } from "vitest";

import {
  buildEndpointUrl,
  buildRequestUrl,
  ClickHouseError,
  fetchOnce,
  loadConfigFromEnv,
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

  it("rejects out-of-range port values at the loader (defaults to 8123)", () => {
    expect(loadConfigFromEnv(envFrom({ CH_HTTP_PORT: "65536" })).port).toBe(
      8123,
    );
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
