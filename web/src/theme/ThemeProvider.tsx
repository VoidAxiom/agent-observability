import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ThemeContext, type ThemeContextValue } from "./themeContext";
import {
  DEFAULT_PALETTE,
  DEFAULT_STYLE,
  STORAGE_KEY,
  isValidCombo,
  type ThemeChoice,
  type ThemeState,
} from "./types";

function resolveInitial(): ThemeState {
  if (typeof window === "undefined") {
    return { style: DEFAULT_STYLE, palette: DEFAULT_PALETTE, fromUrl: false };
  }

  // 1. URL param wins (share-link semantics).
  try {
    const params = new URLSearchParams(window.location.search);
    const urlStyle = params.get("style");
    const urlPalette = params.get("palette");
    if (isValidCombo(urlStyle, urlPalette)) {
      return { style: urlStyle, palette: urlPalette as string, fromUrl: true };
    }
  } catch {
    // location may be missing in some test envs — fall through.
  }

  // 2. localStorage second. Invalid stored value → console.warn + default.
  try {
    const raw = window.localStorage?.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ThemeChoice>;
      if (isValidCombo(parsed.style, parsed.palette)) {
        return {
          style: parsed.style,
          palette: parsed.palette as string,
          fromUrl: false,
        };
      }
      console.warn(
        `[theme] ignoring invalid stored theme: ${raw}; falling back to default`,
      );
    }
  } catch {
    // JSON.parse / storage failures fall through to default.
  }

  return { style: DEFAULT_STYLE, palette: DEFAULT_PALETTE, fromUrl: false };
}

interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<ThemeState>(resolveInitial);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.style = theme.style;
    root.dataset.palette = theme.palette;
  }, [theme.style, theme.palette]);

  const setTheme = useCallback((next: ThemeChoice) => {
    // Picker changes always persist. URL-derived state is only set at mount.
    setThemeState({ ...next, fromUrl: false });
    try {
      window.localStorage?.setItem(
        STORAGE_KEY,
        JSON.stringify({ style: next.style, palette: next.palette }),
      );
    } catch {
      // Storage may be unavailable (private mode); persistence is best-effort.
    }
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, setTheme }),
    [theme, setTheme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}
