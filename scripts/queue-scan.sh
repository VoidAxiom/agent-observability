#!/usr/bin/env bash
# scripts/queue-scan.sh — parallelization-gate queue scanner.
#
# Lists packets in the active phase that are dispatchable RIGHT NOW per
# the parallel-by-default doctrine in CLAUDE.md § Delegation & parallelism.
#
#   A packet is dispatchable iff:
#     - it is NOT already merged to main (no VOI-N in `git log origin/main`)
#     - it does NOT have an existing `sk/voi-<n>-...` branch (local OR remote)
#       — i.e., it hasn't been dispatched yet
#     - ALL of its declared dependencies are content-available:
#         dep merged to main OR dep's branch exists on origin
#       (the second case is the stacked-PR pattern: dispatch on top of an
#        in-flight branch, target that branch as the PR base, GitHub
#        retargets to main after the dep merges.)
#
# Exit code: 0 if nothing dispatchable (it's OK to idle), 1 if there are
# dispatchable packets (do NOT idle — dispatch them). The companion hook
# `hooks/schedule-wakeup-guard.mjs` reads this exit code + stdout and
# denies `ScheduleWakeup` when this returns non-zero.
#
# This script uses LOCAL git refs only — no `git fetch` on every call.
# The user is expected to keep local refs reasonably current. A
# recently-pushed branch that hasn't been fetched locally may be
# briefly mis-classified as "not yet dispatched"; the worst case is a
# false dispatchable signal which is a soft prompt to investigate.
#
# Configurable via env:
#   PHASE=0       — which phase to scan. Default 0 (= M0 walking skeleton).
#                   Phase N tables are added below when the user blesses
#                   the phase boundary per the build plan in CLAUDE.md.
#   QUEUE_SCAN_VERBOSE=1 — print state summary even on exit 0.
#
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

PHASE="${PHASE:-0}"

# ---- Phase 0 (M0) packet table -------------------------------------------
# Hard-coded mirror of Linear's M0 packet set. Keys = VOI-N (canonical
# Linear identifier); values = "M0.X short title". The set is closed —
# this is what "M0" is. New M0 packets get added here in the same PR that
# creates the Linear subissue.
#
# Source of truth for dep edges: the blockedBy graph on each VOI-N issue
# in Linear (project `agent_observability`). When the graph changes, this
# table is updated in the same PR that updates the Linear edge.

declare -a PHASE_0_PACKETS=(
  "VOI-304:M0.1 Repo layout scaffold + Makefile"
  "VOI-306:M0.2 ClickHouse local + otel_* schema + smoke SELECT"
  "VOI-307:M0.3 OTel Collector config + spans-to-ClickHouse smoke"
  "VOI-308:M0.4 Python SDK scaffold + auto-instrument smoke"
  "VOI-309:M0.5 SwiftUI app skeleton — List view bound to ClickHouse query"
  "VOI-310:M0.6 Walking-skeleton integration — make demo end-to-end"
)

# Hard-coded deps: "depender:dep1 dep2 ..." pairs. Packets not listed have
# no declared deps. Stacked-PR is allowed — a dep is "met" if its branch
# exists on origin even if not yet merged.
#
# M0 critical path: VOI-304 → VOI-306 ┬→ VOI-307 → VOI-308 ─┐
#                                     └→ VOI-309 ──────────┴→ VOI-310
declare -a DEPS_PAIRS=(
  "VOI-306:VOI-304"
  "VOI-307:VOI-306"
  "VOI-308:VOI-307"
  "VOI-309:VOI-306"
  "VOI-310:VOI-308 VOI-309"
)

# ---- Lookup helpers -------------------------------------------------------

deps_of() {
  local pkt="$1"
  for pair in "${DEPS_PAIRS[@]}"; do
    if [ "${pair%%:*}" = "$pkt" ]; then
      echo "${pair#*:}"
      return
    fi
  done
}

title_of() {
  local pkt="$1"
  for pair in "${PHASE_0_PACKETS[@]}"; do
    if [ "${pair%%:*}" = "$pkt" ]; then
      echo "${pair#*:}"
      return
    fi
  done
}

# ---- Detect merged + dispatched state -------------------------------------

# Merged: VOI-N IDs in commit subjects on origin/main (or local main if
# origin/main is missing). Tolerates either ref existing.
if git rev-parse --verify --quiet origin/main >/dev/null; then
  MAIN_REF=origin/main
else
  MAIN_REF=main
fi

MERGED_TOKENS=" $(git log "$MAIN_REF" --pretty=format:'%s' 2>/dev/null \
                  | grep -oE 'VOI-[0-9]+' | sort -u | tr '\n' ' ') "

# Dispatched: `sk/voi-<n>-...` branches that exist locally OR on origin.
# Anchored regex: `^sk/voi-N` (CLAUDE.md branch convention) — stray refs
# like `docs/voi-193-notes` no longer false-positive as dispatched.
_extract_dispatch_tokens() {
  # stdin: refnames (one per line). stdout: VOI-N tokens of `sk/voi-N-*` refs.
  grep -oE '^sk/voi-[0-9]+' | sed 's|^sk/||' | tr '[:lower:]' '[:upper:]' | sort -u
}

DISPATCHED_LOCAL=$(git for-each-ref --format='%(refname:short)' refs/heads \
                   | _extract_dispatch_tokens)
DISPATCHED_REMOTE=$(git for-each-ref --format='%(refname:short)' refs/remotes/origin \
                    | sed 's|^origin/||' | _extract_dispatch_tokens)

# Combined: any `sk/voi-N-*` branch (local OR remote) marks the packet as
# "dispatched" — avoids re-dispatching what's already in flight in this
# checkout, even before push.
DISPATCHED_TOKENS=" $(printf '%s\n%s\n' "$DISPATCHED_LOCAL" "$DISPATCHED_REMOTE" \
                      | sort -u | tr '\n' ' ') "

# Deps-met readiness uses ORIGIN-ONLY refs. A downstream impl provisions
# its worktree from `origin/sk/<dep>` — a stale, unpushed local dep branch
# is NOT actually content-available to the downstream packet, so it must
# not count as satisfying the dep.
REMOTE_DISPATCHED_TOKENS=" $(printf '%s\n' "$DISPATCHED_REMOTE" | tr '\n' ' ') "

contains() {
  local hay="$1" needle="$2"
  [[ "$hay" == *" $needle "* ]]
}

# ---- Phase routing --------------------------------------------------------

case "$PHASE" in
  0)
    PACKETS=("${PHASE_0_PACKETS[@]}")
    ;;
  *)
    echo "queue-scan: Phase $PHASE not yet configured. Update scripts/queue-scan.sh." >&2
    exit 2
    ;;
esac

# ---- Scan + verdict -------------------------------------------------------

DISPATCHABLE=()
IN_FLIGHT=()
DONE=()
BLOCKED=()

for pair in "${PACKETS[@]}"; do
  pkt="${pair%%:*}"
  title="${pair#*:}"

  if contains "$MERGED_TOKENS" "$pkt"; then
    DONE+=("$pkt: $title")
    continue
  fi

  if contains "$DISPATCHED_TOKENS" "$pkt"; then
    IN_FLIGHT+=("$pkt: $title")
    continue
  fi

  # Not merged, not dispatched. Check deps — origin-only for the stacked-PR
  # readiness check (unpushed local refs cannot satisfy a dep).
  pkt_deps=$(deps_of "$pkt")
  unmet=()
  for dep in $pkt_deps; do
    if contains "$MERGED_TOKENS" "$dep" || contains "$REMOTE_DISPATCHED_TOKENS" "$dep"; then
      continue
    fi
    unmet+=("$dep")
  done

  if [ "${#unmet[@]}" -eq 0 ]; then
    DISPATCHABLE+=("$pkt: $title")
  else
    BLOCKED+=("$pkt: $title  (waiting on: ${unmet[*]})")
  fi
done

# ---- Output ---------------------------------------------------------------

if [ "${#DISPATCHABLE[@]}" -gt 0 ]; then
  echo "Phase $PHASE — DISPATCHABLE packets (deps content-available, branch not yet created):"
  printf '  ✗ %s\n' "${DISPATCHABLE[@]}"
  if [ "${QUEUE_SCAN_VERBOSE:-0}" = "1" ]; then
    echo
    echo "Phase $PHASE — in-flight (dispatched or in re-review):"
    printf '  ⏳ %s\n' "${IN_FLIGHT[@]}"
    echo
    echo "Phase $PHASE — done (merged to $MAIN_REF):"
    printf '  ✓ %s\n' "${DONE[@]}"
    echo
    [ "${#BLOCKED[@]}" -gt 0 ] && {
      echo "Phase $PHASE — blocked (declared deps still in flight):"
      printf '  ⏸ %s\n' "${BLOCKED[@]}"
    }
  fi
  exit 1
fi

# Nothing dispatchable. Print summary only if verbose.
if [ "${QUEUE_SCAN_VERBOSE:-0}" = "1" ]; then
  echo "Phase $PHASE — nothing dispatchable."
  [ "${#IN_FLIGHT[@]}" -gt 0 ] && printf '  ⏳ %s\n' "${IN_FLIGHT[@]}"
  [ "${#BLOCKED[@]}" -gt 0 ] && printf '  ⏸ %s\n' "${BLOCKED[@]}"
  [ "${#DONE[@]}" -gt 0 ] && printf '  ✓ %s\n' "${DONE[@]}"
fi
exit 0
