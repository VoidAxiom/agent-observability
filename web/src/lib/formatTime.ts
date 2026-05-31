/*
 * Wall-clock time formatters for the UI's EST/EDT display (VOI-389).
 *
 * All times rendered in IANA zone `America/New_York` so DST flips
 * automatically (EST -> EDT mid-March, back mid-November). Input is
 * always ms-since-epoch (UTC); the formatter handles the conversion.
 *
 * Falls back to "--" for non-finite input rather than throwing, so a
 * span with an unparseable Timestamp doesn't crash render.
 *
 * Module-scope `Intl.DateTimeFormat` instances are constructed ONCE at
 * import — Intl.DateTimeFormat construction is expensive on hot paths
 * like the waterfall tooltip; see web/tests/format-time.test.ts for the
 * throughput guard.
 */

import { DISTANT_PAST } from "./grouping";

const TZ = "America/New_York";
const FALLBACK = "--";
// VOI-389 round-5: codex flagged that the sentinel value was
// hand-coded here AND in grouping.ts — two definitions invite drift.
// grouping.ts has zero imports from formatTime, so there's no cycle
// to avoid; import the canonical sentinel directly.

const HMS_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  hour12: true,
  timeZoneName: "short",
});

// fractionalSecondDigits is the modern Intl knob for sub-second precision.
// jsdom + Node 22's V8 honour it; the format-time test asserts the ".mmm"
// fragment appears so a future runtime regression lights up immediately.
const HMS_MS_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  fractionalSecondDigits: 3,
  hour12: true,
  timeZoneName: "short",
});

const FULL_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  hour12: true,
  timeZoneName: "short",
});

function isUsable(ms: number): boolean {
  return Number.isFinite(ms) && ms !== DISTANT_PAST;
}

/**
 * True when the input is a real timestamp the formatter would render
 * (not NaN/Infinity, not the DISTANT_PAST sentinel). Useful to call
 * sites that wrap the formatter inside a longer string like
 * `"<HH:MM:SS EDT> · <Ns ago>"` and need to suppress the relative-age
 * fragment when the absolute fragment falls back to "--".
 */
export function isAbsoluteTimeAvailable(ms: number): boolean {
  return isUsable(ms);
}

/** "10:32:47 AM EDT" — for sidebar + DetailsPane last_activity. */
export function formatAbsoluteEst(msSinceEpoch: number): string {
  if (!isUsable(msSinceEpoch)) return FALLBACK;
  return HMS_FORMATTER.format(new Date(msSinceEpoch));
}

/**
 * "10:32:47.123 AM EDT" — for waterfall tooltips (sub-second matters).
 *
 * Node 22 + WebKit-in-Tauri (the only runtimes this project targets per
 * CLAUDE.md § "Scope: production-realistic") both honour
 * `fractionalSecondDigits`, so no polyfill defense is needed. The
 * format-time test asserts the ".mmm" fragment appears so a future
 * runtime regression lights up immediately rather than silently rendering
 * second-precision in the waterfall tooltip.
 */
export function formatAbsoluteEstWithMs(msSinceEpoch: number): string {
  if (!isUsable(msSinceEpoch)) return FALLBACK;
  return HMS_MS_FORMATTER.format(new Date(msSinceEpoch));
}

/** "May 31, 10:32:47 AM EDT" — for context-spanning displays. */
export function formatAbsoluteEstWithDate(msSinceEpoch: number): string {
  if (!isUsable(msSinceEpoch)) return FALLBACK;
  return FULL_FORMATTER.format(new Date(msSinceEpoch));
}
