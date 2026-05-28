#!/usr/bin/env bash
# scripts/check-prereqs.sh — prerequisite verifier for agent-observability.
#
# Verifies the tools required for the dev/build/test loop are installed and
# at the required versions. Prints one line per check (✓ or ✗ or ℹ) and
# exits 0 if all REQUIRED checks pass, non-zero with diagnostics if any
# required tool is missing or wrong version. Optional tools that are absent
# emit a soft ℹ note and do not fail the script.
#
# Usage:
#   bash scripts/check-prereqs.sh
#
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

fail_count=0

# -- helpers ----------------------------------------------------------------

pass() { printf "✓ %s\n" "$1"; }

fail() {
  printf "✗ %s\n" "$1" >&2
  if [ -n "${2-}" ]; then
    printf "    install: %s\n" "$2" >&2
  fi
  fail_count=$((fail_count + 1))
}

soft() {
  printf "ℹ %s (optional, not required for M0)\n" "$1"
  if [ -n "${2-}" ]; then
    printf "    install when needed: %s\n" "$2"
  fi
}

info() { printf "ℹ %s\n" "$1"; }

# version_ge X Y → 0 if X ≥ Y, 1 otherwise. Splits each on '.', compares
# components numerically. Tolerates non-numeric suffixes (e.g. "3.11.0rc1")
# by stripping the first non-digit and everything after it within each
# component. Uses POSIX awk so it works on default macOS/BSD/Linux without
# requiring GNU coreutils.
version_ge() {
  awk -v a="$1" -v b="$2" 'BEGIN {
    n = split(a, ax, ".")
    m = split(b, bx, ".")
    max = (n > m) ? n : m
    for (i = 1; i <= max; i++) {
      av = (i <= n) ? ax[i] : 0
      bv = (i <= m) ? bx[i] : 0
      sub(/[^0-9].*/, "", av); sub(/[^0-9].*/, "", bv)
      av += 0; bv += 0
      if (av > bv) exit 0
      if (av < bv) exit 1
    }
    exit 0  # equal
  }'
}

# -- REQUIRED: orchestration --------------------------------------------------

# git — table stakes.
if command -v git >/dev/null 2>&1; then
  pass "git $(git --version | awk '{print $3}')"
else
  fail "git not on PATH" "'brew install git'"
fi

# gh — used for PR open, comments, review-gate.sh, sidecar.
if command -v gh >/dev/null 2>&1; then
  gh_ver="$(gh --version | head -1 | awk '{print $3}')"
  pass "gh $gh_ver"
else
  fail "gh not on PATH" "'brew install gh' then 'gh auth login'"
fi

# python3 ≥ 3.11 — used by:
#   - sdk/ (the Python OTel SDK package, target Python ≥ 3.11 per VOI-308)
#   - hooks/session-recovery.py, hooks/compaction-sidecar.sh
#   - scripts/autonomous-sidecar.sh (JSON parsing helpers)
if command -v python3 >/dev/null 2>&1; then
  v="$(python3 --version 2>&1 | awk '{print $2}')"
  if version_ge "$v" "3.11.0"; then
    pass "python3 $v (≥ 3.11 required)"
  else
    fail "python3 $v (need ≥ 3.11)" "'brew install python@3.12'"
  fi
else
  fail "python3 not on PATH" "'brew install python@3.12'"
fi

# bash — version 4+ recommended for the scripts/ inventory; macOS ships
# bash 3.2 by default but our scripts are POSIX-portable. Soft check.
if command -v bash >/dev/null 2>&1; then
  pass "bash $(bash --version | head -1 | sed 's/.*version \([0-9.]*\).*/\1/')"
fi

# -- REQUIRED: M0 stack -------------------------------------------------------

# docker — used for:
#   - clickhouse/docker-compose.yml (VOI-306)
#   - collector/ (optional Docker mode for otelcol-contrib, VOI-307)
# Accept Docker Desktop, colima, OrbStack — anything that provides a `docker` CLI.
if command -v docker >/dev/null 2>&1; then
  d_ver="$(docker --version 2>/dev/null | awk '{print $3}' | sed 's/,$//')"
  pass "docker $d_ver"
else
  fail "docker not on PATH" "Docker Desktop / colima / OrbStack — any container runtime"
fi

# clickhouse-client — used by:
#   - clickhouse/migrate.sh (VOI-306)
#   - VOI-306/307/308/310 runtime verification steps
# If absent, scripts can fall back to `docker exec` against the CH container,
# but having the host client makes Makefile targets simpler.
if command -v clickhouse-client >/dev/null 2>&1; then
  ch_ver="$(clickhouse-client --version 2>&1 | head -1 | awk '{print $4}')"
  pass "clickhouse-client $ch_ver"
else
  soft "clickhouse-client (Makefile falls back to 'docker exec' against the CH container)" \
       "'brew install --cask clickhouse-client'"
fi

# -- OPTIONAL: M4 SwiftUI app -------------------------------------------------

# xcodebuild — required for app/ packets (VOI-309, VOI-312, VOI-314, M4 packets).
# Soft for M0 dev boxes that aren't building the app yet.
if command -v xcodebuild >/dev/null 2>&1; then
  xc_ver="$(xcodebuild -version 2>/dev/null | head -1 | awk '{print $2}')"
  pass "xcodebuild $xc_ver"
else
  soft "xcodebuild (Xcode / Command Line Tools) — needed for VOI-309 onwards (the SwiftUI app)" \
       "'xcode-select --install' or install full Xcode from the App Store"
fi

# -- OPTIONAL: collector binary mode + load testing ---------------------------

# otelcol-contrib — used by collector/ (VOI-307). Optional because the
# packet can choose Docker mode (otel/opentelemetry-collector-contrib image)
# instead of a native binary.
if command -v otelcol-contrib >/dev/null 2>&1; then
  oc_ver="$(otelcol-contrib --version 2>&1 | head -1 | awk '{print $2}')"
  pass "otelcol-contrib $oc_ver"
else
  soft "otelcol-contrib (VOI-307 can use the Docker image instead)" \
       "'brew install opentelemetry-collector-contrib'"
fi

# telemetrygen — used by VOI-307 runtime verification (one-shot OTLP emit).
# Ships with the otel-collector-contrib binary distribution; optional.
if command -v telemetrygen >/dev/null 2>&1; then
  pass "telemetrygen (OTel load-test helper)"
else
  soft "telemetrygen (VOI-307 smoke can use curl instead)" \
       "'go install github.com/open-telemetry/opentelemetry-collector-contrib/cmd/telemetrygen@latest'"
fi

# -- OPTIONAL: architecture-as-code -------------------------------------------

# node — needed by likec4 (architecture/ rendering). Optional until likec4
# install lands in a dedicated packet.
if command -v node >/dev/null 2>&1; then
  v="$(node --version | sed 's/^v//')"
  if version_ge "$v" "20.0.0"; then
    pass "node $v"
  else
    soft "node $v is old; likec4 wants ≥ 20" "'brew upgrade node'"
  fi
else
  soft "node (only required for likec4 architecture rendering)" "'brew install node'"
fi

# likec4 — architecture/ → docs/architecture/*.svg rendering. Soft.
if [ -x "node_modules/.bin/likec4" ]; then
  v="$(node_modules/.bin/likec4 --version 2>&1 | tail -n 1)"
  pass "likec4 $v (local)"
elif command -v likec4 >/dev/null 2>&1; then
  v="$(likec4 --version 2>&1 | tail -n 1)"
  pass "likec4 $v (global)"
else
  soft "likec4 (for rendering architecture/system.c4 → docs/architecture/*.svg)" \
       "'npm i -g likec4' or wait for the architecture-render packet"
fi

# uv — Python tool runner. Optional but useful for sdk/ workflows.
if command -v uv >/dev/null 2>&1; then
  pass "uv $(uv --version 2>&1 | awk '{print $2}')"
else
  soft "uv (Python project + tool runner)" "'brew install uv'"
fi

# /understand — Claude Code slash command from the understand-anything
# plugin. This bash script cannot introspect Claude Code's loaded
# skills/plugins, so we surface a verification hint instead of a hard
# check.
info "/understand is a Claude Code skill — verify in-session by typing '/understand' (requires the understand-anything plugin)"

# -- verdict ----------------------------------------------------------------

echo
if [ "$fail_count" -eq 0 ]; then
  echo "all REQUIRED prerequisites satisfied (optional tools noted above)."
  exit 0
else
  echo "$fail_count REQUIRED prerequisite(s) missing or wrong version — see diagnostics above." >&2
  exit 1
fi
