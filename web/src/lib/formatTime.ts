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

const TZ = "America/New_York";
const FALLBACK = "--";
// Matches the DISTANT_PAST sentinel in grouping.ts (Swift's
// .distantPast). Treated as "unknown time" rather than rendering as a
// year-275000-BCE Intl output. Hand-coding the value (rather than
// importing it) keeps formatTime free of a cyclic dep on grouping.ts.
const DISTANT_PAST_SENTINEL = -8.64e15;

const HMS_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  hour12: true,
  timeZoneName: "short",
});

// fractionalSecondDigits is the modern Intl knob for sub-second precision.
// jsdom + Node 22's V8 honour it; if a future runtime drops it, the test
// suite's "includes 3 fractional second digits" case will catch it and we
// fall back to the splice path below.
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
  return Number.isFinite(ms) && ms !== DISTANT_PAST_SENTINEL;
}

/** "10:32:47 AM EDT" — for sidebar + DetailsPane last_activity. */
export function formatAbsoluteEst(msSinceEpoch: number): string {
  if (!isUsable(msSinceEpoch)) return FALLBACK;
  return HMS_FORMATTER.format(new Date(msSinceEpoch));
}

/**
 * "10:32:47.123 AM EDT" — for waterfall tooltips (sub-second matters).
 *
 * If the runtime ever returns a string without the ".mmm" fragment (older
 * Intl polyfills miss `fractionalSecondDigits`), splice the milliseconds
 * in manually before the AM/PM token so callers can rely on the format.
 */
export function formatAbsoluteEstWithMs(msSinceEpoch: number): string {
  if (!isUsable(msSinceEpoch)) return FALLBACK;
  const formatted = HMS_MS_FORMATTER.format(new Date(msSinceEpoch));
  // Defensive fallback for Intl impls that ignore fractionalSecondDigits:
  // the seconds field is then "47" rather than "47.123". Detect by the
  // absence of a "." between digits and splice the ms in before the
  // AM/PM token. Determinism: pure string manipulation; no extra Date math.
  if (/\d\.\d{3}/.test(formatted)) return formatted;
  const ms = Math.floor(msSinceEpoch % 1000)
    .toString()
    .padStart(3, "0");
  // Insert ".mmm" after the last seconds digit (look for HH:MM:SS pattern,
  // capture seconds, splice the fractional after).
  return formatted.replace(/(\d{1,2}:\d{2}:\d{2})/, `$1.${ms}`);
}

/** "May 31, 10:32:47 AM EDT" — for context-spanning displays. */
export function formatAbsoluteEstWithDate(msSinceEpoch: number): string {
  if (!isUsable(msSinceEpoch)) return FALLBACK;
  return FULL_FORMATTER.format(new Date(msSinceEpoch));
}
