#!/usr/bin/env bash
# tools/fast-gate.test.sh — self-test suite for tools/fast-gate.sh
#
# Asserts selection, fail-loud behaviour, exemptions, and output contract compliance.
set -uo pipefail

HERE=$(cd "$(dirname "$(readlink -f "$0")")" && pwd)
PASS=0; FAIL=0; FAILED=()

ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); FAILED+=("$1"); printf '  FAIL %s\n      %s\n' "$1" "${2:-}"; }
has()   { grep -qF -- "$2" <<<"$1" && ok "$3" || bad "$3" "expected to find: $2"; }
hasnt() { grep -qF -- "$2" <<<"$1" && bad "$3" "expected NOT to find: $2" || ok "$3"; }

ROOT=$(mktemp -d); trap 'rm -rf "$ROOT"' EXIT
mkdir -p "$ROOT/repo"
cp -r "$HERE" "$ROOT/repo/tools"
GATE="$ROOT/repo/tools/fast-gate.sh"

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

echo "fast-gate: selection and fail-loud behaviour"

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

echo
if [ "$FAIL" -eq 0 ]; then
  echo "fast-gate tests: $PASS passed, 0 failed"
  exit 0
fi
echo "fast-gate tests: $PASS passed, $FAIL FAILED"
for t in "${FAILED[@]}"; do echo "  FAILED: $t"; done
exit 1
