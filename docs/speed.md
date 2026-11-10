# Speed and Gate Architecture for leviroutes

**Owner:** implementer / architect  
**Status:** Active  
**Tracking beads:** `leviroutes-22g`, `leviroutes-bz9`  

Paul, 2026-10-11: *"We need to architect each fleet and the architecture of the system so that we get ultimate merge speed and CI speed. This should be core to all work... The VM pool is not the issue, the way you test and how it's structured is the issue."*

## 1. Gate Architecture & Budgets

Leviroutes defines two distinct gate tiers adhering to fleet rules R1, R2, R5, R11, R13 and R14:

- **R1 / R2 / R5** — the tier shape and selection: a fast gate that is a strict subset of the full gate and budgeted ≤ 60 s, affected-only selection via `tools/suite-map.tsv`, failing loudly on unmapped files.
- **R11 / R13** — the full gate is the merger's single union gate, not something an implementer runs per change.
- **R14** — the gate must cover what a change can affect; that is what the coverage contract in `.fleet/coverage-contract.json` enforces.

| Tier | Script | Target / Budget | Executed By | Selection |
|---|---|---|---|---|
| **Fast Gate** | `tools/fast-gate.sh` | **≤ 60 s** (`CHECK_FAST_TIMEOUT=60`) | Implementer | Affected-only via `tools/suite-map.tsv` |
| **Full Gate** | `tools/full-gate.sh` | **≤ 300 s** (`CHECK_TIMEOUT=300`) | Merger only | Full union: package verification (no build), spec suite, tooling self-tests |

Both commands and contracts are registered in `tools/check.conf` and verified via `tools/check-cmd.sh`.

## 2. Component Timing Breakdown (Measured on 2 vCPU VM)

Under representative VM load (load average 1–3), the full gate executes three sequential stages:

### Stage 1: Package Verification (`node tools/verify-package.mjs`) — ~0.7 s
There is no build stage: the package ships `src/routes.js` and the browser, import and main entries all
resolve to it (leviroutes-o71), so the gate verifies configuration and resolution instead of compiling
and byte-matching an artifact (leviroutes-x8g).
- Static package.json and package-lock.json structure, script bodies, lifecycle hooks, `files[]`
  coverage of the shipped source, and SRI integrity check (~0.05 s)
- Publish-endpoint pinning: `npm_config_registry`, `.npmrc` `registry=`/`ignore-scripts=` in npm's own
  boolean coercion, so a publish cannot be redirected or the lifecycle silently disabled
- Installed dependency tree validation via `npm ls` with suppressed notifier/audit pings
- Package condition export resolution in child processes (default import, browser condition, functional
  execution of a route through the resolved entry point)

Measured 2026-11-10 on the fleet VM: 0.64 s wall for the whole stage. The pre-no-build stage spent ~12 s
of it on `npm run build` plus a byte-match and a `dist/` smoke test, all of which are gone.

### Stage 2: Full Spec Suite (`npm test`) — ~3 s
- 191 specs across 11 test suites (`spec/*.spec.mjs`, including `spec/verifypackage-lifecycle.spec.mjs`, `spec/verifypackage-registry.spec.mjs` and `spec/repohygiene.spec.mjs`)
- **Fixture isolation constraint:** Every single spec constructs an isolated JSDOM instance (`spec/helpers/dom-helper.mjs`) to guarantee unwrapped `history.pushState` and zero listener leaks across specs (`spec/fixtureisolation.spec.mjs`). The isolation is a correctness constraint, not the reason for the historical ~40 s figure: the same suites measure 2.1 s in-suite / 2.9 s wall on 2026-11-10.

Measured 2026-11-10 on the fleet VM (2 vCPU, load average 0.66): 2.90 s wall for the whole suite.
Recount with `/usr/bin/time -f 'npm-test wall=%es' npm test`. Earlier revisions of this document recorded
~40–45 s for 114 specs; if a recount lands back near that figure, find what re-introduced the cost before
raising the budget.

### Stage 3: Gate Tooling Self-Tests (`bash tools/fast-gate.test.sh`) — ~2 s
*Measured 2026-11-10 on the fleet VM (2 vCPU, load average 0.66): 1.86 s wall for 98 assertions; 100 after
leviroutes-4oa added 1m and leviroutes-d6p added 17d3, `gate tooling tests: 100 passed, 0 failed`. Recount with `/usr/bin/time -f 'selftest wall=%es' bash tools/fast-gate.test.sh`, and
recount the per-section counts after any edit to the file with `bash tools/fast-gate.test.sh 2>&1 | awk
'/=== Section 1/{s=1} /=== Section 2/{s=2} /=== Section 3/{s=3} /=== Section 4/{s=4} /^ *ok /{c[s]++}
END{for(i=1;i<=4;i++) printf "Section %d: %d\n", i, c[i]}'` — a stale count here is a stale contract,
because `tools/fast-gate.sh` and `tools/full-gate.sh` cite this document. Only the whole-suite time is
recorded here: at ~2 s the four sections are not separable meaningfully on this VM, so an earlier
per-section second count (which summed to ~40 s) has been dropped rather than restated.*
- **Section 1 (59 tests):** Selection mapping, fail-loud unmapped rejection, spec self-mapping, exemptions, `--list`, dead row rejection, coverage contract conformance, and the inherited compile cache being cleared before any suite runs (leviroutes-4oa). Direct exit code capture eliminates 9 redundant runner child processes.
- **Section 2 (11 tests):** `tools/check.conf` validation, drift detection, and `--install` stamping.
- **Section 3 (6 tests):** `tools/full-gate.sh` step execution and failure loud-reporting orchestration.
- **Section 4 (24 tests):** End-to-end publish lifecycle verification:
  - 17a / 17a2: Real positive full verification executed as a standalone CLI process (`node tools/verify-package.mjs`) covering static configuration, export resolution and functional smoke through the resolved entry point — there is no build artifact to create or byte-match since leviroutes-o71.
  - 17b–17n: 17 negative failure assertions batched into a single in-process Node runner, eliminating 20+ cold-start process invocations while preserving exact error message contracts; 17o / 17o2 add the in-sync dependency bump parity pair, 17p asserts the runner accounted for every Section 4 assertion, and 17q asserts a simulated runner exit 37 fails closed rather than rejecting zero checks.

## 3. History & Measured Optimizations

### Baseline before leviroutes-22g / leviroutes-bz9
- In Section 4 of `tools/fast-gate.test.sh`, tests 17b–17n each launched a separate `node -e` process to mutate fixture files, followed by a separate `node tools/verify-package.mjs` process.
- Each verifier run executed `npm ls` before static configuration checks, causing invalid fixtures to spend 10–15 s on npm startup before reporting configuration errors.
- Test 17o re-ran the full build and dependency checks.
- Result: Section 4 alone took 174 s profiled under load, pushing the full gate to 280–290 s and frequently exceeding the 300 s bound (exit 124).

### leviroutes-22g (Commit 40596f8)
- Deferred `npm ls` until after static script, Jasmine, and package configuration checks.
- Invalid fixtures in Section 4 skipped `npm ls`, cutting Section 4 runtime from >300 s to 145.5 s under load ~2–3.

### leviroutes-bz9 (This change)
- Exported `verifyPackage(root, options)` in `tools/verify-package.mjs` supporting `{ exitOnError, skipExecution }`.
- Optimized npm invocations with `npm_config_update_notifier=false`, `npm_config_audit=false`, and `npm_config_fund=false`.
- Refactored `tools/fast-gate.test.sh`:
  - Section 1: eliminated 9 redundant subshell runs by reading `$?` directly instead of running separate `run_rc` commands.
  - Section 4: 17a/17a2 preserves positive full verification via real CLI execution with `VERIFY_SKIP_NPM_LS=1` for the symlinked fixture.
  - Section 4: 17b–17o2 runs all negative error checks and in-sync dependency parity checks in a single in-process runner.
- Result: Section 4 reduced from 145.5 s down to ~26 s. `tools/fast-gate.test.sh` runtime reduced from 208 s to ~40-46 s (a ~5x speedup), enabling parallel fast-gate execution to pass within the 60 s budget under high system load.

## 4. Timeout Budget Decision

- **Fast Gate:** Budget is ≤ 60 s. Fast gate runs mapped suites in parallel (`JOBS=4`); the whole spec suite is 2.90 s wall (2026-11-10), so a mapped subset is well inside 60 s (`CHECK_FAST_TIMEOUT=60`).
- **Full Gate:** Median runtime is ~5.5 s, measured 2026-11-10: package verification 0.64 s + spec suite
  2.90 s + tooling self-tests 1.86 s, run sequentially on 2 vCPUs at load average 0.66.
  - Earlier revisions recorded ~95–120 s. Most of that was a ~24 s Terser build (removed by leviroutes-o71)
    and a ~40 s spec suite that now measures 2.9 s, so the figure is a measurement, not a re-estimate.
  - `CHECK_TIMEOUT=300` in `tools/check.conf` is retained as the contract's ceiling for a saturated VM. At
    the current cost it is a ~50x margin; tightening it is a budget decision for its own bead, not a
    documentation change, and the bound still eliminates false-positive exit 124 kills under CPU contention
    on multi-tenant VMs while remaining firmly bounded.
