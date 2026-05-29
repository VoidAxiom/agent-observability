import { describe, expect, it } from "vitest";

import { buildEndpointUrl, ClickHouseError } from "../src/lib/clickhouse";

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
