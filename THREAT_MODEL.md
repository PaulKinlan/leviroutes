# THREAT_MODEL — leviroutes

**Status:** tracked, authoritative for the `tm-*` rule IDs cited in `src/routes.js` and
`tools/verify-package.mjs`.

The nightly factory threat-model station writes its own report to
`~/agents/findings/leviroutes-factory-THREAT_MODEL.md`. That report is an *input*: untracked,
regenerated every night, and it bootstraps from the code. This file is the stable home for the
reasoning that the code and the publish gate depend on — the numeric calibration behind each guard,
the accepted exclusions, and the rule IDs the guards cite.

**Maintenance rule:** changing a bounded constant, an admission rule or an exclusion in §9 requires
a matching edit here in the same change, so the next audit can tell a deliberate trade-off from a
regression. (leviroutes-dq9n, factory audit run-20261113T031403Z.)

## 1. Trust boundary

| Actor | Trust | What they supply |
|---|---|---|
| Route author / app developer | **trusted** | route patterns, handlers, middleware, repo config |
| Remote requester | **untrusted** | the request target (`req.url`), and therefore the pathname matched and the query string parsed into `req.values` |
| End user / browser navigation | **untrusted** | `document.location`, form `action` and field values, Back/forward events |
| Third-party page scripts | **untrusted, same page** | share the `History.prototype` the router patches |
| Publish environment | **semi-trusted** | `npm_config_*`, `.npmrc` layers, `publishConfig`, lifecycle scripts, lockfile `resolved`/`integrity`, installed `node_modules` |

Route pattern text is trusted: `auditRouteStructure`, `hasNestedQuantifiers` and
`MAX_PATTERN_LENGTH` keep an authoring mistake from becoming a runtime weakness, they do not defend
against the author. Nothing in the library authenticates, authorises, rate-limits or parses bodies;
that is the hosting app's job and is not a finding.

## 2. Rule IDs the code cites

| Rule ID | Cited at | Where it is defined here |
|---|---|---|
| `tm-unbounded-pattern-eval-on-untrusted-path` | `src/routes.js:30`, `:542` | §3 |
| `tm-urlpattern-custom-groups-unvalidated` | `src/routes.js:1120` | §4 |
| `tm-anchor-wrapper-escapable-by-route-text` | `src/routes.js:1316` | §4 |

## 3. Matching cost on an attacker-chosen path

Every `dispatch()` and every navigation runs a compiled matcher against a pathname the requester
chose, bounded only by `MAX_PATH_LENGTH` (4096) and `MAX_URL_LENGTH` (16384). Admission is a
**calibrated heuristic**, not a proof, and the band it admits is deliberate:

| Constant | Value | Calibration recorded at the definition |
|---|---|---|
| `MAX_ADJACENT_AMBIGUOUS_ATOMS` | 2 | run of 2 adjacent unbounded atoms at the 4096-char near-miss cap ≈ 32 ms; run 3 = 26.9 s; run 4 = minutes. Two is a plausible authoring accident costing a quadratic match. |
| `MAX_BOUNDED_SPLIT_PRODUCT` | 5,000,000 | products ≈ 1e6 stay under ~2 ms; 1.7e7 costs 1.6 s (`\d` spelling) to 61 ms (`[a-z]{2,4}`); 7.8e10 costs 167 s. The cap sits just above the fast band and admits up to ~0.5 s worst-case shapes. |
| `MAX_FIXED_COUNT_OF_UNBOUNDED_ATOM` | 2 | `(\d+){2}` = 80 ms, `(\w+){2}` = 59 ms; `(\d+){3}` = 88 s, `([a-z]+){3}` = 129 s. |
| `MAX_EXPANDED_RUNS` | 4096 | bounds the analyser's own expansion work, not matching |

Consequence, accepted: an admitted shape can still cost hundreds of milliseconds per request, so a
single-threaded Node host can have its event loop saturated by a route shape the filter certified.
There is no per-request timeout and no worker isolation. Apps that build routes from data are the
ones exposed; the mitigation is at the boundary (a linear-time engine, or a worker with a timeout),
not another constant. Runtime budget for dispatch overall is a separate, tracked item
(`leviroutes-esva`: request-target and query-scan caps landed; see §8.1).

## 4. Registration-time validation

- regexp mode: no pattern reaches `new RegExp` without `auditRouteStructure` (paren balance, wrapper
  escapes, nested and adjacent ambiguity, syntax) — so route text cannot close the `^(?:…)$` wrapper
  or add an unanchored alternative.
- urlpattern mode: the platform engine compiles and matches, so the regexp-mode structural audit does
  not apply; `validateUrlPatternGroups` validates custom groups only, and lookaround inside a group is
  rejected for cross-engine parity.
- Bounds applied before the work: `MAX_PATTERN_LENGTH` (2048), `MAX_EXPANDED_RUNS` (4096),
  `EXPANSION_TOO_COMPLEX`.

## 5. Untrusted data handed to handlers

- `req.params`: raw pathname substrings, never percent-decoded or normalised, in both matchers. The
  default parameter pattern excludes the literal separators `.`, `/` and `\`, but their encoded forms
  (`%2e`, `%2f`, `%5c`) and `%00` are ordinary text to it. A handler that decodes a parameter must
  decode-then-validate; a match is not sanitisation. (README, "Input bounds" section.)
- `req.values`: every named control of an intercepted same-origin POST — `hidden`, `password` and
  `file` included — plus the query string on the server path. Last-wins per duplicate key, capped at
  `MAX_VALUES_COUNT` (1024) distinct keys, and populated **before** route selection, so every
  `app.use()` middleware sees it. Telemetry must not serialise it wholesale.

## 6. Page-global mutation

`attach()` patches `history.__proto__.pushState` to mark the location as routed and emit
`statechanged`. It is a page-global hook: a second router instance chains a second wrapper, a script
that captured `pushState` earlier bypasses the marking, and there is no teardown. Accepted for a
single-page router that owns the document; navigation dedup keys off the event pair, not the URL.

## 7. Publish gate (`tools/verify-package.mjs`)

Guarded: registry pinned to `https://registry.npmjs.org/` in npm's own boolean coercion;
`files[]` literal and covering the shipped source; `prepublishOnly` exactly
`npm test && npm run verify:package`; no unallowlisted lifecycle hooks; no unallowlisted
`publishConfig` key; every remote lockfile entry with `resolved` on the pinned host and an
`integrity` value.

Not guarded, and deliberately so: integrity values are **shape-checked only** — the gate never
recomputes SRI over installed bytes (`leviroutes-e0f`). Dependency advisories are not part of the
publish chain (`leviroutes-e0f`): the gate must answer offline and deterministically, and advisories
are tracked by the nightly deps-supply-chain station as beads.

## 8. Invariants a change must preserve

1. Every untrusted path keeps a hard length or iteration cap applied *before* the work, not after
   (`MAX_PATTERN_LENGTH`, `MAX_PATH_LENGTH`, `MAX_URL_LENGTH`, `MAX_VALUES_COUNT`,
   `MAX_EXPANDED_RUNS`).
2. Any admission or exemption added to the ReDoS filter ships with a measured worst case for the newly
   admitted shape; "linear in theory" is not evidence.
3. `params` and `values` are null-prototype objects; no untrusted key is written to a normal object or
   a prototype.
4. A handler or middleware throw on the server path never leaves the response unwritten and never
   reaches `uncaughtException`; a duplicate `next()` never runs the callback twice.
5. Browser form interception intercepts same-origin POSTs only, and calls `preventDefault()` before
   rethrowing.
6. Nothing in the publish path can be redirected or silenced without the gate failing: registry,
   lifecycle hooks, `publishConfig`, entry points, `files[]`.

## 9. Accepted exclusions (do not re-file these as vulnerabilities)

- **Matching is host-agnostic.** `pathnameOf` strips the origin and `dispatch()` does not validate
  host or scheme (documented in the README). Apps needing tenant isolation check `req.url` themselves.
- **No authn/authz, sessions, CSRF, body parsing or rate limiting.** Out of scope for a router.
- **Quadratic admission.** Two adjacent ambiguous unbounded atoms are allowed on purpose (§3).
- **Runtime budget is bounded, not enforced.** There is no per-request timeout; the caps in §8.1 are
  the control (`leviroutes-esva`).
- **Publish-gate integrity is shape-only.** Tracked by `leviroutes-e0f`, not a regression.
- **Dependency advisories** for `jasmine`/`jsdom` and their transitive dev tree are out of the publish
  chain by design (`leviroutes-e0f`); the nightly deps station tracks them.
- **User/global `.npmrc` layers** are only readable when npm exports their paths
  (`leviroutes-grg4`); the documented mitigation is a plain `npm publish` with no `--registry` or
  `--ignore-scripts` override.
- **Spec-suite loopback servers and fixture route patterns** are trusted test code.
- **Errors thrown from timers or promises the handler creates itself** are outside the middleware
  chain and still reach `uncaughtException` (documented in the README).
