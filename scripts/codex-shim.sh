#!/usr/bin/env bash
# System-wide codex shim: stamp codex exec telemetry, then exec real codex.

set -euo pipefail

dirname() {
  local path="${1%/}"
  local dir
  if [[ "$path" == */* ]]; then
    dir="${path%/*}"
    if [[ -z "$dir" ]]; then
      dir='/'
    fi
    printf '%s\n' "$dir"
  else
    printf '.\n'
  fi
}

SHIM_DIR="$(cd "$(dirname "$0")" && pwd -P)"

find_real_codex() {
  local path_value="${PATH:-}"
  local -a entries=()
  local entry dir candidate candidate_link

  IFS=':' read -ra entries <<< "$path_value"
  for entry in "${entries[@]}"; do
    if [[ -z "$entry" ]]; then
      entry='.'
    fi
    if ! dir="$(cd "$entry" 2>/dev/null && pwd -P)"; then
      continue
    fi
    if [[ "$dir" == "$SHIM_DIR" ]]; then
      continue
    fi

    candidate="$entry/codex"
    if [[ ! -x "$candidate" ]]; then
      continue
    fi

    candidate_link="$(readlink "$candidate" 2>/dev/null || printf '%s' "$candidate")"
    if [[ "$candidate_link" == "$0" ]]; then
      continue
    fi

    printf '%s\n' "$candidate"
    return 0
  done

  return 1
}

should_stamp_codex_exec() {
  local skip_next=0
  local arg

  for arg in "$@"; do
    if [[ "$skip_next" -eq 1 ]]; then
      skip_next=0
      continue
    fi

    case "$arg" in
      -c|--config|-p|--profile|-m|--model)
        skip_next=1
        continue
        ;;
      --*=*)
        continue
        ;;
      -*)
        continue
        ;;
      exec)
        return 0
        ;;
      *)
        return 1
        ;;
    esac
  done

  return 1
}

real_codex="$(find_real_codex || true)"
if [[ -z "$real_codex" ]]; then
  printf 'codex-shim: real codex not found on PATH\n' >&2
  exit 127
fi

stamped='no'
run_id='-'
if should_stamp_codex_exec "$@"; then
  attrs_wrapped=",${OTEL_RESOURCE_ATTRIBUTES:-},"
  if [[ "$attrs_wrapped" == *",agent.session.id="* ]]; then
    stamped='already'
  else
    # shellcheck source=/dev/null
    . "$SHIM_DIR/codex-otel-attrs.sh"
    run_id="codex-shim-$(od -An -tx1 -N8 /dev/urandom | tr -d ' \n')"
    OTEL_RESOURCE_ATTRIBUTES="$(build_codex_otel_resource_attrs "$run_id")"
    export OTEL_RESOURCE_ATTRIBUTES
    stamped='yes'
  fi
fi

if [[ "${CODEX_SHIM_DEBUG:-}" == '1' ]]; then
  printf 'codex-shim: real=%s stamped=%s run_id=%s\n' "$real_codex" "$stamped" "$run_id" >&2
fi

exec "$real_codex" "$@"
