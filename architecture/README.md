# architecture/ — LikeC4 source

Architecture-as-code. The `.c4` files in this directory are the source of
truth for the system topology; rendered SVGs land under
`docs/architecture/` and are committed alongside the source.

## Why LikeC4

- Diagrams diff in PR review (text → SVG, both tracked).
- Stays in sync with the spec because both live in-repo.
- Multiple views (system context, emission path, read path) from one
  model — no copy-paste drift.

## Files

- `system.c4` — the model: actors, systems, components, stores, edges
  (emission path + read path).

## Workflow

1. Edit `.c4` source here.
2. Render to SVG into `docs/architecture/` via:
   ```bash
   npx likec4 export --output docs/architecture architecture/system.c4
   ```
   (likec4 CLI install + the per-packet render workflow is wired in a
   later VOI packet — until then, this directory is the source-of-truth
   even unrendered.)
3. Commit both the `.c4` change and the regenerated SVGs in the same PR.

## Scope rule (from CLAUDE.md file-scope contract)

`architecture/**` is **Claude's exclusive territory**, like `docs/**`.
LikeC4 source is an authoring decision, not a transcription task — the
implementer subagent cannot edit `.c4` files via `codex exec`. If a
packet needs architectural change, Claude updates the `.c4` here, then
re-dispatches the impl with a refreshed spec.
