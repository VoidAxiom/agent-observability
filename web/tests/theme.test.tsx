import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { ThemeProvider } from "../src/theme/ThemeProvider";
import { useTheme } from "../src/theme/themeContext";
import { STORAGE_KEY } from "../src/theme/types";

// jsdom does not resolve bundler-style CSS imports (`import "../src/themes.css"`)
// into the CSSOM, so the [data-style][data-palette] selectors never fire and
// getComputedStyle returns empty. Inject the file's text as a <style> tag at
// suite startup so the cartesian-product selectors apply during tests.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const THEMES_CSS_PATH = resolve(__dirname, "../src/themes.css");

beforeAll(() => {
  const css = readFileSync(THEMES_CSS_PATH, "utf-8");
  const style = document.createElement("style");
  style.setAttribute("data-test-themes", "true");
  style.textContent = css;
  document.head.appendChild(style);
});

function Probe({ onMount }: { onMount: (state: ReturnType<typeof useTheme>) => void }) {
  const ctx = useTheme();
  onMount(ctx);
  return null;
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
  delete document.documentElement.dataset.style;
  delete document.documentElement.dataset.palette;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ThemeProvider", () => {
  it("defaults to neon + neon-tokyo on first visit", () => {
    let captured: ReturnType<typeof useTheme> | null = null;
    render(
      <ThemeProvider>
        <Probe onMount={(c) => (captured = c)} />
      </ThemeProvider>,
    );
    expect(captured).not.toBeNull();
    const ctx = captured as unknown as ReturnType<typeof useTheme>;
    expect(ctx.theme.style).toBe("neon");
    expect(ctx.theme.palette).toBe("neon-tokyo");
    expect(ctx.theme.fromUrl).toBe(false);
    expect(document.documentElement.dataset.style).toBe("neon");
    expect(document.documentElement.dataset.palette).toBe("neon-tokyo");
  });

  it("URL params override localStorage without persisting", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ style: "terminal", palette: "terminal-matrix" }),
    );
    window.history.replaceState(
      {},
      "",
      "/?style=editorial&palette=editorial-print",
    );

    let captured: ReturnType<typeof useTheme> | null = null;
    render(
      <ThemeProvider>
        <Probe onMount={(c) => (captured = c)} />
      </ThemeProvider>,
    );
    const ctx = captured as unknown as ReturnType<typeof useTheme>;
    expect(ctx.theme.style).toBe("editorial");
    expect(ctx.theme.palette).toBe("editorial-print");
    expect(ctx.theme.fromUrl).toBe(true);
    // URL load must NOT touch localStorage.
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(
      JSON.stringify({ style: "terminal", palette: "terminal-matrix" }),
    );
  });

  it("localStorage value loads on next visit when no URL param", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ style: "brut", palette: "brut-electric" }),
    );
    let captured: ReturnType<typeof useTheme> | null = null;
    render(
      <ThemeProvider>
        <Probe onMount={(c) => (captured = c)} />
      </ThemeProvider>,
    );
    const ctx = captured as unknown as ReturnType<typeof useTheme>;
    expect(ctx.theme.style).toBe("brut");
    expect(ctx.theme.palette).toBe("brut-electric");
    expect(ctx.theme.fromUrl).toBe(false);
  });

  it("invalid stored value falls back to default with console.warn", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ style: "totally-bogus", palette: "nonexistent" }),
    );
    let captured: ReturnType<typeof useTheme> | null = null;
    render(
      <ThemeProvider>
        <Probe onMount={(c) => (captured = c)} />
      </ThemeProvider>,
    );
    const ctx = captured as unknown as ReturnType<typeof useTheme>;
    expect(ctx.theme.style).toBe("neon");
    expect(ctx.theme.palette).toBe("neon-tokyo");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("setTheme persists the choice to localStorage", () => {
    let captured: ReturnType<typeof useTheme> | null = null;
    render(
      <ThemeProvider>
        <Probe onMount={(c) => (captured = c)} />
      </ThemeProvider>,
    );
    const ctx = captured as unknown as ReturnType<typeof useTheme>;
    act(() => {
      ctx.setTheme({ style: "liquid", palette: "liquid-ocean" });
    });
    const stored = window.localStorage.getItem(STORAGE_KEY);
    expect(stored).toBe(
      JSON.stringify({ style: "liquid", palette: "liquid-ocean" }),
    );
  });

  it("setting data-style + data-palette to neon-tokyo applies the --bg token computed value", () => {
    // The cartesian-product selector must actually fire — confirm by setting
    // the attributes directly and reading getComputedStyle.
    document.documentElement.dataset.style = "neon";
    document.documentElement.dataset.palette = "neon-tokyo";
    const bg = getComputedStyle(document.body).getPropertyValue("background").trim();
    const declared = getComputedStyle(document.documentElement)
      .getPropertyValue("--bg")
      .trim();
    // jsdom doesn't fully resolve `background: var(--bg)` to a color; instead
    // we assert the token itself resolves to the neon-tokyo hex.
    expect(declared).toBe("#080013");
    // The body's `background` shorthand at minimum should be non-empty when a
    // theme is active in a real browser; jsdom may return "" here, so soft check.
    expect(typeof bg).toBe("string");
  });
});
