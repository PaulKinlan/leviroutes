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
# Hermetic cache root for the gate's V8 compile cache: nothing under $HOME is touched, and
# each test run starts cold (leviroutes-43f).
export XDG_CACHE_HOME="$ROOT/cache"
mkdir -p "$XDG_CACHE_HOME"
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
touch "$ROOT/repo/spec/serverdispatch.spec.mjs"

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

# run_fast_gate_jobs <jobs> [XDG_CACHE_HOME_IS_FILE] [gate args...] — run() with an explicit
# FAST_GATE_JOBS, optionally with XDG_CACHE_HOME pointed at a regular file so the compile-cache
# mkdir fails (1l).
: > "$ROOT/cache-file"
run_fast_gate_jobs() {
  local jobs="$1"; shift
  local cache_env=()
  if [ "${1:-}" = "XDG_CACHE_HOME_IS_FILE" ]; then
    shift
    cache_env+=("XDG_CACHE_HOME=$ROOT/cache-file")
  fi
  ( cd "$ROOT/repo" && env FAST_GATE_JOBS="$jobs" ${cache_env[@]+"${cache_env[@]}"} \
      FAST_GATE_RUNNER="$FAST_GATE_RUNNER" RUN_LOG="$RUN_LOG" STUB_FAIL="${STUB_FAIL:-0}" \
      bash "$GATE" "$@" 2>&1 )
}

echo "=== Section 1: fast-gate.sh selection and fail-loud behaviour ==="

# 1. Mapped source file selects all 8 specs and executes them
rm -f "$RUN_LOG"
out=$(run --changed src/routes.js)
rc=$?
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

# 1k. FAST_GATE_JOBS=1 serialises the selection and still runs every suite to PASS:
# concurrency is a scheduling detail, never a coverage one (leviroutes-43f).
rm -f "$RUN_LOG"
out=$(run_fast_gate_jobs 1 --changed src/routes.js)
rc=$?
has "$out" "fast-gate: PASS (8 suite(s), 1 changed file(s))" "1k FAST_GATE_JOBS=1 still passes all 8 suites"
[ "$rc" = 0 ] && ok "1k2 FAST_GATE_JOBS=1 exits 0" || bad "1k2 expected exit 0" "got $rc"

# 1l. An unwritable compile-cache location fails open: the gate unsets NODE_COMPILE_CACHE
# and runs anyway (leviroutes-43f). XDG_CACHE_HOME here is a regular FILE, so mkdir -p of
# the cache dir under it must fail.
out=$(run_fast_gate_jobs 1 XDG_CACHE_HOME_IS_FILE --changed spec/middleware.spec.mjs)
rc=$?
has "$out" "fast-gate: PASS (1 suite(s), 1 changed file(s))" "1l unwritable compile-cache location fails open"
[ "$rc" = 0 ] && ok "1l2 fail-open exits 0" || bad "1l2 expected exit 0" "got $rc"

# 2. Unmapped changed file fails loudly
out=$(run --changed src/unknown.js)
rc=$?
has "$out" "fast-gate: unmapped: src/unknown.js" "2a unmapped changed file emitted with marker"
[ "$rc" != 0 ] && ok "2b unmapped file exits non-zero" || bad "2b expected non-zero exit" "got $rc"
hasnt "$out" "fast-gate: passed:" "2c no passed marker emitted on unmapped change"

# 3. Changed spec file maps to itself
rm -f "$RUN_LOG"
out=$(run --changed spec/middleware.spec.mjs)
rc=$?
has "$out" "fast-gate: running: spec/middleware.spec.mjs" "3a changed spec file maps to itself"
hasnt "$out" "fast-gate: running: spec/routeparsing.spec.mjs" "3b does not select unrelated specs"
has "$out" "fast-gate: PASS (1 suite(s), 1 changed file(s))" "3c terminal PASS line for single spec"
[ "$rc" = 0 ] && ok "3d exit 0 for spec change" || bad "3d expected exit 0" "got $rc"

# 3e. An explicit map row for a spec file overrides the built-in self-map: the map is read
# before the fallback, so spec rows are live config and an edit to one takes effect
# (leviroutes-jo7: the fallback returned first and silently shadowed every spec row).
cp "$ROOT/repo/tools/suite-map.tsv" "$ROOT/map.bak"
printf 'spec/urlpatternmatcher.spec.mjs\tspec/middleware.spec.mjs\n' >> "$ROOT/repo/tools/suite-map.tsv"
out=$(run --list --changed spec/urlpatternmatcher.spec.mjs)
rc=$?
[ "$out" = "spec/middleware.spec.mjs" ] && ok "3e explicit spec row overrides the self-map" || bad "3e spec row was ignored" "got: $out"
[ "$rc" = 0 ] && ok "3f override selection exits 0" || bad "3f expected exit 0" "got $rc"
cp "$ROOT/map.bak" "$ROOT/repo/tools/suite-map.tsv"

# 4. Exempt path runs nothing and exits 0
out=$(run --changed README.md)
rc=$?
has "$out" "fast-gate: no suites affected by 1 changed file(s) (1 exempt)" "4a exempt path selects nothing"
[ "$rc" = 0 ] && ok "4b exempt path exits 0" || bad "4b expected exit 0" "got $rc"
hasnt "$out" "fast-gate: unmapped:" "4c exempt path is not reported unmapped"

# 4d. The coverage contract is consumed by this suite (9f/9g), so editing it selects the gate
# self-tests instead of falling through the !.fleet/** exemption (leviroutes-jo7: the file
# defining the gate's coverage duty was the one file the fast gate never re-tested).
out=$(run --list --changed .fleet/coverage-contract.json)
rc=$?
has "$out" "tools/fast-gate.test.sh" "4d changed coverage contract selects the gate self-tests"
hasnt "$out" "no suites affected" "4e contract change is mapped, not exempt"
[ "$rc" = 0 ] && ok "4e2 contract-change selection exits 0" || bad "4e2 expected exit 0" "got $rc"

# 4f. Other .fleet/** files keep their exemption.
out=$(run --changed .fleet/other-config.json)
rc=$?
has "$out" "no suites affected by 1 changed file(s) (1 exempt)" "4f non-contract .fleet files stay exempt"
[ "$rc" = 0 ] && ok "4f2 exempt .fleet file exits 0" || bad "4f2 expected exit 0" "got $rc"

# 5. --list prints selection and runs nothing
rm -f "$RUN_LOG"
out=$(run --list --changed src/routes.js)
has "$out" "spec/middleware.spec.mjs" "5a --list prints selected suite"
[ ! -s "$RUN_LOG" ] && ok "5b --list runs no suites" || bad "5b --list ran suites" "$(cat "$RUN_LOG")"

# 6. Failing suite fails the gate
STUB_FAIL=1
out=$(run --changed spec/middleware.spec.mjs)
rc=$?
has "$out" "fast-gate: failed: spec/middleware.spec.mjs" "6a failing suite is reported as failed"
hasnt "$out" "fast-gate: passed: spec/middleware.spec.mjs" "6b failing suite is not reported as passed"
[ "$rc" != 0 ] && ok "6c failing suite exits non-zero" || bad "6c expected non-zero exit" "got $rc"
STUB_FAIL=0

# 7. Package.json and package-lock.json changes select package validation
rm -f "$RUN_LOG"
out=$(run --list --changed package.json)
has "$out" "tools/verify-package.mjs" "7a package.json selects tools/verify-package.mjs"
has "$out" "spec/middleware.spec.mjs" "7b package.json also selects test specs"
out_lock=$(run --list --changed package-lock.json)
has "$out_lock" "tools/verify-package.mjs" "7c package-lock.json selects tools/verify-package.mjs"
has "$out_lock" "spec/middleware.spec.mjs" "7d package-lock.json also selects test specs"

# 8. Stale map entry fails loudly
cp "$ROOT/repo/tools/suite-map.tsv" "$ROOT/map.bak"
printf 'src/routes.js\tspec/nonexistent.spec.mjs\n' > "$ROOT/repo/tools/suite-map.tsv"
out=$(run --changed src/routes.js)
rc=$?
has "$out" "fast-gate: missing: spec/nonexistent.spec.mjs" "8a stale map entry is named"
[ "$rc" != 0 ] && ok "8b stale map entry exits non-zero" || bad "8b expected non-zero exit" "got $rc"
cp "$ROOT/map.bak" "$ROOT/repo/tools/suite-map.tsv"

# 9. Missing map file refuses to guess
mv "$ROOT/repo/tools/suite-map.tsv" "$ROOT/map.hidden"
out=$(run --changed src/routes.js)
rc=$?
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
rc=$?
has "$out" "fast-gate: dead row: retired-ghost/**" "9d1 dead map row is named"
[ "$rc" != 0 ] && ok "9d2 dead map row exits non-zero" || bad "9d2 expected non-zero exit" "got $rc"
hasnt "$out" "fast-gate: PASS" "9d3 dead map row does not report PASS"

# ... and a literal path row is checked the same way (SpecRunner.html was the other half of 62g).
printf 'retired-ghost.js\ttools/fast-gate.test.sh\n' >> "$ROOT/repo/tools/suite-map.tsv"
out=$(run --list --changed src/routes.js)
rc=$?
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

# 9g. The coverage contract suites and mapped keys must match the suite map selection
contract_drift=$(node -e '
  const fs = require("fs");
  const { execSync } = require("child_process");
  const contractPath = process.argv[1];
  const root = process.argv[2];
  const suiteMapPath = root + "/tools/suite-map.tsv";

  const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
  const suiteMapText = fs.readFileSync(suiteMapPath, "utf8");

  // Literal non-glob paths (excluding specs that map to themselves) mapped by suite-map.tsv
  const mappedKeys = suiteMapText
    .split("\n")
    .map(l => l.trim())
    .filter(l => l && !l.startsWith("#") && !l.startsWith("!"))
    .map(l => {
      const parts = l.split("\t");
      const path = parts[0].trim();
      const suites = parts.slice(1).join(" ").trim().split(/\s+/).filter(Boolean);
      return { path, suites };
    })
    .filter(({ path, suites }) => {
      if (path.includes("*")) return false;
      // Exclude self-mapping specs (e.g. spec/foo.spec.mjs -> [spec/foo.spec.mjs])
      if (path.startsWith("spec/") && suites.length === 1 && suites[0] === path) return false;
      // The coverage contract is covered by this suite itself (map row -> tools/fast-gate.test.sh,
      // tests 4d/4e): it cannot carry its own contract key without being its own oracle (jo7).
      if (path === ".fleet/coverage-contract.json") return false;
      return true;
    })
    .map(({ path }) => path);

  const contractKeys = new Set(Object.keys(contract));
  const missingKeys = mappedKeys.filter(k => !contractKeys.has(k));

  const errors = [];
  if (missingKeys.length) {
    errors.push("missing contract keys for mapped paths: " + missingKeys.join(" "));
  }

  for (const key of Object.keys(contract)) {
    const out = execSync(`bash "${root}/tools/fast-gate.sh" --list --changed "${key}"`, { cwd: root, encoding: "utf8" });
    const mapSuites = out
      .split("\n")
      .map(s => s.trim())
      .filter(s => s && !s.startsWith("fast-gate:") && !s.startsWith("witnessed:"));

    const contractSuites = contract[key] || [];
    const cSet = new Set(contractSuites);
    const mSet = new Set(mapSuites);

    const missing = mapSuites.filter(s => !cSet.has(s));
    const extra = contractSuites.filter(s => !mSet.has(s));

    const keyErrors = [];
    if (missing.length) keyErrors.push("missing=[" + missing.join(" ") + "]");
    if (extra.length) keyErrors.push("extra=[" + extra.join(" ") + "]");
    if (keyErrors.length) {
      errors.push(key + ": " + keyErrors.join(" "));
    }
  }

  if (errors.length) {
    console.log(errors.join("; "));
    process.exit(1);
  }
' "$CONTRACT" "$REAL_ROOT" 2>&1)
[ -z "$contract_drift" ] && ok "9g coverage contract suites match suite-map selection for all keys" \
  || bad "9g coverage contract drift" "$contract_drift"

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
cp "$HERE/../package-lock.json" "$VP_FIXTURE/package-lock.json"
ln -s "$HERE/../node_modules" "$VP_FIXTURE/node_modules"

# The fixture package.json is derived from the lockfile it copies (name, version and both
# dependency maps) instead of a frozen snapshot of today's devDependencies. verify-package
# compares lock.packages[""] against package.json in BOTH directions, so a hardcoded constant
# turned every legitimate in-sync dependency bump (exactly what `npm i -D <pkg>` produces)
# into 14 red fixture tests (leviroutes-tcn). Only the script block is a frozen constant,
# because that is what the negative assertions below mutate.
BASE_PKG=$(node -e '
const fs = require("fs");
const lock = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const rootEntry = lock.packages[""] || {};
const pkg = {
  name: lock.name,
  version: lock.version,
  type: "module",
  main: "./src/routes.js",
  module: "./src/routes.js",
  browser: "./dist/routes.min.js",
  exports: { ".": { browser: "./dist/routes.min.js", import: "./src/routes.js" } },
  scripts: {
    test: "jasmine",
    "verify:package": "node tools/verify-package.mjs",
    build: "npm run build:min",
    "build:min": "terser src/routes.js -o dist/routes.min.js -c -m --comments false",
    prepublishOnly: "npm test && npm run verify:package && npm run build"
  }
};
if (rootEntry.dependencies) pkg.dependencies = rootEntry.dependencies;
if (rootEntry.devDependencies) pkg.devDependencies = rootEntry.devDependencies;
process.stdout.write(JSON.stringify(pkg, null, 2));
' "$VP_FIXTURE/package-lock.json")
if [ -z "$BASE_PKG" ]; then
  bad "17 the fixture package.json is derived from the copied lockfile" "derivation produced no output"
fi

# 17a. clean control passes
echo "$BASE_PKG" > "$VP_FIXTURE/package.json"
cp "$HERE/../spec/support/jasmine.json" "$VP_FIXTURE/spec/support/jasmine.json"
clean_vp_out=$(cd "$VP_FIXTURE" && VERIFY_SKIP_NPM_LS=1 node tools/verify-package.mjs 2>&1)
clean_vp_rc=$?
has "$clean_vp_out" "verify-package: PASS" "17a verify-package passes on clean package.json and jasmine config"
[ "$clean_vp_rc" = 0 ] && ok "17a2 verify-package exits 0 on valid configuration" || bad "17a2 expected exit 0" "got $clean_vp_rc"

# 17b-17o2. Negative branch assertions and in-sync dependency bump parity check.
# Evaluated in a single runner to avoid 20+ cold-start Node process launches while strictly
# validating exact error messages, exit semantics, and prevention of execution side-effects.
# Fail-closed execution: output is redirected to files so non-zero process exit codes
# (e.g. exit 37, unhandled exceptions) cannot be masked by process substitution (leviroutes-zs1).
RUNNER_OUT="$VP_FIXTURE/section4-runner.out"
RUNNER_ERR="$VP_FIXTURE/section4-runner.err"
runner_rc=0
node --input-type=module -e '
import fs from "node:fs";
import path from "node:path";

const fixture = process.argv[1];
const { verifyPackage } = await import(path.join(fixture, "tools/verify-package.mjs"));

const pkgPath = path.join(fixture, "package.json");
const lockPath = path.join(fixture, "package-lock.json");
const basePkgContent = fs.readFileSync(pkgPath, "utf8");
const baseLockContent = fs.readFileSync(lockPath, "utf8");

function emit(status, name, detail = "") {
  process.stdout.write(`${status}\t${name}\t${detail}\n`);
}

function reset() {
  fs.writeFileSync(pkgPath, basePkgContent);
  fs.writeFileSync(lockPath, baseLockContent);
}

// 17b. masked scripts.test is rejected
{
  const p = JSON.parse(basePkgContent);
  p.scripts.test = "jasmine || true";
  fs.writeFileSync(pkgPath, JSON.stringify(p));
  const res = await verifyPackage(fixture, { exitOnError: false });
  if (!res.ok && res.error.includes("scripts.test must be exactly \"jasmine\"")) {
    emit("ok", "17b verify-package rejects masked scripts.test");
  } else {
    emit("bad", "17b verify-package rejects masked scripts.test", `got: ${JSON.stringify(res)}`);
  }
  reset();
}

// 17c. redefined scripts["verify:package"] is rejected
{
  const p = JSON.parse(basePkgContent);
  p.scripts.test = "jasmine";
  p.scripts["verify:package"] = "true";
  fs.writeFileSync(pkgPath, JSON.stringify(p));
  const res = await verifyPackage(fixture, { exitOnError: false });
  if (!res.ok && res.error.includes("scripts[\"verify:package\"] must execute \"node tools/verify-package.mjs\"")) {
    emit("ok", "17c verify-package rejects redefined verify:package");
  } else {
    emit("bad", "17c verify-package rejects redefined verify:package", `got: ${JSON.stringify(res)}`);
  }
  reset();
}

// 17d. poisoned build:min is rejected BEFORE command execution (no side-effect file created)
{
  const pwnedFile = path.join(fixture, "pwned");
  if (fs.existsSync(pwnedFile)) fs.unlinkSync(pwnedFile);
  const p = JSON.parse(basePkgContent);
  p.scripts["verify:package"] = "node tools/verify-package.mjs";
  p.scripts["build:min"] = "touch pwned && terser src/routes.js -o dist/routes.min.js -c -m --comments false";
  fs.writeFileSync(pkgPath, JSON.stringify(p));
  const res = await verifyPackage(fixture, { exitOnError: false });
  if (!res.ok && res.error.includes("scripts[\"build:min\"] must be exactly \"terser")) {
    emit("ok", "17d verify-package rejects modified build:min");
  } else {
    emit("bad", "17d verify-package rejects modified build:min", `got: ${JSON.stringify(res)}`);
  }
  if (!fs.existsSync(pwnedFile)) {
    emit("ok", "17d2 verify-package validates build:min BEFORE command execution");
  } else {
    emit("bad", "17d2 verify-package validates build:min BEFORE command execution", "pwned file created");
    fs.unlinkSync(pwnedFile);
  }
  reset();
}

// 17e. unallowlisted lifecycle hook is rejected
{
  const p = JSON.parse(basePkgContent);
  p.scripts["postbuild:min"] = "echo hook";
  fs.writeFileSync(pkgPath, JSON.stringify(p));
  const res = await verifyPackage(fixture, { exitOnError: false });
  if (!res.ok && res.error.includes("defines unallowlisted lifecycle hook scripts[\"postbuild:min\"]")) {
    emit("ok", "17e verify-package rejects unallowlisted npm lifecycle hook");
  } else {
    emit("bad", "17e verify-package rejects unallowlisted npm lifecycle hook", `got: ${JSON.stringify(res)}`);
  }
  reset();
}

// 17f. prepublishOnly shell metacharacters (; | &) are rejected
{
  const p = JSON.parse(basePkgContent);
  p.scripts.prepublishOnly = "npm test ; npm run verify:package ; npm run build";
  fs.writeFileSync(pkgPath, JSON.stringify(p));
  const res = await verifyPackage(fixture, { exitOnError: false });
  if (!res.ok && res.error.includes("forbidden shell metacharacters")) {
    emit("ok", "17f verify-package rejects non-&& shell metacharacters in prepublishOnly");
  } else {
    emit("bad", "17f verify-package rejects non-&& shell metacharacters in prepublishOnly", `got: ${JSON.stringify(res)}`);
  }
  reset();
}

// 17g. prepublishOnly missing build leg is rejected
{
  const p = JSON.parse(basePkgContent);
  p.scripts.prepublishOnly = "npm test && npm run verify:package";
  fs.writeFileSync(pkgPath, JSON.stringify(p));
  const res = await verifyPackage(fixture, { exitOnError: false });
  if (!res.ok && res.error.includes("must strictly chain test, verify:package, and build commands in order")) {
    emit("ok", "17g verify-package rejects prepublishOnly missing build leg");
  } else {
    emit("bad", "17g verify-package rejects prepublishOnly missing build leg", `got: ${JSON.stringify(res)}`);
  }
  reset();
}

// 17h. narrowed spec/support/jasmine.json is rejected
{
  const jasminePath = path.join(fixture, "spec/support/jasmine.json");
  const jasmineOrig = fs.readFileSync(jasminePath, "utf8");
  fs.writeFileSync(jasminePath, "{\"spec_dir\":\"spec\",\"spec_files\":[\"routeparsing.spec.mjs\"]}");
  const res = await verifyPackage(fixture, { exitOnError: false });
  if (!res.ok && res.error.includes("spec/support/jasmine.json must specify spec_dir \"spec\" and spec_files")) {
    emit("ok", "17h verify-package rejects narrowed spec/support/jasmine.json");
  } else {
    emit("bad", "17h verify-package rejects narrowed spec/support/jasmine.json", `got: ${JSON.stringify(res)}`);
  }
  fs.writeFileSync(jasminePath, jasmineOrig);
  reset();
}

// 17i. Jasmine loads .mjs and .js before .json from spec/support
{
  const distFile = path.join(fixture, "dist/routes.min.js");
  for (const config of ["spec/support/jasmine.mjs", "spec/support/jasmine.js", "jasmine.mjs", "jasmine.js"]) {
    const configPath = path.join(fixture, config);
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, "export default { spec_dir: \"spec\", spec_files: [\"routeparsing.spec.mjs\"] };\n");
    if (fs.existsSync(distFile)) fs.unlinkSync(distFile);
    const res = await verifyPackage(fixture, { exitOnError: false });
    if (!res.ok && res.error.includes(`unexpected Jasmine config ${config}`) && !fs.existsSync(distFile)) {
      emit("ok", `17i verify-package rejects ${config} before build`);
    } else {
      emit("bad", `17i verify-package accepted ${config} or built before rejecting it`, `res=${JSON.stringify(res)}`);
    }
    fs.unlinkSync(configPath);
  }
  reset();
}

// 17j. missing package-lock.json is rejected
{
  const hiddenPath = path.join(fixture, "package-lock.hidden");
  fs.renameSync(lockPath, hiddenPath);
  const res = await verifyPackage(fixture, { exitOnError: false });
  if (!res.ok && res.error.includes("missing package-lock.json")) {
    emit("ok", "17j verify-package rejects missing package-lock.json");
  } else {
    emit("bad", "17j verify-package rejects missing package-lock.json", `got: ${JSON.stringify(res)}`);
  }
  fs.renameSync(hiddenPath, lockPath);
  reset();
}

// 17k. invalid JSON in package-lock.json is rejected
{
  fs.writeFileSync(lockPath, "not valid json");
  const res = await verifyPackage(fixture, { exitOnError: false });
  if (!res.ok && res.error.includes("invalid JSON in package-lock.json")) {
    emit("ok", "17k verify-package rejects invalid JSON in package-lock.json");
  } else {
    emit("bad", "17k verify-package rejects invalid JSON in package-lock.json", `got: ${JSON.stringify(res)}`);
  }
  reset();
}

// 17l. corrupt SRI integrity in package-lock.json is rejected
{
  const corrupt = baseLockContent.replace(/"integrity": "sha512-/, "\"integrity\": \"sha512-CORRUPT");
  fs.writeFileSync(lockPath, corrupt);
  const res = await verifyPackage(fixture, { exitOnError: false });
  if (!res.ok && res.error.includes("contains invalid integrity hash")) {
    emit("ok", "17l verify-package rejects corrupt SRI integrity in package-lock.json");
  } else {
    emit("bad", "17l verify-package rejects corrupt SRI integrity in package-lock.json", `got: ${JSON.stringify(res)}`);
  }
  reset();
}

// 17m. mismatched dependencies between package.json and package-lock.json is rejected
{
  const p = JSON.parse(basePkgContent);
  p.devDependencies.jasmine = "^6.0.0";
  fs.writeFileSync(pkgPath, JSON.stringify(p));
  const res = await verifyPackage(fixture, { exitOnError: false });
  if (!res.ok && res.error.includes("package-lock.json devDependencies[\"jasmine\"]")) {
    emit("ok", "17m verify-package rejects mismatched dependencies between package.json and package-lock.json");
  } else {
    emit("bad", "17m verify-package rejects mismatched dependencies between package.json and package-lock.json", `got: ${JSON.stringify(res)}`);
  }
  reset();
}

// 17n. mismatched name/version in package-lock.json is rejected
{
  const l = JSON.parse(baseLockContent);
  l.version = "9.9.9";
  fs.writeFileSync(lockPath, JSON.stringify(l));
  const res = await verifyPackage(fixture, { exitOnError: false });
  if (!res.ok && res.error.includes("package-lock.json version \"9.9.9\" does not match package.json version")) {
    emit("ok", "17n verify-package rejects mismatched name or version in package-lock.json");
  } else {
    emit("bad", "17n verify-package rejects mismatched name or version in package-lock.json", `got: ${JSON.stringify(res)}`);
  }
  reset();
}

// 17o. in-sync dependency bump passes static parity validation without cold-start build penalty
{
  const p = JSON.parse(basePkgContent);
  p.devDependencies.terser = ">=5.0.0";
  fs.writeFileSync(pkgPath, JSON.stringify(p, null, 2));
  const l = JSON.parse(baseLockContent);
  l.packages[""].devDependencies.terser = ">=5.0.0";
  fs.writeFileSync(lockPath, JSON.stringify(l, null, 2));
  const res = await verifyPackage(fixture, { exitOnError: false, skipExecution: true });
  if (res.ok && res.output.includes("verify-package: PASS")) {
    emit("ok", "17o verify-package accepts an in-sync dependency bump (fixture package.json derives from the lockfile)");
    emit("ok", "17o2 verify-package exits 0 on an in-sync dependency bump");
  } else {
    emit("bad", "17o verify-package accepts an in-sync dependency bump (fixture package.json derives from the lockfile)", `got: ${JSON.stringify(res)}`);
    emit("bad", "17o2 verify-package exits 0 on an in-sync dependency bump", `got: ${JSON.stringify(res)}`);
  }
  reset();
}
' "$VP_FIXTURE" > "$RUNNER_OUT" 2> "$RUNNER_ERR" || runner_rc=$?

if [ "$runner_rc" != 0 ]; then
  bad "17 Section 4 in-process runner exited with code $runner_rc" "$(cat "$RUNNER_ERR")"
fi

seen_tests=0
while IFS=$'\t' read -r status name detail; do
  [ -z "$status" ] && continue
  seen_tests=$((seen_tests + 1))
  if [ "$status" = "ok" ]; then
    ok "$name"
  else
    bad "$name" "$detail"
  fi
done < "$RUNNER_OUT"

if [ "$seen_tests" -eq 19 ]; then
  ok "17p Section 4 accounted for all 19 assertions"
else
  bad "17p Section 4 expected 19 assertions" "only executed $seen_tests assertions"
fi

# 17q. simulated runner crash (exit 37) with zero checks is caught and fails loudly (leviroutes-zs1 repro)
sim_out="$VP_FIXTURE/sim-crash.out"
sim_err="$VP_FIXTURE/sim-crash.err"
sim_rc=0
node -e 'process.exit(37)' > "$sim_out" 2> "$sim_err" || sim_rc=$?
sim_failed=0
[ "$sim_rc" != 0 ] && sim_failed=1
sim_seen=0
while IFS=$'\t' read -r s _; do
  [ -n "$s" ] && sim_seen=$((sim_seen + 1))
done < "$sim_out"
[ "$sim_seen" -lt 19 ] && sim_failed=1
if [ "$sim_failed" = 1 ]; then
  ok "17q simulated runner exit 37 fails closed and rejects zero checks"
else
  bad "17q runner exit 37 was masked as PASS" "sim_rc=$sim_rc sim_seen=$sim_seen"
fi

echo
if [ "$FAIL" -eq 0 ]; then
  echo "gate tooling tests: $PASS passed, 0 failed"
  exit 0
fi
echo "gate tooling tests: $PASS passed, $FAIL FAILED"
for t in "${FAILED[@]}"; do echo "  FAILED: $t"; done
exit 1
