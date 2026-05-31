#!/usr/bin/env bash
# Idempotently install the system-wide codex shim into $INSTALL_DIR.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
INSTALL_DIR="${INSTALL_DIR:-$HOME/bin}"

shim_src="$REPO_ROOT/scripts/codex-shim.sh"
attrs_src="$REPO_ROOT/scripts/codex-otel-attrs.sh"

if [[ ! -f "$shim_src" ]]; then
  printf 'install-codex-shim: missing %s\n' "$shim_src" >&2
  exit 1
fi
if [[ ! -f "$attrs_src" ]]; then
  printf 'install-codex-shim: missing %s\n' "$attrs_src" >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR"
INSTALL_DIR="$(cd "$INSTALL_DIR" && pwd)"
INSTALL_DIR_CANON="$(cd "$INSTALL_DIR" && pwd -P)"

path_contains_real_codex_after_install_dir() {
  local seen_install=0
  local found_real=1
  local -a entries=()
  local entry dir candidate

  IFS=':' read -ra entries <<< "${PATH:-}"
  for entry in "${entries[@]}"; do
    if [[ -z "$entry" ]]; then
      entry='.'
    fi
    if ! dir="$(cd "$entry" 2>/dev/null && pwd -P)"; then
      continue
    fi

    if [[ "$dir" == "$INSTALL_DIR_CANON" ]]; then
      seen_install=1
      continue
    fi

    candidate="$entry/codex"
    if [[ -x "$candidate" ]]; then
      if [[ "$seen_install" -ne 1 ]]; then
        printf 'install-codex-shim: %s must come before %s on PATH.\n' "$INSTALL_DIR" "$dir" >&2
        return 2
      fi
      found_real=0
      break
    fi
  done

  if [[ "$found_real" -ne 0 ]]; then
    printf 'install-codex-shim: real codex not found on PATH after %s\n' "$INSTALL_DIR" >&2
    return 1
  fi

  return 0
}

install_link() {
  local link_path="$1"
  local expected_target="$2"
  local current_target

  if [[ -L "$link_path" ]]; then
    current_target="$(readlink "$link_path")"
    if [[ "$current_target" == "$expected_target" ]]; then
      return 0
    fi
    printf 'install-codex-shim: %s exists but points to %s, expected %s\n' \
      "$link_path" "$current_target" "$expected_target" >&2
    return 2
  fi

  if [[ -e "$link_path" ]]; then
    printf 'install-codex-shim: %s exists and is not the expected symlink\n' "$link_path" >&2
    return 2
  fi

  ln -s "$expected_target" "$link_path"
  printf 'codex-shim: installed %s -> %s\n' "$link_path" "$expected_target"
  return 1
}

precheck_link() {
  local link_path="$1"
  local expected_target="$2"
  local current_target

  if [[ -L "$link_path" ]]; then
    current_target="$(readlink "$link_path")"
    if [[ "$current_target" == "$expected_target" ]]; then
      return 0
    fi
    printf 'install-codex-shim: %s exists but points to %s, expected %s\n' \
      "$link_path" "$current_target" "$expected_target" >&2
    return 2
  fi

  if [[ -e "$link_path" ]]; then
    printf 'install-codex-shim: %s exists and is not the expected symlink\n' "$link_path" >&2
    return 2
  fi

  return 1
}

path_contains_real_codex_after_install_dir

codex_link="$INSTALL_DIR/codex"
attrs_link="$INSTALL_DIR/codex-otel-attrs.sh"
already=0

link_status=0
precheck_link "$codex_link" "$shim_src" || link_status=$?
case "$link_status" in
  0 | 1) ;;
  *) exit "$link_status" ;;
esac

link_status=0
precheck_link "$attrs_link" "$attrs_src" || link_status=$?
case "$link_status" in
  0 | 1) ;;
  *) exit "$link_status" ;;
esac

link_status=0
install_link "$codex_link" "$shim_src" || link_status=$?
case "$link_status" in
  0) already=$((already + 1)) ;;
  1) ;;
  *) exit "$link_status" ;;
esac

link_status=0
install_link "$attrs_link" "$attrs_src" || link_status=$?
case "$link_status" in
  0) already=$((already + 1)) ;;
  1) ;;
  *) exit "$link_status" ;;
esac

if [[ "$already" -eq 2 ]]; then
  printf 'codex-shim: already installed\n'
  exit 0
fi

hash -r 2>/dev/null || true
resolved_codex="$(command -v codex || true)"
printf 'codex-shim: command -v codex -> %s\n' "$resolved_codex"
if [[ -n "$resolved_codex" ]]; then
  resolved_dir="$(cd "$(dirname "$resolved_codex")" 2>/dev/null && pwd)" || resolved_dir=""
  if [[ -n "$resolved_dir" ]]; then
    resolved_codex="$resolved_dir/$(basename "$resolved_codex")"
  fi
fi
if [[ "$resolved_codex" != "$codex_link" ]]; then
  printf 'install-codex-shim: command -v codex resolved to %s, expected %s\n' "$resolved_codex" "$codex_link" >&2
  exit 1
fi

if ! codex --version >/dev/null 2>&1; then
  printf 'install-codex-shim: warning: codex --version failed after install\n' >&2
fi
