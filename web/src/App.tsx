import { ThemeProvider } from "./theme/ThemeProvider";
import { ThemePicker } from "./theme/ThemePicker";
import {
  SignatureSpanCard,
  type SpanFamily,
} from "./components/SignatureSpanCard";

interface FixtureSpan {
  name: string;
  family: SpanFamily;
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
}

const FIXTURE_SPANS: FixtureSpan[] = [
  {
    name: "claude_code.tool",
    family: "claude_code.tool",
    durationMs: 1075,
    inputTokens: 510,
    outputTokens: 14,
  },
  {
    name: "claude_code.interaction",
    family: "claude_code.interaction",
    durationMs: 2402,
    inputTokens: 1280,
    outputTokens: 312,
  },
  {
    name: "claude_code.llm_request",
    family: "claude_code.llm_request",
    durationMs: 524,
    inputTokens: 4096,
    outputTokens: 1024,
  },
  {
    name: "codex_exec.worker",
    family: "codex_exec",
    durationMs: 8730,
    inputTokens: 2048,
    outputTokens: 196,
  },
];

export function App() {
  return (
    <ThemeProvider>
      <div
        style={{
          minHeight: "100vh",
          padding: "24px",
          display: "flex",
          flexDirection: "column",
          gap: "24px",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "16px",
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <h1
              style={{
                margin: 0,
                fontFamily: "var(--font-numeric)",
                fontSize: "20px",
                letterSpacing: "0.08em",
                color: "var(--text)",
              }}
            >
              agent-observability
            </h1>
            <p
              style={{
                margin: 0,
                fontFamily: "var(--font-mono)",
                fontSize: "11px",
                color: "var(--text-muted)",
              }}
            >
              // foundation preview · 7 styles × 3 palettes
            </p>
          </div>
          <ThemePicker />
        </header>

        <section
          aria-label="Signature span cards"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: "16px",
          }}
        >
          {FIXTURE_SPANS.map((span) => (
            <SignatureSpanCard
              key={span.name}
              name={span.name}
              family={span.family}
              durationMs={span.durationMs}
              inputTokens={span.inputTokens}
              outputTokens={span.outputTokens}
            />
          ))}
        </section>
      </div>
    </ThemeProvider>
  );
}
