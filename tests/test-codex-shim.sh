#!/usr/bin/env bash
# test-codex-shim.sh — covers VOI-390 system-wide codex shim behavior.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
BASE_PATH='/usr/bin:/bin:/usr/sbin:/sbin'
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/codex-shim-test.XXXXXX")"
trap 'rm -rf "$TMP_ROOT"' EXIT

FAIL=0

pass_case() {
  printf 'PASS  %s\n' "$1"
}

fail_case() {
  printf 'FAIL  %s\n  %s\n' "$1" "$2" >&2
  FAIL=1
}

assert_contains() {
  local label="$1" haystack="$2" needle="$3"
  if grep -Fq "$needle" <<< "$haystack"; then
    pass_case "$label"
  else
    fail_case "$label" "missing: $needle"
  fi
}

assert_not_contains() {
  local label="$1" haystack="$2" needle="$3"
  if grep -Fq "$needle" <<< "$haystack"; then
    fail_case "$label" "unexpected: $needle"
  else
    pass_case "$label"
  fi
}

assert_matches() {
  local label="$1" haystack="$2" pattern="$3"
  if grep -Eq "$pattern" <<< "$haystack"; then
    pass_case "$label"
  else
    fail_case "$label" "missing pattern: $pattern"
  fi
}

make_fake_codex() {
  local bin_dir="$1"
  mkdir -p "$bin_dir"
  cat > "$bin_dir/codex" <<'FAKE'
#!/usr/bin/env bash
printf 'FAKE_CODEX_REAL=1\n'
env | grep -E '^(OTEL_RESOURCE_ATTRIBUTES|TRACEPARENT|CLAUDE_CODE_SESSION_ID)=' || true
printf 'ARGS:'
for a in "$@"; do printf ' %s' "$a"; done
printf '\n'
FAKE
  chmod +x "$bin_dir/codex"
}

run_with_capture() {
  local stdout_file="$1"
  local stderr_file="$2"
  local status
  shift 2

  if "$@" >"$stdout_file" 2>"$stderr_file"; then
    return 0
  else
    status="$?"
    return "$status"
  fi
}

new_case_dir() {
  mktemp -d "$TMP_ROOT/case.XXXXXX"
}

# 1. Non-exec passthrough.
tmp="$(new_case_dir)"
make_fake_codex "$tmp/realbin"
stdout="$tmp/stdout"
stderr="$tmp/stderr"
if run_with_capture "$stdout" "$stderr" env -i PATH="$tmp/realbin:$BASE_PATH" bash "$ROOT/scripts/codex-shim.sh" --version; then
  out="$(<"$stdout")"
  assert_contains 'case1 non-exec passthrough args' "$out" 'ARGS: --version'
  assert_not_contains 'case1 non-exec passthrough no stamp' "$out" 'agent.session.id='
else
  fail_case 'case1 non-exec passthrough' "unexpected exit; stderr=$(<"$stderr")"
fi

# 2. exec, no Claude env.
tmp="$(new_case_dir)"
make_fake_codex "$tmp/realbin"
stdout="$tmp/stdout"
stderr="$tmp/stderr"
if run_with_capture "$stdout" "$stderr" env -i PATH="$tmp/realbin:$BASE_PATH" bash "$ROOT/scripts/codex-shim.sh" exec hello; then
  out="$(<"$stdout")"
  assert_matches 'case2 exec stamps codex-shim id' "$out" 'agent\.session\.id=codex-shim-[0-9a-f]{8}'
  assert_contains 'case2 exec stamps agent kind' "$out" 'agent.kind=codex_exec'
  assert_not_contains 'case2 exec no parent session' "$out" 'agent.parent.session.id='
  assert_not_contains 'case2 exec no parent span' "$out" 'agent.parent.span.id='
else
  fail_case 'case2 exec no Claude env' "unexpected exit; stderr=$(<"$stderr")"
fi

# 3. exec with full Claude env.
tmp="$(new_case_dir)"
make_fake_codex "$tmp/realbin"
stdout="$tmp/stdout"
stderr="$tmp/stderr"
traceparent='00-0123456789abcdef0123456789abcdef-fedcba9876543210-01'
session_id='claude-sess-voi-390'
if run_with_capture "$stdout" "$stderr" env -i PATH="$tmp/realbin:$BASE_PATH" TRACEPARENT="$traceparent" CLAUDE_CODE_SESSION_ID="$session_id" bash "$ROOT/scripts/codex-shim.sh" exec hello; then
  out="$(<"$stdout")"
  assert_matches 'case3 full env stamps codex-shim id' "$out" 'agent\.session\.id=codex-shim-[0-9a-f]{8}'
  assert_contains 'case3 full env stamps kind' "$out" 'agent.kind=codex_exec'
  assert_contains 'case3 full env stamps parent session' "$out" "agent.parent.session.id=$session_id"
  assert_contains 'case3 full env stamps parent span' "$out" 'agent.parent.span.id=fedcba9876543210'
else
  fail_case 'case3 exec with full Claude env' "unexpected exit; stderr=$(<"$stderr")"
fi

# 4. Already stamped.
tmp="$(new_case_dir)"
make_fake_codex "$tmp/realbin"
stdout="$tmp/stdout"
stderr="$tmp/stderr"
already_attrs='agent.session.id=voi-352-r1,agent.kind=codex_exec'
if run_with_capture "$stdout" "$stderr" env -i PATH="$tmp/realbin:$BASE_PATH" OTEL_RESOURCE_ATTRIBUTES="$already_attrs" bash "$ROOT/scripts/codex-shim.sh" exec hello; then
  out="$(<"$stdout")"
  assert_contains 'case4 already stamped unchanged' "$out" "OTEL_RESOURCE_ATTRIBUTES=$already_attrs"
  assert_not_contains 'case4 already stamped no new id' "$out" 'codex-shim-'
  assert_not_contains 'case4 already stamped no parent keys' "$out" 'agent.parent.'
else
  fail_case 'case4 already stamped' "unexpected exit; stderr=$(<"$stderr")"
fi

# 5. Self-detection.
tmp="$(new_case_dir)"
mkdir -p "$tmp/d1" "$tmp/d2"
cp "$ROOT/scripts/codex-shim.sh" "$tmp/d1/codex"
cp "$ROOT/scripts/codex-otel-attrs.sh" "$tmp/d1/codex-otel-attrs.sh"
chmod +x "$tmp/d1/codex"
make_fake_codex "$tmp/d2"
stdout="$tmp/stdout"
stderr="$tmp/stderr"
if run_with_capture "$stdout" "$stderr" env -i PATH="$tmp/d1:$tmp/d2:$BASE_PATH" bash "$tmp/d1/codex" exec hello; then
  out="$(<"$stdout")"
  assert_contains 'case5 self-detection reaches real codex' "$out" 'FAKE_CODEX_REAL=1'
else
  fail_case 'case5 self-detection' "unexpected exit; stderr=$(<"$stderr")"
fi

# 6. Real codex missing.
tmp="$(new_case_dir)"
mkdir -p "$tmp/empty"
stdout="$tmp/stdout"
stderr="$tmp/stderr"
if run_with_capture "$stdout" "$stderr" env -i PATH="$tmp/empty" /bin/bash "$ROOT/scripts/codex-shim.sh" exec hello; then
  fail_case 'case6 real codex missing' 'expected exit 127, got 0'
else
  status="$?"
  err="$(<"$stderr")"
  if [[ "$status" -eq 127 ]]; then
    pass_case 'case6 real codex missing exit 127'
  else
    fail_case 'case6 real codex missing exit 127' "got exit $status"
  fi
  assert_contains 'case6 real codex missing stderr' "$err" 'real codex not found'
fi

# 7a. Subcommand detection: -c value before exec stamps.
tmp="$(new_case_dir)"
make_fake_codex "$tmp/realbin"
stdout="$tmp/stdout"
stderr="$tmp/stderr"
if run_with_capture "$stdout" "$stderr" env -i PATH="$tmp/realbin:$BASE_PATH" bash "$ROOT/scripts/codex-shim.sh" -c model=foo exec hello; then
  assert_matches 'case7a -c before exec stamps' "$(<"$stdout")" 'agent\.session\.id=codex-shim-[0-9a-f]{8}'
else
  fail_case 'case7a -c before exec' "unexpected exit; stderr=$(<"$stderr")"
fi

# 7b. Subcommand detection: long flag before exec stamps.
tmp="$(new_case_dir)"
make_fake_codex "$tmp/realbin"
stdout="$tmp/stdout"
stderr="$tmp/stderr"
if run_with_capture "$stdout" "$stderr" env -i PATH="$tmp/realbin:$BASE_PATH" bash "$ROOT/scripts/codex-shim.sh" --strict-config exec hello; then
  assert_matches 'case7b long flag before exec stamps' "$(<"$stdout")" 'agent\.session\.id=codex-shim-[0-9a-f]{8}'
else
  fail_case 'case7b long flag before exec' "unexpected exit; stderr=$(<"$stderr")"
fi

# 7c. Subcommand detection: chat passthrough.
tmp="$(new_case_dir)"
make_fake_codex "$tmp/realbin"
stdout="$tmp/stdout"
stderr="$tmp/stderr"
if run_with_capture "$stdout" "$stderr" env -i PATH="$tmp/realbin:$BASE_PATH" bash "$ROOT/scripts/codex-shim.sh" chat hello; then
  assert_not_contains 'case7c chat passthrough no stamp' "$(<"$stdout")" 'agent.session.id='
else
  fail_case 'case7c chat passthrough' "unexpected exit; stderr=$(<"$stderr")"
fi

# 7d. Subcommand detection: exec --help stamps.
tmp="$(new_case_dir)"
make_fake_codex "$tmp/realbin"
stdout="$tmp/stdout"
stderr="$tmp/stderr"
if run_with_capture "$stdout" "$stderr" env -i PATH="$tmp/realbin:$BASE_PATH" bash "$ROOT/scripts/codex-shim.sh" exec --help; then
  assert_matches 'case7d exec help stamps' "$(<"$stdout")" 'agent\.session\.id=codex-shim-[0-9a-f]{8}'
else
  fail_case 'case7d exec help' "unexpected exit; stderr=$(<"$stderr")"
fi

# 7e. Subcommand detection: -p value before exec stamps.
tmp="$(new_case_dir)"
make_fake_codex "$tmp/realbin"
stdout="$tmp/stdout"
stderr="$tmp/stderr"
if run_with_capture "$stdout" "$stderr" env -i PATH="$tmp/realbin:$BASE_PATH" bash "$ROOT/scripts/codex-shim.sh" -p production exec hello; then
  assert_matches 'case7e -p before exec stamps' "$(<"$stdout")" 'agent\.session\.id=codex-shim-[0-9a-f]{8}'
else
  fail_case 'case7e -p before exec' "unexpected exit; stderr=$(<"$stderr")"
fi

# 7f. Subcommand detection: --profile value before exec stamps.
tmp="$(new_case_dir)"
make_fake_codex "$tmp/realbin"
stdout="$tmp/stdout"
stderr="$tmp/stderr"
if run_with_capture "$stdout" "$stderr" env -i PATH="$tmp/realbin:$BASE_PATH" bash "$ROOT/scripts/codex-shim.sh" --profile production exec hello; then
  assert_matches 'case7f --profile before exec stamps' "$(<"$stdout")" 'agent\.session\.id=codex-shim-[0-9a-f]{8}'
else
  fail_case 'case7f --profile before exec' "unexpected exit; stderr=$(<"$stderr")"
fi

# 7g. Subcommand detection: -m value before exec stamps.
tmp="$(new_case_dir)"
make_fake_codex "$tmp/realbin"
stdout="$tmp/stdout"
stderr="$tmp/stderr"
if run_with_capture "$stdout" "$stderr" env -i PATH="$tmp/realbin:$BASE_PATH" bash "$ROOT/scripts/codex-shim.sh" -m gpt-5.4 exec hello; then
  assert_matches 'case7g -m before exec stamps' "$(<"$stdout")" 'agent\.session\.id=codex-shim-[0-9a-f]{8}'
else
  fail_case 'case7g -m before exec' "unexpected exit; stderr=$(<"$stderr")"
fi

# 7h. Subcommand detection: --model value before exec stamps.
tmp="$(new_case_dir)"
make_fake_codex "$tmp/realbin"
stdout="$tmp/stdout"
stderr="$tmp/stderr"
if run_with_capture "$stdout" "$stderr" env -i PATH="$tmp/realbin:$BASE_PATH" bash "$ROOT/scripts/codex-shim.sh" --model gpt-5.4 exec hello; then
  assert_matches 'case7h --model before exec stamps' "$(<"$stdout")" 'agent\.session\.id=codex-shim-[0-9a-f]{8}'
else
  fail_case 'case7h --model before exec' "unexpected exit; stderr=$(<"$stderr")"
fi

# 7i. Subcommand detection: chained value-bearing flags before exec stamp.
tmp="$(new_case_dir)"
make_fake_codex "$tmp/realbin"
stdout="$tmp/stdout"
stderr="$tmp/stderr"
if run_with_capture "$stdout" "$stderr" env -i PATH="$tmp/realbin:$BASE_PATH" bash "$ROOT/scripts/codex-shim.sh" -p production -m gpt-5.4 exec hello; then
  assert_matches 'case7i profile and model before exec stamp' "$(<"$stdout")" 'agent\.session\.id=codex-shim-[0-9a-f]{8}'
else
  fail_case 'case7i profile and model before exec' "unexpected exit; stderr=$(<"$stderr")"
fi

# 8. Diagnostics.
tmp="$(new_case_dir)"
make_fake_codex "$tmp/realbin"
stdout="$tmp/stdout"
stderr="$tmp/stderr"
if run_with_capture "$stdout" "$stderr" env -i PATH="$tmp/realbin:$BASE_PATH" CODEX_SHIM_DEBUG=1 bash "$ROOT/scripts/codex-shim.sh" exec hello; then
  debug_lines="$(grep -c '^codex-shim: real=' "$stderr" || true)"
  if [[ "$debug_lines" -eq 1 ]]; then
    pass_case 'case8 diagnostics single line'
  else
    fail_case 'case8 diagnostics single line' "got $debug_lines lines; stderr=$(<"$stderr")"
  fi
else
  fail_case 'case8 diagnostics enabled' "unexpected exit; stderr=$(<"$stderr")"
fi
stdout="$tmp/stdout2"
stderr="$tmp/stderr2"
if run_with_capture "$stdout" "$stderr" env -i PATH="$tmp/realbin:$BASE_PATH" bash "$ROOT/scripts/codex-shim.sh" exec hello; then
  assert_not_contains 'case8 diagnostics disabled silent' "$(<"$stderr")" 'codex-shim:'
else
  fail_case 'case8 diagnostics disabled' "unexpected exit; stderr=$(<"$stderr")"
fi

# 9. Fresh install.
tmp="$(new_case_dir)"
install_dir="$tmp/bin"
make_fake_codex "$tmp/realbin"
mkdir -p "$install_dir"
stdout="$tmp/stdout"
stderr="$tmp/stderr"
if run_with_capture "$stdout" "$stderr" env -i PATH="$install_dir:$tmp/realbin:$BASE_PATH" INSTALL_DIR="$install_dir" HOME="$tmp/home" bash "$ROOT/scripts/install-codex-shim.sh"; then
  codex_target="$(readlink "$install_dir/codex")"
  attrs_target="$(readlink "$install_dir/codex-otel-attrs.sh")"
  assert_contains 'case9 fresh install codex symlink' "$codex_target" "$ROOT/scripts/codex-shim.sh"
  assert_contains 'case9 fresh install attrs symlink' "$attrs_target" "$ROOT/scripts/codex-otel-attrs.sh"
  resolved="$(PATH="$install_dir:$tmp/realbin:$BASE_PATH" command -v codex)"
  assert_contains 'case9 fresh install command resolves' "$resolved" "$install_dir/codex"
else
  fail_case 'case9 fresh install' "unexpected exit; stderr=$(<"$stderr")"
fi

# 10. Re-install idempotent.
tmp="$(new_case_dir)"
install_dir="$tmp/bin"
make_fake_codex "$tmp/realbin"
mkdir -p "$install_dir"
stdout="$tmp/stdout"
stderr="$tmp/stderr"
if ! run_with_capture "$stdout" "$stderr" env -i PATH="$install_dir:$tmp/realbin:$BASE_PATH" INSTALL_DIR="$install_dir" HOME="$tmp/home" bash "$ROOT/scripts/install-codex-shim.sh"; then
  fail_case 'case10 reinstall setup' "first install failed; stderr=$(<"$stderr")"
fi
stdout="$tmp/stdout2"
stderr="$tmp/stderr2"
if run_with_capture "$stdout" "$stderr" env -i PATH="$install_dir:$tmp/realbin:$BASE_PATH" INSTALL_DIR="$install_dir" HOME="$tmp/home" bash "$ROOT/scripts/install-codex-shim.sh"; then
  assert_contains 'case10 reinstall idempotent' "$(<"$stdout")" 'already installed'
else
  fail_case 'case10 reinstall idempotent' "unexpected exit; stderr=$(<"$stderr")"
fi

# 11. PATH not first.
tmp="$(new_case_dir)"
install_dir="$tmp/bin"
make_fake_codex "$tmp/realbin"
mkdir -p "$install_dir"
stdout="$tmp/stdout"
stderr="$tmp/stderr"
if run_with_capture "$stdout" "$stderr" env -i PATH="$tmp/realbin:$install_dir:$BASE_PATH" INSTALL_DIR="$install_dir" HOME="$tmp/home" bash "$ROOT/scripts/install-codex-shim.sh"; then
  fail_case 'case11 path not first' 'expected installer refusal, got 0'
else
  assert_contains 'case11 path not first error' "$(<"$stderr")" 'must come before'
fi

# 12. Existing non-symlink at target.
tmp="$(new_case_dir)"
install_dir="$tmp/bin"
make_fake_codex "$tmp/realbin"
mkdir -p "$install_dir"
printf 'not-a-symlink\n' > "$install_dir/codex"
stdout="$tmp/stdout"
stderr="$tmp/stderr"
if run_with_capture "$stdout" "$stderr" env -i PATH="$install_dir:$tmp/realbin:$BASE_PATH" INSTALL_DIR="$install_dir" HOME="$tmp/home" bash "$ROOT/scripts/install-codex-shim.sh"; then
  fail_case 'case12 existing non-symlink' 'expected installer refusal, got 0'
else
  assert_contains 'case12 existing non-symlink error' "$(<"$stderr")" 'not the expected symlink'
  if [[ "$(<"$install_dir/codex")" == 'not-a-symlink' ]]; then
    pass_case 'case12 existing non-symlink preserved'
  else
    fail_case 'case12 existing non-symlink preserved' 'regular file was overwritten'
  fi
fi

# 13. Existing non-symlink at attrs target does not partially install codex.
tmp="$(new_case_dir)"
install_dir="$tmp/bin"
make_fake_codex "$tmp/realbin"
mkdir -p "$install_dir"
printf 'not-a-symlink\n' > "$install_dir/codex-otel-attrs.sh"
stdout="$tmp/stdout"
stderr="$tmp/stderr"
if run_with_capture "$stdout" "$stderr" env -i PATH="$install_dir:$tmp/realbin:$BASE_PATH" INSTALL_DIR="$install_dir" HOME="$tmp/home" bash "$ROOT/scripts/install-codex-shim.sh"; then
  fail_case 'case13 existing attrs non-symlink' 'expected installer refusal, got 0'
else
  assert_contains 'case13 existing attrs non-symlink filename' "$(<"$stderr")" 'codex-otel-attrs.sh'
  assert_contains 'case13 existing attrs non-symlink error' "$(<"$stderr")" 'not the expected symlink'
  if [[ ! -e "$install_dir/codex" ]]; then
    pass_case 'case13 codex symlink not created'
  else
    fail_case 'case13 codex symlink not created' 'codex link was created before attrs refusal'
  fi
  if [[ "$(<"$install_dir/codex-otel-attrs.sh")" == 'not-a-symlink' ]]; then
    pass_case 'case13 existing attrs non-symlink preserved'
  else
    fail_case 'case13 existing attrs non-symlink preserved' 'regular file was overwritten'
  fi
fi

# 14. Existing wrong symlink at attrs target does not partially install codex.
tmp="$(new_case_dir)"
install_dir="$tmp/bin"
make_fake_codex "$tmp/realbin"
mkdir -p "$install_dir"
wrong_attrs_target="$tmp/wrong-attrs.sh"
ln -s "$wrong_attrs_target" "$install_dir/codex-otel-attrs.sh"
stdout="$tmp/stdout"
stderr="$tmp/stderr"
if run_with_capture "$stdout" "$stderr" env -i PATH="$install_dir:$tmp/realbin:$BASE_PATH" INSTALL_DIR="$install_dir" HOME="$tmp/home" bash "$ROOT/scripts/install-codex-shim.sh"; then
  fail_case 'case14 existing attrs wrong symlink' 'expected installer refusal, got 0'
else
  assert_contains 'case14 existing attrs wrong symlink filename' "$(<"$stderr")" 'codex-otel-attrs.sh'
  assert_contains 'case14 existing attrs wrong symlink expected' "$(<"$stderr")" 'expected'
  if [[ ! -e "$install_dir/codex" ]]; then
    pass_case 'case14 codex symlink not created'
  else
    fail_case 'case14 codex symlink not created' 'codex link was created before attrs refusal'
  fi
  if [[ "$(readlink "$install_dir/codex-otel-attrs.sh")" == "$wrong_attrs_target" ]]; then
    pass_case 'case14 existing attrs wrong symlink preserved'
  else
    fail_case 'case14 existing attrs wrong symlink preserved' 'wrong symlink target was overwritten'
  fi
fi

if [[ "$FAIL" -ne 0 ]]; then
  printf '\nTEST FAILURES\n' >&2
  exit 1
fi

printf '\nAll cases passed.\n'
