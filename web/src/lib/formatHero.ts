/*
 * formatHero — magnitude formatter for hero numerals in the inspector
 * top band. Token counts and similar large integers get k/M suffixes;
 * values below 1000 render unchanged.
 *
 * Rules (locked by spec acceptance):
 *  - x < 1000  -> integer string                  (847 -> "847")
 *  - x < 100_000 -> 1 decimal place + "k"          (12831 -> "12.8k", 1000 -> "1.0k")
 *  - x < 1_000_000 -> 1 decimal place + "k"        (524913 -> "524.9k", 99500 -> "99.5k")
 *  - x >= 1_000_000 -> 1 decimal place + "M"       (1_500_000 -> "1.5M")
 *
 * Decimals use Math.floor (NOT round) so "524913" → "524.9k" stays exact
 * as the spec promises — round would land on "524.9k" too but Math.floor
 * is also defensible for monotonic "this much has happened so far" semantics
 * (a token count is observed, not estimated).
 */

export function formatHeroMagnitude(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);

  if (abs < 1000) {
    return `${sign}${Math.floor(abs)}`;
  }
  if (abs < 1_000_000) {
    const k = abs / 1000;
    return `${sign}${truncateOneDecimal(k)}k`;
  }
  const m = abs / 1_000_000;
  return `${sign}${truncateOneDecimal(m)}M`;
}

/*
 * formatHeroDurationMs — duration formatter for the Duration / TTFT hero
 * numerals. Sub-second values render as integer ms; second-or-greater
 * values render with 2 decimal places + "s".
 */
export function formatHeroDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0ms";
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  const seconds = ms / 1000;
  return `${seconds.toFixed(2)}s`;
}

function truncateOneDecimal(value: number): string {
  // Truncate to 1 decimal place without rounding noise from toFixed.
  const truncated = Math.floor(value * 10) / 10;
  // toFixed(1) gives the trailing ".0" the spec wants ("1.0k" not "1k").
  return truncated.toFixed(1);
}
