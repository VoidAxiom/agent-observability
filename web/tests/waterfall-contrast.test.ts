/*
 * waterfall-contrast — pins the bestContrastTextOn helper. The bright-
 * neon accent families MUST return --bg so the SVG label fill reads as
 * dark text against the saturated fill. The muted sentinel (and any
 * unknown var) returns --text.
 */

import { describe, expect, it } from "vitest";
import { bestContrastTextOn } from "../src/lib/bestContrast";

describe("bestContrastTextOn", () => {
  it("returns --bg for the bright-neon family accents", () => {
    expect(bestContrastTextOn("var(--accent-1)")).toBe("--bg");
    expect(bestContrastTextOn("var(--accent-2)")).toBe("--bg");
    expect(bestContrastTextOn("var(--accent-3)")).toBe("--bg");
  });

  it("returns --text for the muted text sentinel", () => {
    expect(bestContrastTextOn("var(--text-muted)")).toBe("--text");
  });

  it("returns --text as the safe fallback for unknown values", () => {
    expect(bestContrastTextOn("var(--surface)")).toBe("--text");
    expect(bestContrastTextOn("rgb(0, 0, 0)")).toBe("--text");
    expect(bestContrastTextOn("")).toBe("--text");
  });
});
