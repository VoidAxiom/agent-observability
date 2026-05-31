#!/usr/bin/env bash
# codex-otel-attrs.sh — build OTEL_RESOURCE_ATTRIBUTES for codex exec.
# Sourced by scripts/codex-run.sh and bin/codex-spawn.sh; provides one
# pure function: build_codex_otel_resource_attrs <run_id>.
#
# See .codex-runs/voi-385-r1/spec.md and docs/session-hierarchy-design.md
# § "Layer 2 — Emission".

# Intentionally NOT setting `set -euo pipefail` at the top of a sourced
# helper — would leak strict-mode into callers. Functions handle their
# own error paths.

CODEX_OTEL_TRACEPARENT_RE='^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$'

_codex_otel_traceparent_ids_nonzero() {
  # arg: a TRACEPARENT string already validated against the regex.
  # Returns 0 if trace id and span id are not all-zero.
  local version trace_id span_id flags
  IFS='-' read -r version trace_id span_id flags <<< "$1"
  [[ "$trace_id" != '00000000000000000000000000000000' \
     && "$span_id" != '0000000000000000' ]]
}

build_codex_otel_resource_attrs() {
  local run_id="${1:-}"
  if [[ -z "$run_id" ]]; then
    printf 'build_codex_otel_resource_attrs: run_id required\n' >&2
    return 2
  fi

  local -a parts=()
  # Preserve any pre-existing OTEL_RESOURCE_ATTRIBUTES first, normalized so
  # joining below cannot introduce empty resource-attribute entries.
  local existing="${OTEL_RESOURCE_ATTRIBUTES:-}"
  if [[ -n "$existing" ]]; then
    local -a _entries=()
    local _entry _stripped
    # Disable globbing for the split to avoid pathname expansion on
    # OTel resource-attribute values containing *, ?, or [..]. read -ra
    # with IFS=',' splits without glob.
    IFS=',' read -ra _entries <<< "$existing"
    local _e
    for _e in "${_entries[@]}"; do
      _stripped="${_e#"${_e%%[![:space:]]*}"}"
      _stripped="${_stripped%"${_stripped##*[![:space:]]}"}"
      if [[ -n "$_stripped" ]]; then
        parts+=("$_stripped")
      fi
    done
  fi
  parts+=("agent.session.id=${run_id}")
  parts+=("agent.kind=codex_exec")
  if [[ -n "${CLAUDE_CODE_SESSION_ID:-}" ]]; then
    parts+=("agent.parent.session.id=${CLAUDE_CODE_SESSION_ID}")
  fi
  if [[ -n "${TRACEPARENT:-}" && "${TRACEPARENT}" =~ $CODEX_OTEL_TRACEPARENT_RE ]] \
     && _codex_otel_traceparent_ids_nonzero "${TRACEPARENT}"; then
    local _v _t span_id _f
    IFS='-' read -r _v _t span_id _f <<< "${TRACEPARENT}"
    parts+=("agent.parent.span.id=${span_id}")
  fi

  # Comma-join with no leading/trailing/double commas. All entries are
  # already non-empty by construction (run_id checked above; literal
  # constants; env-var presence checked).
  local IFS=','
  printf '%s\n' "${parts[*]}"
}
