#!/usr/bin/env bash
# tools/full-gate.sh — the FULL gate: build, package/browser export verification, full test suite.
#
# merger-only: run once per landing on the merged union (docs/speed.md R1, R11, R13).
# Budget: <= 300 s median on 8 vCPU (R1).
set -uo pipefail

HERE=$(cd "$(dirname "$(readlink -f "$0")")" && pwd)
ROOT=$(cd "$HERE/.." && pwd)

rc=0
step() { printf '\n[gate] %s\n' "$1"; }

step "package and build verification: node tools/verify-package.mjs"
( cd "$ROOT" && node tools/verify-package.mjs ) || rc=1

step "full test suite: npm test"
( cd "$ROOT" && npm test ) || rc=1

if [ "${SKIP_GATE_SELF_TESTS:-0}" != "1" ]; then
  step "gate self-tests: bash tools/fast-gate.test.sh"
  ( cd "$ROOT" && bash tools/fast-gate.test.sh ) || rc=1
fi

if [ "$rc" -eq 0 ]; then
  echo "full gate: PASS"
else
  echo "full gate: FAIL" >&2
fi

echo "gate-tier: not-applicable"
exit $rc
