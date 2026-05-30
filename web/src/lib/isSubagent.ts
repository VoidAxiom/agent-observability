/*
 * isSubagent — predicate identifying subagent spans across the UI.
 *
 * A span is a "subagent" when its attributes carry `subagent_type` — the
 * SDK convention for Claude Code Task / agent-spawn invocations. The
 * predicate also accepts the legacy `agent.subagent_type` key for
 * forward-compat; if a future SDK rev emits an alternate namespace, add
 * the candidate key here.
 *
 * Lives in lib/ so SessionSidebar (when expanding traces), the
 * CollapsibleTraceList rows, and the Waterfall suffix tag can all consume
 * the same predicate. Pure function, no side effects.
 */

import type { SpanRow } from "./grouping";

const SUBAGENT_KEYS = ["subagent_type", "agent.subagent_type"] as const;

export function isSubagent(span: SpanRow): boolean {
  for (const key of SUBAGENT_KEYS) {
    const value = span.SpanAttributesRaw[key];
    if (typeof value === "string" && value.trim() !== "") return true;
  }
  return false;
}

/**
 * Pull the subagent_type label (e.g. "Bash", "ui-implementer") for tooltip
 * + badge text. Returns an empty string if not present.
 */
export function subagentType(span: SpanRow): string {
  for (const key of SUBAGENT_KEYS) {
    const value = span.SpanAttributesRaw[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return "";
}

/**
 * Pull the agent_id / parent_agent_id pair for the tooltip body. Empty
 * strings are returned when missing — the caller can render `…` or skip
 * the line.
 *
 * The static type says Record<string, string>, but a misbehaving SDK
 * can emit a numeric or null payload; calling `.trim()` on a number
 * would throw TypeError and crash the trace-list render. Mirror the
 * `typeof === "string"` guard the sibling helpers already use. Codex
 * round-5 P0 2026-05-30.
 */
function coerceAttr(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function subagentIds(span: SpanRow): {
  agentId: string;
  parentAgentId: string;
} {
  return {
    agentId: coerceAttr(span.SpanAttributesRaw.agent_id),
    parentAgentId: coerceAttr(span.SpanAttributesRaw.parent_agent_id),
  };
}
