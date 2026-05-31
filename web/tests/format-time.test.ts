import { describe, expect, it } from "vitest";
import {
  formatAbsoluteEst,
  formatAbsoluteEstWithDate,
  formatAbsoluteEstWithMs,
} from "../src/lib/formatTime";

describe("formatAbsoluteEst", () => {
  it("renders an EST/EDT-suffixed wall-clock string", () => {
    // Don't pin a specific time — the format guarantees we care about are
    // the HH:MM:SS structure, the AM/PM, and the EST or EDT zone suffix.
    expect(formatAbsoluteEst(0)).toMatch(/^\d{1,2}:\d{2}:\d{2} (AM|PM) E[SD]T$/);
  });

  it("returns -- for NaN input", () => {
    expect(formatAbsoluteEst(Number.NaN)).toBe("--");
  });

  it("returns -- for Infinity input", () => {
    expect(formatAbsoluteEst(Number.POSITIVE_INFINITY)).toBe("--");
    expect(formatAbsoluteEst(Number.NEGATIVE_INFINITY)).toBe("--");
  });

  it("returns -- for the DISTANT_PAST sentinel (-8.64e15)", () => {
    // Matches the grouping.ts sentinel for unparseable Timestamps. Without
    // this branch the formatter renders a real but historically-absurd
    // GMT-offset string (e.g. "7:03:58 PM GMT-4:56:02") from new Date(-8.64e15).
    expect(formatAbsoluteEst(-8.64e15)).toBe("--");
    expect(formatAbsoluteEstWithDate(-8.64e15)).toBe("--");
    expect(formatAbsoluteEstWithMs(-8.64e15)).toBe("--");
  });
});

describe("formatAbsoluteEstWithMs", () => {
  it("includes 3 fractional second digits", () => {
    // UTC 2026-07-15T14:32:47.123Z -> EDT (UTC-4) 10:32:47.123 AM
    const ms = Date.UTC(2026, 6, 15, 14, 32, 47, 123);
    const out = formatAbsoluteEstWithMs(ms);
    expect(out).toMatch(/\.\d{3}/);
    // Specifically the ms slot should be present.
    expect(out).toContain(".123");
  });

  it("returns -- for non-finite input", () => {
    expect(formatAbsoluteEstWithMs(Number.NaN)).toBe("--");
  });
});

describe("formatAbsoluteEstWithDate", () => {
  it("includes a month abbreviation and the time-zone suffix", () => {
    // UTC 2026-07-15T14:32:47Z -> "Jul 15, 10:32:47 AM EDT" in America/New_York.
    const ms = Date.UTC(2026, 6, 15, 14, 32, 47);
    const out = formatAbsoluteEstWithDate(ms);
    expect(out).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2}:\d{2} (AM|PM) E[SD]T$/);
  });

  it("returns -- for non-finite input", () => {
    expect(formatAbsoluteEstWithDate(Number.NaN)).toBe("--");
  });
});

describe("DST awareness", () => {
  it("renders EST in January and EDT in July (DST flip is automatic)", () => {
    // Mid-January 2026 -> EST. Mid-July 2026 -> EDT. The IANA-zone lookup
    // handles the flip; hardcoded offsets would have failed one of these.
    const januaryMs = Date.UTC(2026, 0, 15, 14, 0, 0);
    const julyMs = Date.UTC(2026, 6, 15, 14, 0, 0);
    expect(formatAbsoluteEst(januaryMs)).toMatch(/ EST$/);
    expect(formatAbsoluteEst(julyMs)).toMatch(/ EDT$/);
  });
});

describe("formatter throughput (module-scope Intl reuse)", () => {
  it("10k calls finish in under 100ms", () => {
    // Guards the contract that the Intl.DateTimeFormat instances are
    // constructed ONCE at module load, not per call. A regression here
    // (per-call construction) lights up immediately because every
    // waterfall tooltip + every sidebar row hits the formatter on each
    // poll cycle. Constructor cost on Node 22 is ~20us; 10k per-call
    // constructions would push this comfortably past 100ms.
    const start = performance.now();
    for (let i = 0; i < 10_000; i += 1) {
      formatAbsoluteEstWithMs(i * 1000);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(100);
  });
});
