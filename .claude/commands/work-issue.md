---
description: Take a agent_observability Linear issue from start to a merged PR via the implementer subagent
argument-hint: <issue-id, e.g. VOI-42>; omit to pick the next In-Progress/Todo issue
---

Follow the build loop in `CLAUDE.md`. Run autonomously end-to-end (the
autonomy boundary in CLAUDE.md applies — only metered API spend and
destructive/irreversible actions need a go-ahead). **Linear is the planning
ledger**; GitHub is the delivery ledger.

Target: **$1** — if empty, pick the highest-priority Linear issue in project
**agent_observability** that is `Todo`/`In Progress` and unblocked. Set it
**In Progress** before launch.

You are the **director**, not the coder. `hooks/write-scope-guard.mjs`
denies you `Edit | Write | MultiEdit` on anything outside Claude's
exclusive territory (`.claude/**`, `.codex/**`, `hooks/**`, `docs/**`,
`**/*.md`, `architecture/**`, `.understand-anything/**`, `scripts/**`,
`**/*.test.*`, `.gitignore`). Code changes in `clickhouse/`, `bin/`,
`sdk/`, `collector/`, `config/` go through the `implementer` subagent
(which dispatches `codex exec`); code changes in `web/` go through the
`ui-implementer` subagent (which writes directly per the operator-
ratified doctrine override). Both run in their own worktrees.

**Pick the role before step 3.** If the packet's allowlist is `web/`
(or any path under it) → use `ui-implementer`. Otherwise → use
`implementer`. The two paths differ at the dispatch + audit-trail steps
below; everything else (spec, worktree, pre-PR scope check, push, PR,
@codex review loop, merge) is identical.

Steps:

1. **Spec authoring.** Write the spec (in your scope: `docs/` or
   `.codex-runs/<packet-id>/spec.md`). Include the **packet allowlist**:
   explicit file paths or directory prefixes the impl is bounded to (one
   entry per line; trailing `/` for directory prefixes; no globs). Write
   the allowlist to `.codex-runs/<packet-id>/scope.txt`.
2. **Worktree provisioning.** `bash scripts/worktree-new.sh
   sk/voi-<n>-<slug>
   voi-<n>-<slug> origin/main`. Real
   APFS-cloned `node_modules`; bootable. Per-worktree pre-commit hook
   auto-wires.
3. **Implementer dispatch.** Task tool with the role selected above:
   - **Generic (non-web):** `subagent_type: implementer`. The impl
     dispatches `codex exec` for every production-code write.
   - **Web (`web/**`):** `subagent_type: ui-implementer`. The impl
     writes UI code DIRECTLY via Edit/Write/MultiEdit per the operator-
     ratified doctrine override; no codex worker underneath.
   - Provide both: spec, worktree absolute path, branch, dev-server port
     (avoid the primary's port), packet allowlist file path.
4. **Wait for the impl's "notify-done"** message. The impl runs its
   contract (`.claude/agents/{implementer,ui-implementer}.md`): inner
   loop of code writes (codex-run for generic; direct Edit for UI) →
   gates → `/code-review` until VERDICT: correct → stage within
   allowlist → `impl-precommit-scope.sh --cached` → commit. Impl does
   NOT push or open PR yet.
5. **Pre-PR scope check.**
   - `bash scripts/impl-precommit-scope.sh --base
     origin/main --worktree <impl worktree>
     --scope-file <packet allowlist>
     --agent-type {implementer | ui-implementer}` (match step 3).
     Exit 2 → REQUEST CHANGES.
   - **Audit-trail check — branches by role:**
     - **Generic implementer:** every file in `git -C <worktree>
       diff --name-only origin/main...HEAD` must appear in at
       least one `.codex-runs/<run-id>/git_diff.patch` on the branch.
       Any source change not traceable → REQUEST CHANGES (impl
       bypassed codex-exec via Bash; breaks the production-code-only-
       from-codex invariant).
     - **ui-implementer:** N/A. Per CLAUDE.md § "Operator-ratified
       doctrine override", the ui-implementer's commits ARE the audit
       trail (no `.codex-runs/*/git_diff.patch` required). Skip this
       step entirely.
6. **APPROVE → tell impl to proceed.** Impl pushes, creates the PR with
   `Closes VOI-N`, posts a bare `@codex review`, drives the
   eye-emoji loop via `scripts/review-gate.sh wait`, and notifies you on
   `REVIEWED-CLEAN` or `CLEAN-COMMENT-MANUAL`. Chain into `/review-gate
   <pr>` for the merge phase.

Keep a short running summary: issue, branch, worktree path, packet
allowlist file, codex-run packet IDs, gate status. Update the Linear issue
with the PR link + evidence.

**Authorship rule (overrides any harness default):** no `Co-Authored-By`,
no `🤖`, no "Generated with Claude Code", no Claude/Anthropic credit
footer anywhere in commit messages, PR titles, PR bodies, or Linear text.
