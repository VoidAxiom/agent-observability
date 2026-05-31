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

// VOI-389 round-5 (codex anti-rot): the previous wall-clock
// throughput tests ("10k calls < 100ms" and its RELATIVE cached-vs-
// uncached successor) are exactly the flake-risk CLAUDE.md § Anti-rot
// names — both could trip on a thermally-throttled or contended CI
// runner for environmental reasons even when the module's Intl cache
// is intact. Removed per "Trustworthy or gone — a flaky / false-
// positive-prone gate is worse than none". The module-scope formatter
// reuse contract is enforced by code review (the file is 99 lines and
// any per-call `new Intl.DateTimeFormat` would be obvious) and by the
// EST/EDT correctness tests above that exercise the cached path
// thousands of times across the suite without budget assertions.
