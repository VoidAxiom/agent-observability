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
});
