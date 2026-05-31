# Session hierarchy: nested claude → subagent → codex sessions

**Status:** design approved 2026-05-31 (operator-ratified via brainstorming).
**Source of truth** for the per-packet specs that implement it. Per-packet
`spec.md` files MUST quote the relevant section verbatim (CLAUDE.md
§ "Spec authoring").

## Problem

The web UI session sidebar models sessions as a **flat** list keyed by a
single fallback id (`grouping.ts` `effectiveSessionKey`:
`session.id` → `agent.session.id` → `TraceId`). Two user-visible defects
follow:

1. **All codex execs collapse into one phantom "session."** `codex exec`
   emits **no** `session.id` and **no** `agent.session.id`, so the key
   falls through to `TraceId`. Because every codex exec launched inside a
   Claude session inherits the same `TRACEPARENT` (same `TraceId`), all of
   them bucket into a single session-group keyed by that shared trace id.
   They are neither separated per-invocation nor nested under the Claude
   session.

2. **No session-within-session hierarchy.** Claude subagents and codex
   execs cannot nest under the Claude session that spawned them. The
   desired model is `claude code → claude subagent → codex exec`, each a
   first-class session, nested by who-spawned-whom. ~90% of codex execs are
   launched by subagents, so the subagent→codex seam is the critical one.

### Evidence (ClickHouse, last 6h, 2026-05-31)

```
ServiceName   spans    distinct session.id   distinct traces
codex_exec    25257    1 (empty)             24
claude-code   1025     6                     78
```

- `codex_exec`: `session.id` **and** `agent.session.id` both empty on every
  span → grouping falls back to `TraceId`.
- One giant trace `7042d84e…` holds **25,885 spans** spanning both
  `claude-code` and `codex_exec`; it contains **18 distinct codex
  invocations** (counted as codex spans whose parent is a non-codex span).
- codex `ResourceAttributes` are all constant (`env`, `service.version`,
  `service.name`, `telemetry.sdk.*`) — **no per-process discriminator**
  (no `service.instance.id`, no `process.pid`).
- The subagent→codex chain **is** present in the tree when context
  propagates:
  `claude_code.tool` (carries `agent_id`) → `claude_code.tool.execution`
  (no `agent_id`) → `codex_exec` root span. The 18 codex invocations map to
  2 subagents (6 + 12).
- Codex-bearing traces **other than** the giant one have **zero** claude
  spans → those codex execs launched with a fresh root traceparent,
  detached from any subagent (the orphan/failure mode: trace context not
  propagated).
- `claude-code` subagent attrs: `agent_id` present (3 distinct);
  `subagent_type` present on only the **dispatch** span (separate span from
  the `agent_id` work spans); `parent_agent_id` present on **0** spans.

### Verified capabilities (spikes, 2026-05-31)

- **codex honors `OTEL_RESOURCE_ATTRIBUTES`.** A read-only `codex exec` run
  with `OTEL_RESOURCE_ATTRIBUTES=voi.spike.env=…` stamped that attribute
  onto every one of its 94 emitted spans' `ResourceAttributes`. (The
  `-c otel.resource.*` config override did **not** propagate — only the env
  var works; this is the standard OTel mechanism.)
- **`TRACEPARENT` is already exported** to a Claude Code Bash subprocess
  (observed `TRACEPARENT=00-<trace>-<span>-01`), pointing at the live
  Claude span. In a subagent, that live span carries `agent_id`.
- **`CLAUDE_CODE_SESSION_ID` is available** as an env var in the Bash
  subprocess (matched a real `session.id` in the data).
- There is **no `agent_id` env var** — the only handle on the subagent
  from the Bash env is the span id inside `TRACEPARENT`.

## Root cause

Flat session-keying cannot express the actor hierarchy, and the emission
side does not stamp the ids that would make codex identity + parentage
explicit. The two defects share this one cause.

## Design

Two layers, split by **which emitter we control**:

- **Layer 2 (emission)** — the `codex-run.sh` → codex seam is ours. Stamp
  explicit ids so codex identity + parent linkage are explicit-in-data.
- **Layer 1 (UI)** — the `agent_id`/`subagent_type` attributes come from
  Claude Code's emitter, which we do **not** control. The
  claude→subagent layer is therefore inherently UI derivation. The UI also
  consumes the Layer 2 codex stamps to build the nested model.

### Layer 2 — Emission (`scripts/codex-run.sh`, `bin/` demo wrappers)

Per codex invocation, `codex-run.sh` **appends to** `OTEL_RESOURCE_ATTRIBUTES`
(preserving any inherited value; comma-joined per the OTel spec
`key=value,key=value` grammar) before launching `codex exec`:

| Attribute key | Value | Purpose |
|---|---|---|
| `agent.session.id` | `$RUN_ID` (e.g. `voi-352-r1`) | codex's **own** session id → separates each exec. Reuses the key the query already reads as `AgentSessionId`. |
| `agent.parent.session.id` | `$CLAUDE_CODE_SESSION_ID` (empty if unset) | explicit pointer to the owning Claude session |
| `agent.parent.span.id` | the span-id field parsed from inherited `TRACEPARENT` (empty if no valid traceparent) | the subagent's live span, used by the UI to resolve the subagent `agent_id` |
| `agent.kind` | `codex_exec` | node-type disambiguation in the UI |

Rules:
- **Decision (locked):** the per-invocation id is `$RUN_ID`, not a fresh
  UUID. Human-readable, stable, already unique per `codex-run.sh` call, and
  ties the UI session label back to the codex run packet.
- **Preserve, don't clobber.** If `OTEL_RESOURCE_ATTRIBUTES` is already set
  in the env, append; never overwrite.
- **Forward `TRACEPARENT`** (already inherited ambiently) so codex keeps
  nesting in the trace tree — this is what lets the UI resolve
  `agent.parent.span.id` → the subagent.
- **Empty-value safety.** When `CLAUDE_CODE_SESSION_ID` or the traceparent
  span is absent (standalone codex, no Claude context), omit that key
  rather than stamping an empty value. A standalone codex then has only
  `agent.session.id` + `agent.kind` and renders as a correct top-level
  codex session.
- No collector or ClickHouse schema change — codex writes these itself
  (verified). The existing `SELECT` already returns full
  `ResourceAttributes`, so `agent.session.id` flows through as
  `AgentSessionId` with zero query change; the new keys arrive in the
  `ResourceAttributesRaw` map.

The `bin/cc-launch.sh` / `bin/codex-spawn.sh` demo wrappers get the same
stamping for parity so the `make demo` path produces nested sessions too.

**Routing (locked):** the entire emission layer (`scripts/codex-run.sh` +
`bin/` wrappers) is delivered by a **generic `implementer`** subagent via
`codex exec`, keeping the audit-trail invariant intact even for the
`scripts/` portion.

### Layer 1 — UI (`web/`, `ui-implementer`)

Replace the flat `SessionGroup[]` in `grouping.ts` with a **`SessionNode`
tree**:

```
SessionNode {
  kind: 'claude' | 'subagent' | 'codex'
  id            // stable node id
  sessionKey    // grouping key for this node
  label         // display label
  serviceName
  parentId      // null for root claude sessions
  children: SessionNode[]
  spans         // spans owned directly by this node
  // metrics: spanCount, traceCount, durationSeconds, lastActivity, hasError
}
```

Build algorithm:

1. **claude** nodes — bucket `claude-code` spans by `session.id`. Root of
   each tree (`parentId = null`).
2. **subagent** nodes — within a claude session, bucket the claude spans
   that carry a (non-root) `agent_id` by that `agent_id`. Label by
   tree-linking the `agent_id` subtree to its dispatch span's
   `subagent_type` (the two are on different spans). Parent = the
   enclosing claude session (or an enclosing subagent, via the span tree,
   if subagents nest).
3. **codex** nodes — bucket `codex_exec` spans by stamped
   `agent.session.id`. Parent resolution is a **two-tier fallback** that
   handles both the subagent-launched (~90%) and main-agent-launched cases
   with the same stamps:
   - read `agent.parent.span.id`; find that span in the in-memory
     spanId→span map; walk up `ParentSpanId` to the **nearest ancestor
     bearing `agent_id`** → that subagent node is the parent
     (**subagent → codex** case);
   - if no `agent_id` ancestor but `agent.parent.session.id` is present →
     parent = that claude session node. This is the **main-agent → codex**
     case: the main agent's spans carry no `agent_id`, so the walk finds
     none and codex nests **one level directly under the claude session**
     (the "direct codex" node). Tracked identically — same stamps, same
     resolver, the tree shakes out correctly because there is no
     intervening `agent_id`;
   - else (no parent session either — standalone codex with no Claude
     context) → top-level codex node.
4. Assemble into a forest by `parentId`; sort siblings by `lastActivity`
   desc (preserving the existing tie-breaks).

**Decision (locked): stamped data only.** The UI nests codex via the Layer
2 stamps. There is **no** separate heuristic to reconstruct un-stamped
historical codex (the old entry-span-detection fallback is **not** built).
Codex emitted before the emission packet ships renders flat until it ages
out of the query window. (The bounded `parent.span.id → agent_id` ancestor
walk in step 3 is **not** that fallback — it is deterministic resolution
anchored on an explicit stamp, and is required.)

`SessionSidebar` renders the `SessionNode` forest with disclosure triangles
(claude → subagent → codex), reusing existing activity-status, error, and
metric chips. The waterfall + inspector remain span-level and unchanged;
selecting any node scopes them to that node's spans.

## Scope (packets)

1. **Emission** (`implementer`): `scripts/codex-run.sh` +
   `bin/cc-launch.sh` + `bin/codex-spawn.sh` stamping. Verification:
   run `codex-run.sh worker` under a known `TRACEPARENT` +
   `CLAUDE_CODE_SESSION_ID`, then confirm the four attributes land on the
   codex spans in ClickHouse with the expected values.
2. **UI** (`ui-implementer`): nested `SessionNode` model in `grouping.ts`
   + `SessionSidebar` rendering. Depends on Packet 1 for live nested data.

## Runtime verification (per CLAUDE.md §"Deliver a working product")

This work is not done when code merges. It is done when:

- **Emission:** a `codex exec` launched via `scripts/codex-run.sh worker`
  (with `TRACEPARENT` + `CLAUDE_CODE_SESSION_ID` set in env) produces codex
  spans in ClickHouse carrying `agent.session.id=<RUN_ID>`,
  `agent.parent.session.id=<CLAUDE_CODE_SESSION_ID>`,
  `agent.parent.span.id=<span from TRACEPARENT>`, and `agent.kind=codex_exec`
  — confirmed by a `SELECT` against `otel_traces`.
- **UI:** `pnpm dev` against real ClickHouse shows, for a real Claude
  session, the nested hierarchy `claude → subagent → codex` in the sidebar,
  with each codex exec a distinct child node under its launching subagent —
  confirmed by Playwright navigation against `http://localhost:5174`.

## Out of scope

- Changing Claude Code's own emission (`agent_id` / `subagent_type` /
  `parent_agent_id`) — not our emitter; the claude→subagent layer stays
  derivation-based.
- A tree-derivation fallback for un-stamped historical codex (explicitly
  declined).
- Python SDK provenance changes — the SDK emitter is a separate concern;
  these two issues are about claude→subagent→codex only.
- Collector / ClickHouse schema changes — not needed.
