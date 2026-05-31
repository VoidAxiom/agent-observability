#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf '%s\n' 'Usage: codex-spawn.sh -- <command> [args...]' >&2
}

random_hex() {
  local bytes
  bytes="$1"
  od -An -tx1 -N"$bytes" /dev/urandom | tr -d ' \n'
}

new_traceparent() {
  local trace_id span_id
  trace_id="$(random_hex 16)"
  span_id="$(random_hex 8)"
  printf '00-%s-%s-01\n' "$trace_id" "$span_id"
}

resolve_traceparent() {
  if [[ "${TRACEPARENT:-}" =~ $CODEX_OTEL_TRACEPARENT_RE ]] \
     && _codex_otel_traceparent_ids_nonzero "$TRACEPARENT"; then
    RESOLVED_TRACEPARENT="$TRACEPARENT"
    TRACEPARENT_SOURCE='inherited'
  else
    RESOLVED_TRACEPARENT="$(new_traceparent)"
    TRACEPARENT_SOURCE='new root - no parent context'
  fi
}

_CODEX_SPAWN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
. "$_CODEX_SPAWN_DIR/../scripts/codex-otel-attrs.sh"

if [[ "$#" -gt 0 && "$1" == '--' ]]; then
  shift
  if [[ "$#" -eq 0 ]]; then
    usage
    exit 2
  fi

  _CODEX_SPAWN_INHERITED_TRACEPARENT="${TRACEPARENT:-}"
  resolve_traceparent
  export TRACEPARENT="$RESOLVED_TRACEPARENT"
  printf 'codex-spawn: TRACEPARENT=%s (%s)\n' "$TRACEPARENT" "$TRACEPARENT_SOURCE" >&2
  # Per-invocation codex session id for OTel stamping. Reuse CODEX_RUN_ID
  # if the caller set one; otherwise mint a stable per-invocation id.
  CODEX_RUN_ID="${CODEX_RUN_ID:-codex-spawn-$(random_hex 8)}"
  if [[ ! "$CODEX_RUN_ID" =~ ^[A-Za-z0-9._-]+$ ]]; then
    printf 'codex-spawn: invalid CODEX_RUN_ID (%s), falling back to minted id\n' \
      "$CODEX_RUN_ID" >&2
    CODEX_RUN_ID="codex-spawn-$(random_hex 8)"
  fi
  OTEL_RESOURCE_ATTRIBUTES="$(
    TRACEPARENT="$_CODEX_SPAWN_INHERITED_TRACEPARENT" \
      build_codex_otel_resource_attrs "$CODEX_RUN_ID"
  )"
  export OTEL_RESOURCE_ATTRIBUTES
  printf 'codex-spawn: OTEL_RESOURCE_ATTRIBUTES=%s\n' "$OTEL_RESOURCE_ATTRIBUTES" >&2
  exec "$@"
fi

usage
exit 2
