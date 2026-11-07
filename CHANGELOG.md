# Changelog

All notable changes to LeviRoutes. This project follows [Semantic Versioning](https://semver.org/):
`MAJOR` for a change that can break an existing route table, `MINOR` for new opt-in surface,
`PATCH` for fixes that keep every documented route string working.

## [2.0.0] - 2026-11-07

The release that makes route strings mean what they say: a route now matches **its own path**, not
every path that happens to end with it. That is a deliberate, breaking correction to how 1.x
matched routes, so the next publish is a major version. npm still serves `1.0.0` (published
2025-12-30); this entry describes the next publish and the release notes for anyone tracking `main`.

**Reviewed decision:** `leviroutes-a1u`. The anchoring change itself landed earlier
(`leviroutes-hiw`, commit `3739154`) with its own bead explicitly deferring the release contract to
this one; the owner approved `2.0.0` plus these notes.

### Changed (breaking)

* **Route matching is anchored at the start *and* the end of the pathname** (`leviroutes-hiw`,
  `3739154`). 1.x compiled every route to a suffix match, so `/user/:id` also matched
  `/deep/user/42` and `/` also matched `/anything/`. A route now matches its own path only.
* **A top-level alternation anchors as a whole route** (`leviroutes-bym`, `30a06db`). Routes
  compile as `^(?:…)$`, so `/index.html|/` accepts `/index.html` and `/` but no longer accepts
  `/x/` — previously the `|` split the anchors and the second alternative matched any trailing slash.
* **A literal `.` in a route is a literal dot, not "any character"** (`leviroutes-hiw`,
  `leviroutes-np4`). `/:category.:format` now means a dot; `9cc8783` additionally stopped
  double-escaping dots the author had already escaped (`/a\.b` matches `/a.b`).
  This also means a `.*` written inside a 1.x route is now "a literal dot, zero or more times", so
  `/.*` matches `/` and nothing else — a catch-all has to be written `/[^]*` (see the migration table).

### Added

* **Server-side dispatch** (`leviroutes-yx0`, `c839f9d`): `router.dispatch(request, response)` routes a
  Node `http.IncomingMessage`, a Web Fetch `Request`, or a URL string through the same route table,
  honouring the method each route was registered with. `HEAD` is routed to the matching `get()`
  handler per RFC 9110; `dispatch()` returns `false` when nothing matches so a server can send its own
  fallback. `req` gains `method`, `request`, `response` and query-string-derived `values`.
* **Opt-in URL Pattern matcher** (`leviroutes-5z6`, `dc5a87b`): `new routes({ matcher: "urlpattern" })`
  compiles routes with the [URL Pattern API](https://developer.mozilla.org/en-US/docs/Web/API/URLPattern),
  so dotted segments (`/files/:name` matching `/files/report.pdf`) and regex groups work. Default is
  unchanged; see the README table for the differences. Available natively in current browsers and
  Node 24+.
* **`next.abort()` for browser and server middleware** (`leviroutes-g2b`, `6707079`): a middleware can
  hand the request back to the caller. On the server it returns `false` from `dispatch()` only before
  response headers are committed, and a late `next()` after abort cannot invoke the route handler. A
  route that already executed stays handled (`leviroutes-foa`, `0f21138`).
* **Custom regex groups after named parameters** (`leviroutes-*`, `34d124c`…`9864a0a`), e.g.
  `app.get("/books/:id(\\d+)")`, including nested/non-capturing groups and hyphenated names. A
  parameter pattern with no capturing group is rejected when the route is registered.
* `req.params` and `req.values` are created with a null prototype (`leviroutes-pv2`, `69852f3`), so a
  route name such as `constructor` cannot reach `Object.prototype`.

### Fixed

* A route handler that throws during a form submit no longer lets the browser perform the native POST
  (`leviroutes-303`, `6f50f97`): the submit is always intercepted, and the error is still rethrown.
* Back/Forward navigation past two history entries that share a URL now fires its route
  (`leviroutes-s8o`, `7e4ac6b`): navigation events are deduplicated by event kind rather than by
  location.
* Escaped dots in route text are no longer double-escaped (`leviroutes-np4`, `9cc8783`).
* The example pages now declare doctype, charset, viewport and `lang`, submit the SPA contact form to
  a dedicated action path, and register directory base paths for `pushState` navigation
  (`leviroutes-*`, `d0f5e26`, `8452532`, `137d07e`).
* The publish gate is real again (`leviroutes-53r`, `leviroutes-aou`): `prepublishOnly` now runs
  `npm test && npm run verify:package && npm run build`, so a publish cannot ship untested code or a
  stale `dist/routes.min.js`.

### Migrating from 1.x

Route tables that relied on 1.x's suffix matching need one explicit line each. Nothing else changes:
middleware, parameters, `popstate`/form interception and the `new routes()` API are the same. Every
row below was checked against both `1.0.0` and this tree with `app.test()`.

| 1.x route | 1.x matched | 2.0.0 matches | Migrate to |
| --- | --- | --- | --- |
| `app.get("/user/:id")` | `/user/42`, also `/deep/user/42` | `/user/42` only | name the full path: `/deep/user/:id` |
| `app.get("/")` | `/`, and every path ending in `/` (`/anything/`) | `/` only | a catch-all is `app.get("/[^]*")`; "any path ending in a slash" is `app.get("/[^]*\\/")` |
| any 1.x route containing `.*` | "any characters" | literal dots, zero or more (`/.*` matches only `/`) | replace `.*` with `[^]*`: `/[^]*`, `/[^]*-:id` |
| `app.get("/:category.:format")` | `/foo.json`, and `/fooXjson` (`.` = any character) | `/foo.json` only (`.` = dot) | if you truly meant "any character", `app.get("/:category([^/.]+)[^/]json")` (or the `urlpattern` matcher); almost always the literal dot is what you wanted |
| `app.get("/index.html\|/")` | `/index.html`, `/`, and `/x/` | `/index.html` and `/` | nothing — `/x/` was the bug |
| `app.get("/foo+")` | regex quantifier | regex quantifier (unchanged) | — |

Catch-alls are the one case where the default matcher is now clumsy: because every unescaped `.` in a
route is literal, `[^]*` ("any character, any number of times") is how you spell one. If you need
segment-shaped wildcards, the opt-in `matcher: "urlpattern"` mode is the supported route forward; see
[`docs/urlpattern-investigation.md`](docs/urlpattern-investigation.md).

If you cannot change the route strings yet, stay on `1.0.0`.

Routes are exercised by `app.test(path)`, `dispatch()` and form interception alike, so `app.test()` is
the quickest way to confirm a migrated route behaves: register your table, call `app.test()` for the
paths you care about, and compare before and after the upgrade.

## [1.0.0] - 2025-12-30

* First npm release as an ES module (`00db992`): `src/routes.js` plus a minified
  `dist/routes.min.js`, `popstate` routing, named parameters, middleware and form (POST) interception.
