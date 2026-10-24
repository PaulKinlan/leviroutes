# Speed and Gate Architecture for leviroutes

**Owner:** implementer / architect  
**Status:** Active  
**Tracking beads:** `leviroutes-22g`, `leviroutes-bz9`  

Paul, 2026-10-11: *"We need to architect each fleet and the architecture of the system so that we get ultimate merge speed and CI speed. This should be core to all work... The VM pool is not the issue, the way you test and how it's structured is the issue."*

## 1. Gate Architecture & Budgets

Leviroutes defines two distinct gate tiers adhering to fleet rules R1–R5:

| Tier | Script | Target / Budget | Executed By | Selection |
|---|---|---|---|---|
| **Fast Gate** | `tools/fast-gate.sh` | **≤ 60 s** (`CHECK_FAST_TIMEOUT=60`) | Implementer | Affected-only via `tools/suite-map.tsv` |
| **Full Gate** | `tools/full-gate.sh` | **≤ 300 s** (`CHECK_TIMEOUT=300`) | Merger only | Full union: build verification, spec suite, tooling self-tests |

Both commands and contracts are registered in `tools/check.conf` and verified via `tools/check-cmd.sh`.

## 2. Component Timing Breakdown (Measured on 2 vCPU VM)

Under representative VM load (load average 1–3), the full gate executes three sequential stages:

### Stage 1: Package & Build Verification (`node tools/verify-package.mjs`) — ~24 s
- Static package.json and package-lock.json structure, script bodies, lifecycle hooks, and SRI integrity check (~0.05 s)
- Installed dependency tree validation via `npm ls` with suppressed notifier/audit pings (~7.5 s)
- Clean minification build via `npm run build` (`terser src/routes.js -o dist/routes.min.js`) (~12 s)
- Exact compilation byte-match verification against terser output (~0.2 s)
- File presence and non-empty assertions on disk (~0.01 s)
- Runtime smoke test of `src/routes.js` and `dist/routes.min.js` (~0.05 s)
- Package condition export resolution in child processes (default import, browser condition, functional execution) (~0.6 s)

### Stage 2: Full Spec Suite (`npm test`) — ~40–45 s
- 86 specs across 8 test suites (`spec/*.spec.mjs`)
- **Fixture isolation constraint:** Every single spec constructs an isolated JSDOM instance (`spec/helpers/dom-helper.mjs`) to guarantee unwrapped `history.pushState` and zero listener leaks across specs (`spec/fixtureisolation.spec.mjs`). This intentional architectural isolation accounts for the ~40 s test execution time.

### Stage 3: Gate Tooling Self-Tests (`bash tools/fast-gate.test.sh`) — ~40 s
- **Section 1 (38 tests, ~3 s):** Selection mapping, fail-loud unmapped rejection, spec self-mapping, exemptions, `--list`, dead row rejection, and coverage contract conformance. Direct exit code capture eliminates 9 redundant runner child processes.
- **Section 2 (15 tests, ~1 s):** `tools/check.conf` validation, drift detection, and `--install` stamping.
- **Section 3 (7 tests, ~10 s):** `tools/full-gate.sh` step execution and failure loud-reporting orchestration.
- **Section 4 (21 tests, ~26 s):** End-to-end publish lifecycle verification:
  - 17a / 17a2 (~23 s): Real positive full verification executed as a standalone CLI process (`node tools/verify-package.mjs`) verifying build artifact creation, minification byte-matching, runtime smoke tests, and package export resolution.
  - 17b–17o2 (~3 s): 16 negative failure assertions and 1 in-sync dependency bump parity assertion batched into a single in-process Node runner, eliminating 20+ cold-start process invocations while preserving exact error message contracts.

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

- **Fast Gate:** Budget is ≤ 60 s. Fast gate runs mapped suites in parallel (`JOBS=4`), consistently completing in ≤ 60 s (`CHECK_FAST_TIMEOUT=60`).
- **Full Gate:** Median runtime is ~120 s.
  - While individual subcomponents can complete faster on idle unloaded hardware, the combination of per-spec JSDOM isolation (40 s), full build verification (24 s), and comprehensive gate tooling self-tests (54 s) establishes a 120 s baseline on 2 vCPUs.
  - `CHECK_TIMEOUT=300` in `tools/check.conf` is retained. A 300 s bound provides a healthy 2.5x safety margin against CPU contention and throttling on multi-tenant VMs during concurrent runs, eliminating false-positive exit 124 kills while remaining firmly bounded.
