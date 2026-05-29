import { createContext, useContext } from "react";
import type { ThemeChoice, ThemeState } from "./types";

export interface ThemeContextValue {
  theme: ThemeState;
  setTheme: (next: ThemeChoice) => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used inside <ThemeProvider>");
  }
  return ctx;
}
