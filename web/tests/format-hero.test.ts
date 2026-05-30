import { describe, expect, it } from "vitest";
import {
  formatHeroDurationMs,
  formatHeroMagnitude,
} from "../src/lib/formatHero";

describe("formatHeroMagnitude", () => {
  it("renders sub-thousand as plain integer", () => {
    expect(formatHeroMagnitude(0)).toBe("0");
    expect(formatHeroMagnitude(1)).toBe("1");
    expect(formatHeroMagnitude(847)).toBe("847");
    expect(formatHeroMagnitude(999)).toBe("999");
  });

  it("renders thousands with k suffix and one decimal", () => {
    expect(formatHeroMagnitude(1000)).toBe("1.0k");
    expect(formatHeroMagnitude(12831)).toBe("12.8k");
    expect(formatHeroMagnitude(99500)).toBe("99.5k");
    expect(formatHeroMagnitude(524913)).toBe("524.9k");
  });

  it("renders millions with M suffix and one decimal", () => {
    expect(formatHeroMagnitude(1_000_000)).toBe("1.0M");
    expect(formatHeroMagnitude(1_500_000)).toBe("1.5M");
    expect(formatHeroMagnitude(9_950_000)).toBe("9.9M");
  });

  it("handles non-finite + negative defensively", () => {
    expect(formatHeroMagnitude(Number.NaN)).toBe("0");
    expect(formatHeroMagnitude(Number.POSITIVE_INFINITY)).toBe("0");
    expect(formatHeroMagnitude(-1500)).toBe("-1.5k");
  });
});

describe("formatHeroDurationMs", () => {
  it("preserves sub-ms resolution (tool spans frequently sub-ms)", () => {
    expect(formatHeroDurationMs(0)).toBe("0.00ms");
    expect(formatHeroDurationMs(0.05)).toBe("0.05ms");
    expect(formatHeroDurationMs(0.5)).toBe("0.50ms");
  });

  it("renders 1ms-100ms with 1 decimal", () => {
    expect(formatHeroDurationMs(1)).toBe("1.0ms");
    expect(formatHeroDurationMs(47.3)).toBe("47.3ms");
    expect(formatHeroDurationMs(99.9)).toBe("99.9ms");
  });

  it("renders 100ms-1s as integer ms", () => {
    expect(formatHeroDurationMs(524)).toBe("524ms");
    expect(formatHeroDurationMs(999)).toBe("999ms");
  });

  it("renders seconds with 2 decimal places", () => {
    expect(formatHeroDurationMs(1000)).toBe("1.00s");
    expect(formatHeroDurationMs(1070)).toBe("1.07s");
    expect(formatHeroDurationMs(2400)).toBe("2.40s");
  });

  it("handles non-finite + negative defensively", () => {
    expect(formatHeroDurationMs(Number.NaN)).toBe("0ms");
    expect(formatHeroDurationMs(-100)).toBe("0ms");
  });
});
