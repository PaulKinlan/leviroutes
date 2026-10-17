#!/usr/bin/env bash
# tools/fast-gate.test.sh — self-test suite for leviroutes gate tooling:
# covers tools/fast-gate.sh, tools/check-cmd.sh, tools/check.conf, and tools/full-gate.sh.
#
# Asserts selection, fail-loud behaviour, exemptions, config validation, and full-gate orchestration.
set -uo pipefail

HERE=$(cd "$(dirname "$(readlink -f "$0")")" && pwd)
PASS=0; FAIL=0; FAILED=()

ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); FAILED+=("$1"); printf '  FAIL %s\n      %s\n' "$1" "${2:-}"; }
has()   { grep -qF -- "$2" <<<"$1" && ok "$3" || bad "$3" "expected to find: $2"; }
hasnt() { grep -qF -- "$2" <<<"$1" && bad "$3" "expected NOT to find: $2" || ok "$3"; }

ROOT=$(mktemp -d); trap 'rm -rf "$ROOT"' EXIT
# The throwaway repo is a REAL git repository: tools/check-cmd.sh --install exists to
# stamp CHECK_FAST_CONTRACT_OWNER from `git rev-parse --git-common-dir` of this checkout,
# and that branch is unreachable in a bare directory (leviroutes-81z). Global/system git
# config is pinned so no assertion here depends on the machinery of the host.
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
mkdir -p "$ROOT/repo"
git -C "$ROOT/repo" init -q
cp -r "$HERE" "$ROOT/repo/tools"
GATE="$ROOT/repo/tools/fast-gate.sh"
CHECK_CMD_SCRIPT="$ROOT/repo/tools/check-cmd.sh"
FULL_GATE_SCRIPT="$ROOT/repo/tools/full-gate.sh"

mkdir -p "$ROOT/repo/spec" "$ROOT/repo/src"
touch "$ROOT/repo/src/routes.js"
touch "$ROOT/repo/spec/middleware.spec.mjs"
touch "$ROOT/repo/spec/routeexecution.spec.mjs"
touch "$ROOT/repo/spec/routemanagement.spec.mjs"
touch "$ROOT/repo/spec/routeparsing.spec.mjs"
touch "$ROOT/repo/spec/routesframework.spec.mjs"

# Stub runner: records invocations, exits 0 (or 1 if STUB_FAIL=1)
cat > "$ROOT/runner" <<'STUB'
#!/usr/bin/env bash
echo "$1" >> "$RUN_LOG"
[ "${STUB_FAIL:-0}" = 1 ] && exit 1
exit 0
STUB
chmod +x "$ROOT/runner"

export FAST_GATE_RUNNER="$ROOT/runner" RUN_LOG="$ROOT/run.log"

run() { ( cd "$ROOT/repo" && FAST_GATE_RUNNER="$FAST_GATE_RUNNER" RUN_LOG="$RUN_LOG" STUB_FAIL="${STUB_FAIL:-0}" bash "$GATE" "$@" 2>&1 ); }
run_rc() { ( cd "$ROOT/repo" && FAST_GATE_RUNNER="$FAST_GATE_RUNNER" RUN_LOG="$RUN_LOG" STUB_FAIL="${STUB_FAIL:-0}" bash "$GATE" "$@" >/dev/null 2>&1 ); echo $?; }

echo "=== Section 1: fast-gate.sh selection and fail-loud behaviour ==="

# 1. Mapped source file selects all 5 specs and executes them
rm -f "$RUN_LOG"
out=$(run --changed src/routes.js)
rc=$(run_rc --changed src/routes.js)
has "$out" "fast-gate: running: spec/middleware.spec.mjs" "1a mapped source selects middleware spec"
has "$out" "fast-gate: running: spec/routeexecution.spec.mjs" "1b ... and routeexecution spec"
has "$out" "fast-gate: running: spec/routemanagement.spec.mjs" "1c ... and routemanagement spec"
has "$out" "fast-gate: running: spec/routeparsing.spec.mjs" "1d ... and routeparsing spec"
has "$out" "fast-gate: running: spec/routesframework.spec.mjs" "1e ... and routesframework spec"
has "$out" "fast-gate: passed: spec/middleware.spec.mjs" "1f passing suite is reported with positive marker"
has "$out" "fast-gate: PASS (5 suite(s), 1 changed file(s))" "1g terminal PASS line matches producer contract"
[ "$rc" = 0 ] && ok "1h exit 0 on success" || bad "1h expected exit 0" "got $rc"

# 2. Unmapped changed file fails loudly
out=$(run --changed src/unknown.js)
rc=$(run_rc --changed src/unknown.js)
has "$out" "fast-gate: unmapped: src/unknown.js" "2a unmapped changed file emitted with marker"
[ "$rc" != 0 ] && ok "2b unmapped file exits non-zero" || bad "2b expected non-zero exit" "got $rc"
hasnt "$out" "fast-gate: passed:" "2c no passed marker emitted on unmapped change"

# 3. Changed spec file maps to itself
rm -f "$RUN_LOG"
out=$(run --changed spec/middleware.spec.mjs)
rc=$(run_rc --changed spec/middleware.spec.mjs)
has "$out" "fast-gate: running: spec/middleware.spec.mjs" "3a changed spec file maps to itself"
hasnt "$out" "fast-gate: running: spec/routeparsing.spec.mjs" "3b does not select unrelated specs"
has "$out" "fast-gate: PASS (1 suite(s), 1 changed file(s))" "3c terminal PASS line for single spec"
[ "$rc" = 0 ] && ok "3d exit 0 for spec change" || bad "3d expected exit 0" "got $rc"

# 4. Exempt path runs nothing and exits 0
out=$(run --changed README.md)
rc=$(run_rc --changed README.md)
has "$out" "fast-gate: no suites affected by 1 changed file(s) (1 exempt)" "4a exempt path selects nothing"
[ "$rc" = 0 ] && ok "4b exempt path exits 0" || bad "4b expected exit 0" "got $rc"
hasnt "$out" "fast-gate: unmapped:" "4c exempt path is not reported unmapped"

# 5. --list prints selection and runs nothing
rm -f "$RUN_LOG"
out=$(run --list --changed src/routes.js)
has "$out" "spec/middleware.spec.mjs" "5a --list prints selected suite"
[ ! -s "$RUN_LOG" ] && ok "5b --list runs no suites" || bad "5b --list ran suites" "$(cat "$RUN_LOG")"

# 6. Failing suite fails the gate
STUB_FAIL=1
out=$(run --changed spec/middleware.spec.mjs)
rc=$(run_rc --changed spec/middleware.spec.mjs)
has "$out" "fast-gate: failed: spec/middleware.spec.mjs" "6a failing suite is reported as failed"
hasnt "$out" "fast-gate: passed: spec/middleware.spec.mjs" "6b failing suite is not reported as passed"
[ "$rc" != 0 ] && ok "6c failing suite exits non-zero" || bad "6c expected non-zero exit" "got $rc"
STUB_FAIL=0

# 7. Package.json changes select package validation
rm -f "$RUN_LOG"
out=$(run --list --changed package.json)
has "$out" "tools/verify-package.mjs" "7a package.json selects tools/verify-package.mjs"
has "$out" "spec/middleware.spec.mjs" "7b package.json also selects test specs"

# 8. Stale map entry fails loudly
cp "$ROOT/repo/tools/suite-map.tsv" "$ROOT/map.bak"
printf 'src/routes.js\tspec/nonexistent.spec.mjs\n' > "$ROOT/repo/tools/suite-map.tsv"
out=$(run --changed src/routes.js)
rc=$(run_rc --changed src/routes.js)
has "$out" "fast-gate: missing: spec/nonexistent.spec.mjs" "8a stale map entry is named"
[ "$rc" != 0 ] && ok "8b stale map entry exits non-zero" || bad "8b expected non-zero exit" "got $rc"
cp "$ROOT/map.bak" "$ROOT/repo/tools/suite-map.tsv"

# 9. Missing map file refuses to guess
mv "$ROOT/repo/tools/suite-map.tsv" "$ROOT/map.hidden"
out=$(run --changed src/routes.js)
rc=$(run_rc --changed src/routes.js)
has "$out" "the map IS the gate" "9a missing map refuses to guess"
[ "$rc" != 0 ] && ok "9b missing map exits non-zero" || bad "9b expected non-zero exit" "got $rc"
mv "$ROOT/map.hidden" "$ROOT/repo/tools/suite-map.tsv"

echo "=== Section 2: check-cmd.sh and check.conf validation ==="

TEST_HOME="$ROOT/home"
mkdir -p "$TEST_HOME"

# 10. check-cmd.sh outputs expected field values from tracked check.conf (isolated from any installed conf)
cmd_val=$(HOME="$TEST_HOME" FLEET_CHECK_CONF="$ROOT/no-target.conf" bash "$CHECK_CMD_SCRIPT" CHECK_CMD)
fast_cmd_val=$(HOME="$TEST_HOME" FLEET_CHECK_CONF="$ROOT/no-target.conf" bash "$CHECK_CMD_SCRIPT" CHECK_FAST_CMD)
[ "$cmd_val" = "bash tools/full-gate.sh" ] && ok "10a check-cmd.sh prints CHECK_CMD correctly" || bad "10a CHECK_CMD wrong" "$cmd_val"
[ "$fast_cmd_val" = "bash tools/fast-gate.sh" ] && ok "10b check-cmd.sh prints CHECK_FAST_CMD correctly" || bad "10b CHECK_FAST_CMD wrong" "$fast_cmd_val"

# 11. check-cmd.sh --check verifies matching configuration
TEST_TARGET="$ROOT/installed-check.conf"
cp "$ROOT/repo/tools/check.conf" "$TEST_TARGET"
check_rc=0
HOME="$TEST_HOME" FLEET_CHECK_CONF="$TEST_TARGET" bash "$CHECK_CMD_SCRIPT" --check >/dev/null 2>&1 || check_rc=$?
[ "$check_rc" = 0 ] && ok "11 check-cmd.sh --check passes on matching configuration" || bad "11 expected exit 0" "got $check_rc"

# 12. check-cmd.sh --check exits 3 when target config is missing
rm -f "$TEST_TARGET"
missing_rc=0
HOME="$TEST_HOME" FLEET_CHECK_CONF="$TEST_TARGET" bash "$CHECK_CMD_SCRIPT" --check >/dev/null 2>&1 || missing_rc=$?
[ "$missing_rc" = 3 ] && ok "12 check-cmd.sh --check exits 3 on missing configuration" || bad "12 expected exit 3" "got $missing_rc"

# 13. check-cmd.sh --check exits 1 when target config differs
echo 'CHECK_CMD="bogus"' > "$TEST_TARGET"
diff_rc=0
HOME="$TEST_HOME" FLEET_CHECK_CONF="$TEST_TARGET" bash "$CHECK_CMD_SCRIPT" --check >/dev/null 2>&1 || diff_rc=$?
[ "$diff_rc" = 1 ] && ok "13 check-cmd.sh --check exits 1 on configuration drift" || bad "13 expected exit 1" "got $diff_rc"

# 14. check-cmd.sh --install copies tracked config to target in isolated home, stamping
# the owner from THIS checkout. The owner line is the whole reason the tracked check.conf
# is not copied verbatim: fleet-check scope_contract_for() compares it against the
# consumer's git-common-dir and, on a mismatch, silently unsets the fast-gate contract
# (PASS regex, no-work policy, coverage requirement). So it is asserted, not masked out.
rm -f "$TEST_TARGET"
install_rc=0
HOME="$TEST_HOME" FLEET_CHECK_CONF="$TEST_TARGET" bash "$CHECK_CMD_SCRIPT" --install >/dev/null 2>&1 || install_rc=$?
[ "$install_rc" = 0 ] && [ -f "$TEST_TARGET" ] \
  && ok "14a check-cmd.sh --install writes the target configuration" \
  || bad "14a check-cmd.sh --install failed" "rc=$install_rc"

expected_owner=$(git -C "$ROOT/repo" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
installed_owner=$(HOME="$TEST_HOME" FLEET_CHECK_CONF="$TEST_TARGET" bash "$CHECK_CMD_SCRIPT" CHECK_FAST_CONTRACT_OWNER 2>/dev/null)
[ -n "$expected_owner" ] && [ "$installed_owner" = "$expected_owner" ] \
  && ok "14b --install stamps CHECK_FAST_CONTRACT_OWNER with this checkout's git-common-dir" \
  || bad "14b CHECK_FAST_CONTRACT_OWNER was not stamped from this checkout" "expected '$expected_owner', got '$installed_owner'"

if cmp -s <(sed 's|^CHECK_FAST_CONTRACT_OWNER=.*||' "$ROOT/repo/tools/check.conf") <(sed 's|^CHECK_FAST_CONTRACT_OWNER=.*||' "$TEST_TARGET"); then
  ok "14c --install preserves every other setting verbatim"
else
  bad "14c installed configuration differs from the tracked defaults outside the owner line" \
      "$(diff -u <(sed 's|^CHECK_FAST_CONTRACT_OWNER=.*||' "$ROOT/repo/tools/check.conf") <(sed 's|^CHECK_FAST_CONTRACT_OWNER=.*||' "$TEST_TARGET") | head -20)"
fi

# 14d. The other half of the branch: outside a git checkout --install copies the tracked
# config unchanged instead of inventing an owner.
NOGIT_REPO="$ROOT/nogit-repo"; mkdir -p "$NOGIT_REPO"; cp -r "$ROOT/repo/tools" "$NOGIT_REPO/tools"
NOGIT_TARGET="$ROOT/nogit-check.conf"
HOME="$TEST_HOME" FLEET_CHECK_CONF="$NOGIT_TARGET" bash "$NOGIT_REPO/tools/check-cmd.sh" --install >/dev/null 2>&1 || true
if cmp -s "$NOGIT_REPO/tools/check.conf" "$NOGIT_TARGET"; then
  ok "14d --install outside a git checkout copies the tracked config verbatim"
else
  bad "14d non-git --install changed the configuration" \
      "$(diff -u "$NOGIT_REPO/tools/check.conf" "$NOGIT_TARGET" | head -20)"
fi

echo "=== Section 3: full-gate.sh execution and step orchestration ==="

# 15. full-gate.sh runs all steps in throwaway repo with stubs and passes
mkdir -p "$ROOT/repo/tools"
cat > "$ROOT/repo/tools/verify-package.mjs" <<'STUB_VP'
console.log("verify-package: PASS");
process.exit(0);
STUB_VP

# Stub package.json with npm test script in throwaway repo
cat > "$ROOT/repo/package.json" <<'STUB_PKG'
{
  "name": "test-repo",
  "scripts": {
    "test": "echo 'all specs passed'"
  }
}
STUB_PKG

full_out=$(cd "$ROOT/repo" && SKIP_GATE_SELF_TESTS=1 bash "$FULL_GATE_SCRIPT" 2>&1)
full_rc=$?
has "$full_out" "package and build verification:" "15a full-gate runs package verification step"
has "$full_out" "full test suite:" "15b full-gate runs full test suite step"
has "$full_out" "full gate: PASS" "15c full-gate terminal PASS marker"
has "$full_out" "gate-tier: not-applicable" "15d full-gate reports tier not-applicable"
[ "$full_rc" = 0 ] && ok "15e full-gate exits 0 on success" || bad "15e expected exit 0" "got $full_rc"

# 16. full-gate.sh fails loudly if a step fails
cat > "$ROOT/repo/tools/verify-package.mjs" <<'STUB_FAIL'
console.error("verify-package: broken export");
process.exit(1);
STUB_FAIL
fail_out=$(cd "$ROOT/repo" && SKIP_GATE_SELF_TESTS=1 bash "$FULL_GATE_SCRIPT" 2>&1 || true)
has "$fail_out" "full gate: FAIL" "16a full-gate reports FAIL when a step fails"

echo
if [ "$FAIL" -eq 0 ]; then
  echo "gate tooling tests: $PASS passed, 0 failed"
  exit 0
fi
echo "gate tooling tests: $PASS passed, $FAIL FAILED"
for t in "${FAILED[@]}"; do echo "  FAILED: $t"; done
exit 1
