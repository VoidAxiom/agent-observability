import type { CSSProperties } from "react";

export type SpanFamily =
  | "claude_code.interaction"
  | "claude_code.llm_request"
  | "claude_code.tool"
  | "codex_exec";

export interface SignatureSpanCardProps {
  name: string;
  family: SpanFamily;
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
}

// Family → accent token slot. Token-only; never hex literals.
// docs/web-ui-cyberpunk-discipline.md "Reserve magenta for action and selection"
// — interaction/llm/codex map to non-magenta accents; tool keeps magenta.
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

export function SignatureSpanCard({
  name,
  family,
  durationMs,
  inputTokens,
  outputTokens,
}: SignatureSpanCardProps) {
  const accent = FAMILY_ACCENT_VAR[family];
  const glow = FAMILY_GLOW_VAR[family];

  const cardStyle: CSSProperties = {
    position: "relative",
    background: "var(--surface)",
    color: "var(--text)",
    border: "var(--border-width-card) solid var(--border-base)",
    borderRadius: "var(--radius-card)",
    padding: "14px 18px 14px 22px",
    boxShadow: glow,
    fontFamily: "var(--font-body)",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    transition: "var(--motion-snap)",
    transitionProperty: "border-color, box-shadow, transform",
  };

  const leftEdgeStyle: CSSProperties = {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    width: "2px",
    background: accent,
    borderTopLeftRadius: "var(--radius-card)",
    borderBottomLeftRadius: "var(--radius-card)",
  };

  const nameStyle: CSSProperties = {
    fontFamily: "var(--font-mono)",
    fontSize: "13px",
    fontWeight: 500,
    color: "var(--text)",
    margin: 0,
    letterSpacing: "0.01em",
  };

  const commentStyle: CSSProperties = {
    fontFamily: "var(--font-mono)",
    fontSize: "11px",
    color: "var(--text-muted)",
    margin: 0,
    letterSpacing: "0.02em",
  };

  const familyLabelStyle: CSSProperties = {
    fontFamily: "var(--font-mono)",
    fontSize: "10px",
    color: accent,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    margin: 0,
  };

  const metadata = formatTerminalComment(durationMs, inputTokens, outputTokens);

  return (
    <article
      style={cardStyle}
      data-family={family}
      aria-label={`Span ${name}, ${metadata}`}
    >
      <span aria-hidden="true" style={leftEdgeStyle} />
      <p style={familyLabelStyle}>{family}</p>
      <h3 style={nameStyle}>{name}</h3>
      <p style={commentStyle}>{metadata}</p>
    </article>
  );
}

function formatTerminalComment(
  durationMs: number,
  inputTokens?: number,
  outputTokens?: number,
): string {
  const parts = [`${formatMs(durationMs)}`];
  if (typeof inputTokens === "number") {
    parts.push(`${formatTokens(inputTokens)} in`);
  }
  if (typeof outputTokens === "number") {
    parts.push(`${formatTokens(outputTokens)} out`);
  }
  return `// ${parts.join(" · ")}`;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}
