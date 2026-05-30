/*
 * bestContrast — pick a foreground text token that reads against a known
 * family-color CSS variable. Deterministic per family-color, no DOM access,
 * no runtime APCA. The bright-neon family-color list is fixed (3 entries
 * — --accent-1/2/3); if a new family is added later the helper MUST be
 * updated alongside.
 *
 * Why a hand-rolled lookup instead of a contrast calculator: the family-
 * color CSS variables resolve to per-theme values that are deliberately
 * tuned to be vivid/neon for legibility-on-dark in the cyberpunk styles
 * AND deliberately muted for the editorial / print styles. A runtime APCA
 * pass would have to read computed style + parse rgb(), which adds layout
 * thrash and dependency on the DOM in a layout function the SVG calls in
 * a loop. The bright-neon families ALL render dark text best; the muted
 * sentinel (--text-muted) renders the default text token best. Two
 * outcomes, deterministic.
 *
 * Note: spec.md referenced `--bg-base` but the actual theme tokens use
 * `--bg`. The helper returns the real token name so the consumer can
 * compose `var(${returnValue})`. Tests pin both the bright-neon → --bg
 * branch AND the muted → --text branch.
 */

export type ContrastFgVar = "--bg" | "--text";

const BRIGHT_NEON_VARS = new Set<string>([
  // The 3-family palette: --accent-1 (typically magenta, also the selection
  // color), --accent-2 (typically purple/orange/secondary), --accent-3
  // (typically cyan/informational). All three are saturated neon hues in
  // cyberpunk themes; dark body text reads against them. The "magenta is
  // reserved for selection" rule means --accent-1 only appears as a fill
  // on the selection edge — but its label contrast still needs the dark
  // foreground if anyone ever fills a bar with it directly.
  "var(--accent-1)",
  "var(--accent-2)",
  "var(--accent-3)",
]);

/**
 * Return the CSS custom property name (WITHOUT the `var(...)` wrapper)
 * for the foreground token that reads against a family-color fill.
 *
 *   bestContrastTextOn('var(--accent-1)') -> '--bg'
 *   bestContrastTextOn('var(--text-muted)') -> '--text'
 *   bestContrastTextOn('any unknown value') -> '--text'
 *
 * The caller composes the final `fill:` via `var(${returnValue})`.
 */
export function bestContrastTextOn(familyColorVar: string): ContrastFgVar {
  return BRIGHT_NEON_VARS.has(familyColorVar) ? "--bg" : "--text";
}
