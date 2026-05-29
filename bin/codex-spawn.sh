#!/usr/bin/env bash
set -euo pipefail

TRACEPARENT_RE='^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$'

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
  if [[ "${TRACEPARENT:-}" =~ $TRACEPARENT_RE ]]; then
    RESOLVED_TRACEPARENT="$TRACEPARENT"
    TRACEPARENT_SOURCE='inherited'
  else
    RESOLVED_TRACEPARENT="$(new_traceparent)"
    TRACEPARENT_SOURCE='new root - no parent context'
  fi
}

if [[ "$#" -gt 0 && "$1" == '--' ]]; then
  shift
  if [[ "$#" -eq 0 ]]; then
    usage
    exit 2
  fi

  resolve_traceparent
  export TRACEPARENT="$RESOLVED_TRACEPARENT"
  printf 'codex-spawn: TRACEPARENT=%s (%s)\n' "$TRACEPARENT" "$TRACEPARENT_SOURCE" >&2
  exec "$@"
fi

usage
exit 2
