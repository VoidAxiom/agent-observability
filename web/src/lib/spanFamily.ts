/*
 * spanFamily — single source of truth for span-family → CSS accent
 * variable mapping. SessionSidebar / TraceList / SpanTree / InspectorPane
 * all consume these helpers so the family palette stays consistent and
 * "magenta reserved for action/selection" stays disciplined.
 *
 * Token-only — no hex literals. Family → CSS custom property name.
 *
 * Lives in lib/ (not components/) so it can be imported by any layer
 * without dragging React-component imports along; also satisfies
 * react-refresh's "only-export-components" rule for the SignatureSpanCard
 * file.
 */

export type SpanFamily =
  | "claude_code.interaction"
  | "claude_code.llm_request"
  | "claude_code.tool"
  | "codex_exec";

// docs/web-ui-cyberpunk-discipline.md "Reserve magenta for action and
// selection" — interaction/llm/codex map to non-magenta accents; tool keeps
// magenta (--accent-1 IS magenta in neon).
const FAMILY_ACCENT_VAR: Record<SpanFamily, string> = {
  "claude_code.interaction": "var(--accent-3)",
  "claude_code.llm_request": "var(--accent-2)",
  "claude_code.tool": "var(--accent-1)",
  codex_exec: "var(--accent-2)",
};

const FAMILY_GLOW_VAR: Record<SpanFamily, string> = {
  "claude_code.interaction": "var(--glow-accent-3)",
  "claude_code.llm_request": "var(--glow-accent-2)",
  "claude_code.tool": "var(--glow-accent-1)",
  codex_exec: "var(--glow-accent-2)",
};

export function familyToAccentVar(family: SpanFamily): string {
  return FAMILY_ACCENT_VAR[family];
}

export function familyToGlowVar(family: SpanFamily): string {
  return FAMILY_GLOW_VAR[family];
}

/**
 * spanNameToFamily — derive a SpanFamily from a raw OTel span name string.
 * Order matters: longer prefixes are checked before shorter ones so
 * "claude_code.llm_request" doesn't get bucketed under
 * "claude_code.interaction". Returns "claude_code.tool" as a sentinel
 * when nothing matches, keeping the row styled (magenta accent) instead
 * of unstyled.
 */
export function spanNameToFamily(name: string): SpanFamily {
  if (name.startsWith("claude_code.llm_request")) {
    return "claude_code.llm_request";
  }
  if (name.startsWith("claude_code.interaction")) {
    return "claude_code.interaction";
  }
  if (name.startsWith("claude_code.tool")) return "claude_code.tool";
  if (name.startsWith("codex_exec")) return "codex_exec";
  return "claude_code.tool";
}
