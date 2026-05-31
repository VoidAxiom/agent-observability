#!/usr/bin/env bash
# test-codex-otel-attrs.sh — covers all 7 cases enumerated in
# .codex-runs/voi-385-r1/spec.md § "New test".
#
# Plain shell test: sources the helper, calls
# build_codex_otel_resource_attrs with various env shapes, asserts the
# output string. Exits non-zero on any failure.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
# shellcheck source=/dev/null
. "$ROOT/scripts/codex-otel-attrs.sh"

FAIL=0
assert_eq() {
  local label="$1" expected="$2" actual="$3"
  if [[ "$expected" == "$actual" ]]; then
    printf 'PASS  %s\n' "$label"
  else
    printf 'FAIL  %s\n  expected: %s\n  actual:   %s\n' \
      "$label" "$expected" "$actual" >&2
    FAIL=1
  fi
}

# Run each case in a subshell so env mutations don't leak.

# Case 1: minimal — only run_id.
out=$(
  unset OTEL_RESOURCE_ATTRIBUTES CLAUDE_CODE_SESSION_ID TRACEPARENT
  build_codex_otel_resource_attrs voi-385-r1
)
assert_eq 'case1 minimal' \
  'agent.session.id=voi-385-r1,agent.kind=codex_exec' \
  "$out"

# Case 2: CLAUDE_CODE_SESSION_ID set.
out=$(
  unset OTEL_RESOURCE_ATTRIBUTES TRACEPARENT
  export CLAUDE_CODE_SESSION_ID='claude-sess-abc'
  build_codex_otel_resource_attrs voi-385-r1
)
assert_eq 'case2 claude session id' \
  'agent.session.id=voi-385-r1,agent.kind=codex_exec,agent.parent.session.id=claude-sess-abc' \
  "$out"

# Case 3: valid TRACEPARENT.
out=$(
  unset OTEL_RESOURCE_ATTRIBUTES CLAUDE_CODE_SESSION_ID
  export TRACEPARENT='00-0123456789abcdef0123456789abcdef-fedcba9876543210-01'
  build_codex_otel_resource_attrs voi-385-r1
)
assert_eq 'case3 valid traceparent' \
  'agent.session.id=voi-385-r1,agent.kind=codex_exec,agent.parent.span.id=fedcba9876543210' \
  "$out"

# Case 4: all-zero span TRACEPARENT (span ignored).
out=$(
  unset OTEL_RESOURCE_ATTRIBUTES CLAUDE_CODE_SESSION_ID
  export TRACEPARENT='00-0123456789abcdef0123456789abcdef-0000000000000000-01'
  build_codex_otel_resource_attrs voi-385-r1
)
assert_eq 'case4 all-zero span' \
  'agent.session.id=voi-385-r1,agent.kind=codex_exec' \
  "$out"

# Case 4b: all-zero trace id TRACEPARENT (trace context ignored).
out=$(
  unset OTEL_RESOURCE_ATTRIBUTES CLAUDE_CODE_SESSION_ID
  export TRACEPARENT='00-00000000000000000000000000000000-fedcba9876543210-01'
  build_codex_otel_resource_attrs voi-385-r1
)
assert_eq 'case4b all-zero trace id' \
  'agent.session.id=voi-385-r1,agent.kind=codex_exec' \
  "$out"

# Case 5a: malformed TRACEPARENT (wrong shape).
out=$(
  unset OTEL_RESOURCE_ATTRIBUTES CLAUDE_CODE_SESSION_ID
  export TRACEPARENT='not-a-traceparent'
  build_codex_otel_resource_attrs voi-385-r1
)
assert_eq 'case5a malformed traceparent shape' \
  'agent.session.id=voi-385-r1,agent.kind=codex_exec' \
  "$out"

# Case 5b: malformed TRACEPARENT (wrong version).
out=$(
  unset OTEL_RESOURCE_ATTRIBUTES CLAUDE_CODE_SESSION_ID
  export TRACEPARENT='01-0123456789abcdef0123456789abcdef-fedcba9876543210-01'
  build_codex_otel_resource_attrs voi-385-r1
)
assert_eq 'case5b malformed traceparent version' \
  'agent.session.id=voi-385-r1,agent.kind=codex_exec' \
  "$out"

# Case 5c: malformed TRACEPARENT (uppercase hex).
out=$(
  unset OTEL_RESOURCE_ATTRIBUTES CLAUDE_CODE_SESSION_ID
  export TRACEPARENT='00-0123456789ABCDEF0123456789ABCDEF-FEDCBA9876543210-01'
  build_codex_otel_resource_attrs voi-385-r1
)
assert_eq 'case5c malformed traceparent uppercase' \
  'agent.session.id=voi-385-r1,agent.kind=codex_exec' \
  "$out"

# Case 5d: malformed TRACEPARENT (trailing whitespace).
out=$(
  unset OTEL_RESOURCE_ATTRIBUTES CLAUDE_CODE_SESSION_ID
  export TRACEPARENT='00-0123456789abcdef0123456789abcdef-fedcba9876543210-01 '
  build_codex_otel_resource_attrs voi-385-r1
)
assert_eq 'case5d malformed traceparent whitespace' \
  'agent.session.id=voi-385-r1,agent.kind=codex_exec' \
  "$out"

# Case 6: pre-existing OTEL_RESOURCE_ATTRIBUTES preserved first.
out=$(
  unset CLAUDE_CODE_SESSION_ID TRACEPARENT
  export OTEL_RESOURCE_ATTRIBUTES='foo=bar'
  build_codex_otel_resource_attrs voi-385-r1
)
assert_eq 'case6 preserve existing' \
  'foo=bar,agent.session.id=voi-385-r1,agent.kind=codex_exec' \
  "$out"

# Case 6b: pre-existing OTEL_RESOURCE_ATTRIBUTES normalized.
out=$(
  unset CLAUDE_CODE_SESSION_ID TRACEPARENT
  export OTEL_RESOURCE_ATTRIBUTES='  ,foo=bar,,service.name=codex,  '
  build_codex_otel_resource_attrs voi-385-r1
)
assert_eq 'case6b normalize existing' \
  'foo=bar,service.name=codex,agent.session.id=voi-385-r1,agent.kind=codex_exec' \
  "$out"

# Case 6c: pre-existing OTEL_RESOURCE_ATTRIBUTES with whitespace-only entries.
out=$(
  unset CLAUDE_CODE_SESSION_ID TRACEPARENT
  export OTEL_RESOURCE_ATTRIBUTES=' , , '
  build_codex_otel_resource_attrs voi-385-r1
)
assert_eq 'case6c whitespace-only entries dropped' \
  'agent.session.id=voi-385-r1,agent.kind=codex_exec' \
  "$out"

# Case 6d: glob metachars in pre-existing OTEL_RESOURCE_ATTRIBUTES are preserved.
out=$(
  unset CLAUDE_CODE_SESSION_ID TRACEPARENT
  tmpdir="$(mktemp -d "${TMPDIR:-/tmp}/codex-otel-attrs-glob.XXXXXX")"
  trap 'rm -f "$tmpdir/service.version=1.2.x" "$tmpdir/deployment.environment=proda"; rmdir "$tmpdir"' EXIT
  touch "$tmpdir/service.version=1.2.x" "$tmpdir/deployment.environment=proda"
  cd "$tmpdir"
  export OTEL_RESOURCE_ATTRIBUTES='service.version=1.2.*,deployment.environment=prod[a]'
  build_codex_otel_resource_attrs voi-385-r1
)
assert_eq 'case6d glob metachar in existing attr preserved' \
  'service.version=1.2.*,deployment.environment=prod[a],agent.session.id=voi-385-r1,agent.kind=codex_exec' \
  "$out"

# Case 7: full house.
out=$(
  export OTEL_RESOURCE_ATTRIBUTES='foo=bar'
  export CLAUDE_CODE_SESSION_ID='claude-sess-abc'
  export TRACEPARENT='00-0123456789abcdef0123456789abcdef-fedcba9876543210-01'
  build_codex_otel_resource_attrs voi-385-r1
)
assert_eq 'case7 full house' \
  'foo=bar,agent.session.id=voi-385-r1,agent.kind=codex_exec,agent.parent.session.id=claude-sess-abc,agent.parent.span.id=fedcba9876543210' \
  "$out"

# Also test missing run_id is a hard error.
if (
  unset OTEL_RESOURCE_ATTRIBUTES CLAUDE_CODE_SESSION_ID TRACEPARENT
  build_codex_otel_resource_attrs '' 2>/dev/null
); then
  printf 'FAIL  case8 empty run_id should error\n' >&2
  FAIL=1
else
  printf 'PASS  case8 empty run_id errors\n'
fi

# Case 9: standalone codex-spawn shape — TRACEPARENT exists but is empty.
out=$(
  unset OTEL_RESOURCE_ATTRIBUTES CLAUDE_CODE_SESSION_ID
  export TRACEPARENT=''
  build_codex_otel_resource_attrs voi-385-r1
)
assert_eq 'case9 standalone codex-spawn shape (TRACEPARENT empty, run_id set)' \
  'agent.session.id=voi-385-r1,agent.kind=codex_exec' \
  "$out"

if [[ "$FAIL" -ne 0 ]]; then
  printf '\nTEST FAILURES\n' >&2
  exit 1
fi
printf '\nAll cases passed.\n'
