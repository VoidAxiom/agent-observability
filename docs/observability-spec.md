# Design brief: multi-agent observability

> This is a design brief for one build, not standing process direction. Read it
> before starting work on this system. Where a decision is still open it is
> marked **DECISION NEEDED** — build up to that point and stop for confirmation
> rather than choosing.

## What this is

A local-first observability system for multi-agent coding work. It captures
telemetry from Claude Code sessions, the Codex `exec` runs they spawn, and
(optionally) our own OpenAI Responses-API calls, stitches them into a single
nested trace tree, stores everything in ClickHouse, and surfaces it in a native
macOS dashboard. The headline capability: when a Claude Code session spawns N
Codex children, those children appear as children of the session — not as
disconnected traces — and each can be correlated to the task/ticket it was
working.

## Settled architecture

These are decided. Do not revisit without asking.

- **Seam:** OTLP everywhere. OTLP is the wire protocol (Protobuf over gRPC/HTTP),
  language-neutral. Every component either speaks OTLP or reads ClickHouse —
  nothing shares in-process types across language boundaries.
- **Nesting mechanism:** Trace nesting is carried by the `TRACEPARENT` env var.
  Claude Code injects it into spawned Bash subprocesses when tracing is active;
  a spawned Codex run inherits it and parents its session span under the Claude
  tool-execution span. Claude Code Task subagents nest natively via
  `parent_agent_id`. This is the core trick — the parent/child tree is real and
  comes from inherited context, not from timestamp guessing.
- **Storage:** One ClickHouse instance. Two table families:
  - OTel tables (`otel_traces`, `otel_logs`, `otel_metrics_*`) from the standard
    exporter schemas.
  - Modeled agent-data (`agents.runs`, `agents.events`, `agents.artifacts`) that
    we design.
  - The two families join on `trace_id`. That join is the payoff — it lets a
    span be correlated to a logical run/event/ticket.
  - Use `LowCardinality(String)` for provenance keys, a JSON catchall column for
    schema drift, per-table TTL for retention. Large blobs go to object storage;
    only a manifest row (with `uri`) lives in ClickHouse.
- **App:** Native macOS, SwiftUI + Swift Charts. Three surfaces: a menu-bar
  pulse (live activity ticker), a session galaxy (the agent tree rendered from
  the span hierarchy), and a metrics deck (token/throughput/error panels).
  Reads ClickHouse over its HTTP interface (`:8123`), `JSONEachRow`, via an
  actor-based query service that polls every few seconds. Pure read client — no
  writes.
- **Companions:** DuckDB for offline ad-hoc SQL over completed runs. SigNoz
  optionally runs on the same ClickHouse for a free stock OTel UI. Both are
  read-only consumers; neither is required for the app to work.

## Open decisions — STOP and confirm before implementing past these

> **DECISION NEEDED — transport layer.** Two valid topologies, pick one:
> - **A:** OTel Collector (Go binary) receives OTLP, batches/redacts/retries,
>   writes to ClickHouse via the official exporter. No Rust written.
> - **B:** A Rust daemon is the *sole* front door — Python emitters point OTLP
>   directly at it; it receives, enriches, and writes to ClickHouse. We then own
>   buffering/retry/spooling that the Collector would have given for free.
> - **Hard constraint either way:** Rust never sits *behind* the Collector.
>   "Collector forwards OTLP to a Rust daemon downstream" was considered and
>   rejected — it duplicates transport work. Rust is either the front door (B)
>   or absent (A).

> **DECISION NEEDED — emitter/SDK language.** Python (lean on auto-instrumentors
> — `OpenAIInstrumentor().instrument()` patches the client, spans for free, but
> the magic can break silently on SDK upgrades) vs hand-instrumented (more
> explicit, never silently goes dark, but we own the `gen_ai.*` convention
> mapping). Somewhat coupled to the transport choice: if B is chosen, Rust is
> already in play and hand-instrumentation there is natural.

> **DECISION NEEDED — daemon enrichment scope (only if transport = B).** The
> daemon may do stateful work the Collector can't: hold a child span until its
> parent arrives and rewrite the tree, resolve `task.id` → ticket title via an
> external lookup, derive events. This may legitimately be *empty* — TRACEPARENT
> already pre-stitches the tree on the emit side, so confirm which (if any) of
> these are actually wanted before building them.

## Out of scope — do not build

- **Cost / per-token tracking, subscription modeling, counterfactual API spend.**
  Explicitly dropped. Both Claude Code and Codex are flat-fee memberships; the
  "what would this have cost on the API" feature was considered and cut. Do not
  add price books, subscription tables, or dollar-denominated panels. Token
  *counts* are fine to display; dollar *cost* is not in this build.

## Repo layout (target)

```
repo-root/
  app/                  SwiftUI macOS app (Xcode/SPM)
  clickhouse/           schema.sql, materialized views, migrations
  bin/                  launch wrappers — cc-launch.sh, codex-spawn.sh (TRACEPARENT plumbing)
  sdk/                  provenance-stamping SDK (language per DECISION above)
  <transport>/          collector/ (yaml + launchd plist)  OR  daemon/ (Rust crate) — per DECISION
  config/               sample .codex/config.toml, .claude/settings.json
```

The transport directory is intentionally unnamed until the transport decision is
made — it is either a Collector config folder or a Rust crate, nothing in between.

## Known caveats to respect

- `codex exec` emits traces + logs but **no metrics** (confirmed upstream bug).
  Derive any Codex token/throughput aggregates from span attributes in
  `otel_traces`, not from a metrics counter.
- Detailed tool-content attributes and hook spans need extra Claude Code beta
  flags. Treat hook-level observability as a later phase, not a day-one given.
- Cross-tool nesting depends on current Claude Code / Codex behavior (TRACEPARENT
  injection, propagator defaults, beta flags). These are not stable contracts;
  if nesting breaks, suspect an upstream version change first.