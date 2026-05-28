# agent-observability

Local-first observability for multi-agent coding work. Captures telemetry from Claude Code sessions, the `codex exec` runs they spawn, and (optionally) OpenAI Responses-API calls, stitches them into a single nested trace tree via inherited `TRACEPARENT`, stores everything in ClickHouse, and surfaces it in a native macOS dashboard.

The headline capability: when a Claude Code session spawns N Codex children, those children appear as **children of the session** — not as disconnected traces — and each can be correlated to the task/ticket it was working on.

## Design brief

The source-of-truth design is [`docs/observability-spec.md`](docs/observability-spec.md). Read that before contributing.

## Locked architectural decisions

- **Transport: OTel Collector (Go binary).** Stock `otelcol-contrib` receives OTLP, batches/redacts/retries, writes to ClickHouse via the official exporter. No Rust written.
- **Emitter: Python with auto-instrumentors.** Lean on `OpenAIInstrumentor().instrument()` and equivalents — spans appear for free.
- **Build approach: walking-skeleton first.** Every milestone enriches a working end-to-end prototype, never adds a missing layer to a system that doesn't yet run end-to-end.

Full rationale: [`CLAUDE.md`](CLAUDE.md) § "Project specifics".

## Repo layout

```
agent-observability/
  app/                  SwiftUI macOS app (Xcode/SPM) — VOI-309 onwards
  clickhouse/           docker-compose + schema.sql + migrations — VOI-306
  bin/                  launch wrappers (cc-launch.sh, codex-spawn.sh) — VOI-313
  sdk/                  Python provenance-stamping SDK — VOI-308 onwards
  collector/            otelcol-contrib config.yaml + launchd plist — VOI-307
  config/               sample .codex/config.toml, .claude/settings.json
  docs/                 design brief, ADRs, rendered architecture
  architecture/         LikeC4 source (system context + emission + read views)
```

## Quickstart

```bash
make help    # list every Makefile target with its owner packet
make demo    # walking-skeleton end-to-end (lands in VOI-310)
```

`make demo` is the **M0 acceptance gate** — when VOI-310 merges, this brings up the full stack (ClickHouse + Collector), emits a single Python OTLP span, asserts it landed in ClickHouse, and tells you to open the SwiftUI app to see it.

## Project ledger

- **Code:** this repo (https://github.com/VoidAxiom/agent-observability).
- **Plan:** [agent_observability on Linear](https://linear.app/voidaxiom/project/agent-observability-7d7b850e9fc5) — milestones M0 (walking skeleton) → M5 (polish + companions).
- **Director / implementer / codex-worker triad** per [`CLAUDE.md`](CLAUDE.md). Claude authors specs + integrates; per-packet `implementer` subagents own delivery in isolated worktrees; codex writes the actual code under bounded task packets.

## Out of scope (intentional cuts)

- **Cost / per-token billing modeling.** Both Claude Code and `codex exec` are flat-fee memberships; the "what would this have cost on the API" feature was considered and cut. Token *counts* are fine to display; dollar *cost* is not in this build.
- **Multi-environment / staging / production-deploy hygiene.** This is a local-dev project. Dev passwords live in plain config; no Vault, no per-env overrides, no deployment automation. See [`CLAUDE.md`](CLAUDE.md) § "Scope: production-realistic, NOT production-deployed".
- **Langfuse, OpenLLMetry, or any observability backend besides ClickHouse** (plus optional SigNoz as a read-only companion in M5).
- **Rust** — the transport-layer decision locked to A (stock OTel Collector). Revisit the spec to change this.

## Known caveats

- `codex exec` emits traces + logs but **no metrics** (confirmed upstream bug). Derive any Codex token/throughput aggregates from span attributes in `otel_traces`, not from a metrics counter.
- Cross-tool nesting depends on current Claude Code / Codex behavior (TRACEPARENT injection, propagator defaults, beta flags). These are not stable contracts; if nesting breaks, suspect an upstream version change first.

## License

TBD.
