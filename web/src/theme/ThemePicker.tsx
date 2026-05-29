import { useCallback, type ChangeEvent } from "react";
import { useTheme } from "./themeContext";
import {
  PALETTES,
  STYLES,
  STYLE_LABELS,
  isStyleId,
  type StyleId,
} from "./types";

export function ThemePicker() {
  const { theme, setTheme } = useTheme();

  const onStyleChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const nextStyle = event.target.value;
      if (!isStyleId(nextStyle)) return;
      // When style changes, auto-set palette to the first palette of the new style.
      const firstPalette = PALETTES[nextStyle][0];
      if (!firstPalette) return;
      setTheme({ style: nextStyle, palette: firstPalette.id });
    },
    [setTheme],
  );

  const onPaletteChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const nextPalette = event.target.value;
      const allowed = PALETTES[theme.style as StyleId];
      if (!allowed.some((p) => p.id === nextPalette)) return;
      setTheme({ style: theme.style, palette: nextPalette });
    },
    [setTheme, theme.style],
  );

  const paletteOptions = PALETTES[theme.style as StyleId] ?? [];

  return (
    <div
      style={{
        display: "flex",
        gap: "8px",
        alignItems: "center",
        padding: "10px 14px",
        background: "var(--surface)",
        border: "1px solid var(--border-base)",
        borderRadius: "var(--radius-card)",
      }}
    >
      <label
        htmlFor="theme-style"
        style={{
          fontFamily: "var(--font-mono)",
          color: "var(--text-muted)",
          fontSize: "11px",
          letterSpacing: "0.05em",
          textTransform: "uppercase",
        }}
      >
        Style
      </label>
      <select
        id="theme-style"
        value={theme.style}
        onChange={onStyleChange}
        aria-label="Theme style"
      >
        {STYLES.map((s) => (
          <option key={s} value={s}>
            {STYLE_LABELS[s]}
          </option>
        ))}
      </select>
      <label
        htmlFor="theme-palette"
        style={{
          fontFamily: "var(--font-mono)",
          color: "var(--text-muted)",
          fontSize: "11px",
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          marginLeft: "6px",
        }}
      >
        Palette
      </label>
      <select
        id="theme-palette"
        value={theme.palette}
        onChange={onPaletteChange}
        aria-label="Theme palette"
      >
        {paletteOptions.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
    </div>
  );
}
