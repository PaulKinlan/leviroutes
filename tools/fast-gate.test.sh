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
touch "$ROOT/repo/spec/fixtureisolation.spec.mjs"
touch "$ROOT/repo/spec/urlpatternmatcher.spec.mjs"

# Materialise a file for every row in the map under test, so the map's own dead-row check
# (leviroutes-62g) sees a tree where each row still describes something: <path> becomes that
# file, <dir>/** becomes a file inside that directory. Existing fixtures (the tools/ scripts
# above all, the specs below) are never overwritten. Keys the fixture does not need - but
# must not claim to be dead - are created empty.
while IFS=$'\t' read -r pat rest; do
  case $pat in ''|\#*|\!*) continue ;; esac
  case $pat in
    *'/**')
      dead_fix_dir="$ROOT/repo/${pat%'/**'}"
      mkdir -p "$dead_fix_dir"
      [ -e "$dead_fix_dir/fixture.mjs" ] || : > "$dead_fix_dir/fixture.mjs"
      ;;
    *)
      if [ ! -e "$ROOT/repo/$pat" ]; then
        mkdir -p "$ROOT/repo/$(dirname "$pat")"
        : > "$ROOT/repo/$pat"
      fi
      ;;
  esac
done < "$HERE/suite-map.tsv"

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

# 1. Mapped source file selects all 8 specs and executes them
rm -f "$RUN_LOG"
out=$(run --changed src/routes.js)
rc=$(run_rc --changed src/routes.js)
has "$out" "fast-gate: running: spec/middleware.spec.mjs" "1a mapped source selects middleware spec"
has "$out" "fast-gate: running: spec/routeexecution.spec.mjs" "1b ... and routeexecution spec"
has "$out" "fast-gate: running: spec/routemanagement.spec.mjs" "1c ... and routemanagement spec"
has "$out" "fast-gate: running: spec/routeparsing.spec.mjs" "1d ... and routeparsing spec"
has "$out" "fast-gate: running: spec/routesframework.spec.mjs" "1e ... and routesframework spec"
has "$out" "fast-gate: running: spec/fixtureisolation.spec.mjs" "1f ... and the fixture-isolation spec"
has "$out" "fast-gate: running: spec/urlpatternmatcher.spec.mjs" "1g ... and the urlpattern matcher spec"
has "$out" "fast-gate: running: spec/serverdispatch.spec.mjs" "1g2 ... and the server dispatch spec"
has "$out" "fast-gate: passed: spec/middleware.spec.mjs" "1h passing suite is reported with positive marker"
has "$out" "fast-gate: PASS (8 suite(s), 1 changed file(s))" "1i terminal PASS line matches producer contract"
[ "$rc" = 0 ] && ok "1j exit 0 on success" || bad "1j expected exit 0" "got $rc"

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

# 9c. Every spec file in the checkout is selected by at least one map row. A spec that no
# row names only runs when it is itself changed, so a src/ change silently skips it
# (leviroutes-gr4: spec/fixtureisolation.spec.mjs was omitted exactly this way, and only the
# gate's coverage warning noticed). Reads the real checkout, not the throwaway repo.
REAL_ROOT=$(cd "$HERE/.." && pwd)
REAL_MAP="$REAL_ROOT/tools/suite-map.tsv"
if [ ! -f "$REAL_MAP" ]; then
  bad "9c cannot read the checkout's suite map" "$REAL_MAP"
else
  unselected=()
  for spec_file in "$REAL_ROOT"/spec/*.spec.mjs; do
    [ -e "$spec_file" ] || continue
    spec_name="spec/$(basename "$spec_file")"
    grep -vE '^(#|!|[[:space:]]*$)' "$REAL_MAP" | cut -f2- | tr -s '[:space:]' '\n' | grep -qxF -- "$spec_name" \
      || unselected+=("$spec_name")
  done
  if [ "${#unselected[@]}" -eq 0 ]; then
    ok "9c every spec file is selected by at least one suite-map row"
  else
    bad "9c spec files named in no suite-map row" "${unselected[*]}"
  fi
fi

# 9d. A map row whose path is gone fails loudly instead of selecting suites. A row that outlives
# its path is dead config: it turns a change under that path from 'unmapped' into a PASS with
# coverage that never ran (leviroutes-62g, from the leviroutes-n0a review, which deleted
# SpecRunner.html/lib/tests but re-mapped them to unrelated suites). The ghost paths below name
# nothing and are created by no fixture, so this stays a dead row as the map changes.
cp "$ROOT/repo/tools/suite-map.tsv" "$ROOT/map.bak"
printf 'retired-ghost/**\tspec/middleware.spec.mjs\n' >> "$ROOT/repo/tools/suite-map.tsv"
out=$(run --changed src/routes.js)
rc=$(run_rc --changed src/routes.js)
has "$out" "fast-gate: dead row: retired-ghost/**" "9d1 dead map row is named"
[ "$rc" != 0 ] && ok "9d2 dead map row exits non-zero" || bad "9d2 expected non-zero exit" "got $rc"
hasnt "$out" "fast-gate: PASS" "9d3 dead map row does not report PASS"

# ... and a literal path row is checked the same way (SpecRunner.html was the other half of 62g).
printf 'retired-ghost.js\ttools/fast-gate.test.sh\n' >> "$ROOT/repo/tools/suite-map.tsv"
out=$(run --list --changed src/routes.js)
rc=$(run_rc --list --changed src/routes.js)
has "$out" "fast-gate: dead row: retired-ghost.js" "9d4 dead literal row is named"
[ "$rc" != 0 ] && ok "9d5 dead literal row exits non-zero even for --list" || bad "9d5 expected non-zero exit" "got $rc"
cp "$ROOT/map.bak" "$ROOT/repo/tools/suite-map.tsv"

# 9e. The real map satisfies that rule today: the checkout's own rows all describe live paths.
# (Run against REAL_ROOT - the throwaway repo's fixture satisfies the rule by construction.)
out=$( cd "$REAL_ROOT" && bash "$REAL_ROOT/tools/fast-gate.sh" --list --changed src/routes.js 2>&1 )
rc=$?
[ "$rc" = 0 ] && ok "9e every row in the checkout's suite map names a path in the tree" \
  || bad "9e checkout suite map has a dead row" "$(grep -E 'dead row|FAIL' <<<"$out" | head -3)"

# 9f. The coverage contract is the fleet coverage checker's independent oracle, so a key for a
# deleted path is the same false green one layer up (62g: tests/*, lib/*, SpecRunner.html).
CONTRACT="$REAL_ROOT/.fleet/coverage-contract.json"
dead_keys=$(node -e '
  const fs = require("fs");
  const contract = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const root = process.argv[2];
  const dead = Object.keys(contract).filter((k) => !fs.existsSync(root + "/" + k.replace(/\/\*{1,2}$/, "")));
  if (dead.length) { console.log(dead.join(" ")); process.exit(1); }
' "$CONTRACT" "$REAL_ROOT" 2>&1)
[ -z "$dead_keys" ] && ok "9f every coverage-contract key names a path in the tree" \
  || bad "9f coverage contract has dead keys" "$dead_keys"

echo "=== Section 2: check-cmd.sh and check.conf validation ==="

TEST_HOME="$ROOT/home"
mkdir -p "$TEST_HOME"

# 10. check-cmd.sh outputs expected field values from tracked check.conf (isolated from any installed conf)
cmd_val=$(HOME="$TEST_HOME" FLEET_CHECK_CONF="$ROOT/no-target.conf" bash "$CHECK_CMD_SCRIPT" CHECK_CMD)
fast_cmd_val=$(HOME="$TEST_HOME" FLEET_CHECK_CONF="$ROOT/no-target.conf" bash "$CHECK_CMD_SCRIPT" CHECK_FAST_CMD)
[ "$cmd_val" = "bash tools/full-gate.sh" ] && ok "10a check-cmd.sh prints CHECK_CMD correctly" || bad "10a CHECK_CMD wrong" "$cmd_val"
[ "$fast_cmd_val" = "bash tools/fast-gate.sh" ] && ok "10b check-cmd.sh prints CHECK_FAST_CMD correctly" || bad "10b CHECK_FAST_CMD wrong" "$fast_cmd_val"

# 10c/10d. The no-work contract is the pair fleet-check actually consumes: a policy of 'unknown'
# (the default when undeclared) makes every exempt-only change a non-verdict, and a regex that
# does not match the marker the gate prints makes the declaration inert. Assert both halves,
# and assert the regex against the marker the gate really emits for an exempt-only selection.
no_work_policy=$(HOME="$TEST_HOME" FLEET_CHECK_CONF="$ROOT/no-target.conf" bash "$CHECK_CMD_SCRIPT" CHECK_FAST_NO_WORK_POLICY)
[ "$no_work_policy" = "pass" ] && ok "10c check-cmd.sh exposes CHECK_FAST_NO_WORK_POLICY=pass" || bad "10c CHECK_FAST_NO_WORK_POLICY not pass" "got '$no_work_policy'"

no_work_re=$(HOME="$TEST_HOME" FLEET_CHECK_CONF="$ROOT/no-target.conf" bash "$CHECK_CMD_SCRIPT" CHECK_FAST_NO_WORK_RE)
exempt_marker=$(run --changed README.md | grep -F 'no suites affected' | head -1)
if [ -n "$no_work_re" ] && [ -n "$exempt_marker" ] && grep -qE "$no_work_re" <<<"$exempt_marker"; then
  ok "10d declared CHECK_FAST_NO_WORK_RE matches the exempt-only marker the gate prints"
else
  bad "10d CHECK_FAST_NO_WORK_RE does not match the gate's exempt-only marker" "regex='$no_work_re' marker='$exempt_marker'"
fi

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

echo "=== Section 4: verify-package.mjs publish lifecycle and negative branch assertions ==="

VP_FIXTURE="$ROOT/vp-fixture"
mkdir -p "$VP_FIXTURE/tools" "$VP_FIXTURE/src" "$VP_FIXTURE/spec/support"
cp "$HERE/verify-package.mjs" "$VP_FIXTURE/tools/"
cp "$HERE/../src/routes.js" "$VP_FIXTURE/src/"
cp "$HERE/../spec/support/jasmine.json" "$VP_FIXTURE/spec/support/"
ln -s "$HERE/../node_modules" "$VP_FIXTURE/node_modules"

BASE_PKG=$(cat <<'EOF'
{
  "name": "leviroutes",
  "version": "1.0.0",
  "type": "module",
  "main": "./src/routes.js",
  "module": "./src/routes.js",
  "browser": "./dist/routes.min.js",
  "exports": {
    ".": {
      "browser": "./dist/routes.min.js",
      "import": "./src/routes.js"
    }
  },
  "scripts": {
    "test": "jasmine",
    "verify:package": "node tools/verify-package.mjs",
    "build": "npm run build:min",
    "build:min": "terser src/routes.js -o dist/routes.min.js -c -m --comments false",
    "prepublishOnly": "npm test && npm run verify:package && npm run build"
  }
}
EOF
)

# 17a. clean control passes
echo "$BASE_PKG" > "$VP_FIXTURE/package.json"
cp "$HERE/../spec/support/jasmine.json" "$VP_FIXTURE/spec/support/jasmine.json"
clean_vp_out=$(cd "$VP_FIXTURE" && node tools/verify-package.mjs 2>&1)
clean_vp_rc=$?
has "$clean_vp_out" "verify-package: PASS" "17a verify-package passes on clean package.json and jasmine config"
[ "$clean_vp_rc" = 0 ] && ok "17a2 verify-package exits 0 on valid configuration" || bad "17a2 expected exit 0" "got $clean_vp_rc"

# 17b. masked scripts.test is rejected
( cd "$VP_FIXTURE" && node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync("package.json"));p.scripts.test="jasmine || true";fs.writeFileSync("package.json",JSON.stringify(p))' )
vp_17b=$(cd "$VP_FIXTURE" && node tools/verify-package.mjs 2>&1 || true)
has "$vp_17b" 'scripts.test must be exactly "jasmine"' "17b verify-package rejects masked scripts.test"

# 17c. redefined scripts['verify:package'] is rejected
echo "$BASE_PKG" > "$VP_FIXTURE/package.json"
( cd "$VP_FIXTURE" && node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync("package.json"));p.scripts.test="jasmine";p.scripts["verify:package"]="true";fs.writeFileSync("package.json",JSON.stringify(p))' )
vp_17c=$(cd "$VP_FIXTURE" && node tools/verify-package.mjs 2>&1 || true)
has "$vp_17c" 'scripts["verify:package"] must execute "node tools/verify-package.mjs"' "17c verify-package rejects redefined verify:package"

# 17d. poisoned build:min is rejected BEFORE command execution (no side-effect file created)
echo "$BASE_PKG" > "$VP_FIXTURE/package.json"
PWNED_FILE="$VP_FIXTURE/pwned"
( cd "$VP_FIXTURE" && node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync("package.json"));p.scripts["verify:package"]="node tools/verify-package.mjs";p.scripts["build:min"]="touch pwned && terser src/routes.js -o dist/routes.min.js -c -m --comments false";fs.writeFileSync("package.json",JSON.stringify(p))' )
vp_17d=$(cd "$VP_FIXTURE" && node tools/verify-package.mjs 2>&1 || true)
has "$vp_17d" 'scripts["build:min"] must be exactly "terser' "17d verify-package rejects modified build:min"
[ ! -f "$PWNED_FILE" ] && ok "17d2 verify-package validates build:min BEFORE command execution" || bad "17d2 poisoned build command executed before validation!" "pwned file created"

# 17e. unallowlisted lifecycle hook is rejected
echo "$BASE_PKG" > "$VP_FIXTURE/package.json"
( cd "$VP_FIXTURE" && node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync("package.json"));p.scripts["postbuild:min"]="echo hook";fs.writeFileSync("package.json",JSON.stringify(p))' )
vp_17e=$(cd "$VP_FIXTURE" && node tools/verify-package.mjs 2>&1 || true)
has "$vp_17e" 'defines unallowlisted lifecycle hook scripts["postbuild:min"]' "17e verify-package rejects unallowlisted npm lifecycle hook"

# 17f. prepublishOnly shell metacharacters (; | &) are rejected
echo "$BASE_PKG" > "$VP_FIXTURE/package.json"
( cd "$VP_FIXTURE" && node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync("package.json"));p.scripts.prepublishOnly="npm test ; npm run verify:package ; npm run build";fs.writeFileSync("package.json",JSON.stringify(p))' )
vp_17f=$(cd "$VP_FIXTURE" && node tools/verify-package.mjs 2>&1 || true)
has "$vp_17f" 'forbidden shell metacharacters' "17f verify-package rejects non-&& shell metacharacters in prepublishOnly"

# 17g. prepublishOnly missing build leg is rejected
echo "$BASE_PKG" > "$VP_FIXTURE/package.json"
( cd "$VP_FIXTURE" && node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync("package.json"));p.scripts.prepublishOnly="npm test && npm run verify:package";fs.writeFileSync("package.json",JSON.stringify(p))' )
vp_17g=$(cd "$VP_FIXTURE" && node tools/verify-package.mjs 2>&1 || true)
has "$vp_17g" 'must strictly chain test, verify:package, and build commands in order' "17g verify-package rejects prepublishOnly missing build leg"

# 17h. narrowed spec/support/jasmine.json is rejected
echo "$BASE_PKG" > "$VP_FIXTURE/package.json"
echo '{"spec_dir":"spec","spec_files":["routeparsing.spec.mjs"]}' > "$VP_FIXTURE/spec/support/jasmine.json"
vp_17h=$(cd "$VP_FIXTURE" && node tools/verify-package.mjs 2>&1 || true)
has "$vp_17h" 'spec/support/jasmine.json must specify spec_dir "spec" and spec_files' "17h verify-package rejects narrowed spec/support/jasmine.json"

# 17i. Jasmine loads .mjs and .js before .json from spec/support. Keep JSON valid
# while introducing an overriding config; the guard must reject it before building.
cp "$HERE/../spec/support/jasmine.json" "$VP_FIXTURE/spec/support/jasmine.json"
for config in spec/support/jasmine.mjs spec/support/jasmine.js jasmine.mjs jasmine.js; do
  mkdir -p "$VP_FIXTURE/$(dirname "$config")"
  printf 'export default { spec_dir: "spec", spec_files: ["routeparsing.spec.mjs"] };\n' > "$VP_FIXTURE/$config"
  rm -f "$VP_FIXTURE/dist/routes.min.js"
  vp_override=$(cd "$VP_FIXTURE" && node tools/verify-package.mjs 2>&1)
  vp_override_rc=$?
  if [ "$vp_override_rc" != 0 ] && grep -qF "unexpected Jasmine config $config" <<<"$vp_override" && [ ! -e "$VP_FIXTURE/dist/routes.min.js" ]; then
    ok "17i verify-package rejects $config before build"
  else
    bad "17i verify-package accepted $config or built before rejecting it" "rc=$vp_override_rc output=$vp_override"
  fi
  rm "$VP_FIXTURE/$config"
done

echo
if [ "$FAIL" -eq 0 ]; then
  echo "gate tooling tests: $PASS passed, 0 failed"
  exit 0
fi
echo "gate tooling tests: $PASS passed, $FAIL FAILED"
for t in "${FAILED[@]}"; do echo "  FAILED: $t"; done
exit 1
