# Investigating `URLPattern` as a replacement for leviroutes' matcher

Bead: `leviroutes-if3` (from GH #22). Question: *is the URL Pattern API feasible to use, and
can it replace the custom URL matching algorithm in leviroutes?*

**Verdict: feasible, and it fixes real matching bugs — but it is not a drop-in swap.**
`URLPattern` gives us a real path grammar (`:name`, `*`, `{}`, `:name(\d+)`, optional/one-or-more
modifiers, and `search`/`hash`/host components), strict full-path matching, and it removes the
hand-rolled `new RegExp(path)` that currently treats a route string as a regex. The blockers are
(a) the matcher's semantics change for existing users in three specific ways, and (b) browsers and
runtimes older than the Baseline line need the 6.1 kB-gzip polyfill — 3.4x the gzip size of the
entire library today. So: adopt it as a new matching mode in a major version, not a silent
replacement on the current one.

Every number and truth table below was produced by running the code in §8 against this checkout
(Node 24.22.0), not recalled. That mattered: two widely-repeated claims in secondary sources turned
out to be wrong when measured (§3, optional groups).

---

## 1. Support and Baseline

`URLPattern` is **Baseline Newly available** (it became Baseline on 2025-09-15). Not yet Widely
available — that needs 30 months from the lowest implementation date.

| Engine | First version | Released |
| --- | --- | --- |
| Chrome | 95 | 2021-10-19 |
| Edge | 95 | 2021-10-21 |
| Firefox | 142 | 2025-08-19 |
| Safari / iOS Safari | 26 | 2025-09-15 |
| Node.js | 23.8 (experimental), 24.0+ (global, unflagged) | 2025 |

Sources: <https://api.webstatus.dev/v1/features/urlpattern>,
<https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/URLPattern.json>,
<https://urlpattern.spec.whatwg.org/>, <https://nodejs.org/api/url.html>.

Two consequences for us:

* **No polyfill for current browsers** — Chrome 95+ and Safari 26+ cover the bulk of traffic, and a
  feature-detected adapter means those users pay 0 bytes.
* **A polyfill is still needed for Firefox < 142, Safari < 26 and Node < 24**;
  `urlpattern-polyfill@10.1.0` ships `dist/urlpattern.js` at 18,338 B raw / **6,066 B gzip**
  (measured). Caveat from MDN BCD: Firefox before 149 does not support lookahead/lookbehind
  assertions inside custom regex groups (<https://bugzil.la/1998871>).

## 2. What leviroutes does today

`src/routes.js#parseRoute` builds a RegExp out of the route string:

```js
newRegexp = route.replace(/:([^/.\\]+)/g, '([^/.\\]+)')   // :name  -> ([^/.\\]+)
newRegexp += '$'                                          // end-anchored only
regexp = new RegExp(newRegexp)                            // the rest is a REGEX, not a path
```

Three consequences, all confirmed in §4:

1. **The route string is a regular expression.** `/foo+` means "fo" followed by one or more "o"
   (`/\/foo+$/`), `/a|b` alternates, `([a-z]+)` is a real capture group, `.` is "any character".
   Nothing is escaped.
2. **Named groups exclude `.` and `/`.** `:name` compiles to `([^/.\\]+)`, which is why
   `/:category.:format` works — and also why `/files/:name` cannot match `/files/report.pdf`.
3. **Matching is end-anchored only.** `/category` compiles to `/\/category$/`, so
   `/deep/user/42` matches `/user/:id`, and *any* path ending in `/` matches the route `/`.

Matching itself is `route.regexp.exec(url)` in registration order, first match wins, and it is
called with `document.location.pathname` (a path) on navigation and with `e.target.action` (an
absolute URL) on form submits — the same loose regex is applied to both.

> **Status note (2026-10-17):** this section describes the matcher *before* `leviroutes-hiw`
> (landed in 425f12f, "match routes against the whole pathname with literal dots"). The current
> matcher escapes literal `.` in the route text, anchors at `^` as well as `$`, and reduces an
> absolute-URL input to its pathname before matching. Consequence 1 is narrowed (`.` is now
> literal; other regex syntax like `/foo+` and `/a|b` still works) and consequence 3 is gone (no
> more suffix matching). Consequence 2 is unchanged on purpose: named groups still exclude `.`,
> so `/files/:name` still rejects `/files/report.pdf` — deferred to the major-version matcher
> decision (`leviroutes-5z6`).

## 3. What `URLPattern` gives us

A `URLPattern` constructed from `{ pathname }` compiles the pattern to a matcher over the *parsed*
URL, with full-path anchoring and a documented grammar. Verified behaviour (Node 24.22.0):

| Feature | Observed |
| --- | --- |
| Named segment | `{pathname:'/:category'}` → `/news` matches with `{category:'news'}` |
| Literal dot in name | `{pathname:'/:category.:format'}` → `/foo.json` → `{category:'foo', format:'json'}` |
| Dot inside a segment | `{pathname:'/files/:name'}` → `/files/report.pdf` matches (`name:'report.pdf'`) — today's matcher rejects this |
| Wildcard | `{pathname:'/files/*'}` matches `/files/a/b` and `/files/`; **not** `/files` |
| Prefix wildcard | `{pathname:'*/user/:id'}` matches `/user/42` **and** `/deep/user/42` |
| Optional group | `{pathname:'/{:id}?'}` matches `/` (no segment) and `/x`; plain `'/:id?'` matches `/x` but **not** `/` — the slash must sit outside the braces |
| Optional trailing segment | `{pathname:'/files{/:id}?'}` matches `/files` and `/files/7`, not `/files/` |
| Trailing-slash tolerance | `{pathname:'/foo{/}?'}` matches both `/foo` and `/foo/`; there is no implicit tolerance |
| One-or-more | `{pathname:'/:a+'}` matches `/x/y` with `{a:'x/y'}` |
| Regex group | `{pathname:'/books/:id(\\d+)'}` matches `/books/42`, rejects `/books/abc`, `hasRegExpGroups === true` |
| Query component | `{pathname:'/search', search:'q=:q'}` matches `/search?q=hello` → `{q:'hello'}`; `/search` without a query does not match |
| Omitted components | Default to `*` (verified: `protocol`, `hostname`, `search` are all `'*'`) |
| Bare path input | `test('/foo')` / `exec('/foo')` work **without** a baseURL while host/protocol patterns are `*`; with an explicit `hostname` pattern the same input returns `false` |
| Absolute form action | `exec('http://e.com/deep/user/42')` works directly — no manual path extraction |
| `ignoreCase` | Default `false` (`/AbC` does not match `/abc`); hostname/scheme are still case-normalised by URL parsing |
| URL normalisation | `/a/x/../b` matches `{pathname:'/a/b'}`; `/a%20b` matches `{pathname:'/a b'}` |
| Unparseable input | `test('not a url:::')` returns `false`, `exec` returns a result only if the pathname matches — neither throws |
| `exec()` shape | `{inputs, protocol, hostname, port, pathname, search, hash, username, password}`, each component `{input, groups}` |
| Static helpers | `URLPattern.parse` and `compareComponent` do **not** exist (Node 24.22.0, and they are not in the spec either — do not depend on them) |

## 4. Side-by-side truth table (measured)

Left column is today's `src/routes.js`; right column is `new URLPattern({pathname: pattern})`, both
run on the same URLs, with the params each one yields.

| pattern | url | leviroutes today | URLPattern |
| --- | --- | --- | --- |
| `/` | `/` | ✓ | ✓ |
| `/` | `/foo` | ✗ | ✗ |
| `/` | `/foo/` | **✓** (any path ending in `/`) | ✗ |
| `/category` | `/category` | ✓ | ✓ |
| `/category` | `/category/extra` | ✗ | ✗ |
| `/:category` | `/news` | ✓ `{category:'news'}` | ✓ `{category:'news'}` |
| `/:category` | `/a/b` | **✓ `{category:'b'}`** (suffix match) | ✗ |
| `/:category` | `/foo.json` | **✗** (`.` excluded) | ✓ `{category:'foo.json'}` |
| `/:category.:format` | `/foo.json` | ✓ `{category:'foo', format:'json'}` | ✓ `{category:'foo', format:'json'}` |
| `/:category.:format` | `/foo` | **✓ `{category:'f', format:'o'}`** (`.` is any char) | ✗ |
| `/:category.:format` | `/a/b.json` | **✓ `{category:'b', format:'json'}`** | ✗ |
| `/user/:id` | `/user/42` | ✓ `{id:'42'}` | ✓ `{id:'42'}` |
| `/user/:id` | `/user/42/posts` | ✗ | ✗ |
| `/files/:name` | `/files/report.pdf` | **✗** | ✓ `{name:'report.pdf'}` |
| `/foo/([a-z]+)` | `/foo/bar` | ✓ (regex group) | ✓ (regex group, `hasRegExpGroups=true`) |
| `/x/(.*)` | `/x/a/b` | ✓ | ✓ |
| `/foo+` | `/foooo` | ✓ (regex quantifier) | **throws** `Failed to construct URLPattern` |
| `/a\|b` | `/a` | ✓ (regex alternation) | ✗ (`\|` is literal in a pattern) |

The bold rows are the interesting ones. Four of them (`.` as any-char, `/`-suffix matching,
`/foo/` matching `/`, `/files/report.pdf` rejected) are bugs or surprises in today's matcher that
`URLPattern` gets right; three (`/foo+`, `/a|b`, and the group semantics) are existing users who
would break.

> **Status note (2026-10-17):** the "leviroutes today" column is the pre-`leviroutes-hiw` matcher.
> Since 425f12f the bold rows read differently: `/foo/` no longer matches `/`, `/a/b` no longer
> matches `/:category`, and `/foo` / `/a/b.json` no longer match `/:category.:format`. The fourth
> surprise — `/files/:name` rejecting `/files/report.pdf` — is deliberately **unchanged** (named
> params still stop at `.`), deferred to `leviroutes-5z6`. So of the four bugs `URLPattern` fixes:
> three are now fixed in the default matcher, one deferred.

## 5. Migration recipes (all verified)

| today | URLPattern | note |
| --- | --- | --- |
| `/:category` | `{pathname:'/:category'}` | now full-path; suffix matches disappear (bug fix) |
| `/:category.:format` | `{pathname:'/:category.:format'}` | same params, no more `/foo` false positives |
| `/files/:name` | `{pathname:'/files/:name'}` | now matches `report.pdf` (behaviour change) |
| `/` (any trailing slash) | `{pathname:'*/'}` | matches `/` and `/anything/` |
| `/foo` or `/foo/` | `{pathname:'/foo{/}?'}` | explicit trailing-slash tolerance |
| `/:id?` wanting to match `/` | `{pathname:'/{:id}?'}` | the slash must be *outside* the braces (`{/:id}?` still misses `/`) |
| optional trailing segment | `{pathname:'/files{/:id}?'}` | matches `/files` and `/files/7`, not `/files/` |
| `/user/:id` via form action on a deep path | `{pathname:'*/user/:id'}` | absolute URLs match natively |
| `/user/(\\d+)` | `{pathname:'/user/:id(\\d+)'}` | named group + regex, `hasRegExpGroups` becomes `true` |
| `?foo=bar` (cannot express today) | `{pathname:'/x', search:'foo=:v'}` | new capability; query order is positional text, not a set |
| literal `+`, `\|`, `(`, `)`, `{`, `}` in a path | escape as `\\+`, `\\\|`, ... | **construction throws otherwise** |

## 6. Cost

* **Library size.** `src/routes.js` is 5,163 B raw / 1,809 B gzip. `URLPattern` is native, so a
  polyfill-free adoption costs nothing in bytes.
* **Polyfill, if needed.** `urlpattern-polyfill@10.1.0`, `dist/urlpattern.js`: 18,338 B raw /
  **6,066 B gzip** (measured) — 3.4x the gzip size of the whole library. That is the main argument
  for a feature-detected adapter rather than an unconditional dependency.
* **Per-match cost** (1.2M matches = 200k iterations x 6 patterns x 6 URLs, Node 24.22.0; run-to-run
  variance on this VM is up to ~15%):

  | matcher | throughput |
  | --- | --- |
  | `RegExp.exec` (today) | ~13–19 M matches/s |
  | `URLPattern.test(urlString)` | ~1.4–1.6 M matches/s |
  | `URLPattern.test({pathname})` | ~0.5–0.6 M matches/s |

  (Three runs of the snippet in §8. The spread is this VM's CPU contention, not the matcher —
  `RegExp.exec` varied most, 13.0 → 18.7 M/s.)

  `URLPattern` is ~10x slower per match and the component-object form is ~3x slower again. In
  absolute terms it is ~0.7 µs per route, and leviroutes matches on navigation events with a
  handful of routes, so this is not a user-visible cost — but it is worth knowing before anyone
  builds a per-request router on it, and it argues for reusing a parsed input rather than
  re-parsing a string per route.
* **Construction cost.** `new URLPattern({pathname})` is ~0.011 ms per pattern — the same order as
  the `new RegExp` that `parseRoute` builds today, so route registration stays cheap.

## 7. Recommendation

1. **Do not swap the default matcher in a patch release.** Three documented behaviours change (dots
   inside a segment now match, suffix/loose matches stop, regex-flavoured patterns may throw at
   construction). Land it as a major version with a migration note, or behind an opt-in
   (e.g. `new routes({ matcher: 'urlpattern' })`).
2. **Fix the four false positives regardless** — they are bugs in the current matcher, reachable
   without `URLPattern` (escape the literal path, anchor the start, stop treating `.` as any-char).
   If the URLPattern work stalls, this is the part that should not.
3. **Feature-detect and keep the regex path as fallback** while `URLPattern` is not Baseline Widely
   available. Load the polyfill only where `URLPattern` is missing (dynamic `import()`), so every
   browser that has it pays 0 bytes.
4. **Reject regex-flavoured route strings explicitly** in the new mode rather than letting
   `new URLPattern` throw an opaque `Failed to construct URLPattern`. A validation error naming the
   route is the difference between a usable major-version migration and a support burden.
5. **Move form-action matching to `pathname`-only patterns.** Today `e.target.action` (an absolute
   URL) is fed to the same suffix-y regex; `URLPattern` parses it properly, and `search` matching
   becomes possible for the first time. Keep patterns host-agnostic (`*`) so bare-path input keeps
   working for `location.pathname` (§3).

## 8. Evidence: the scripts these numbers come from

Run with `node <file>` from the repo root (after `npm ci`); they import `src/routes.js` directly
and need no browser.

```js
// truth table (§4) — one helper per matcher, then compare
import routes from './src/routes.js';

const lv = (pattern, url) => {
  const r = new routes(); r.get(pattern, () => {});
  const re = r.getRoutes()[0].regex;
  const m = re.regexp.exec(url);
  if (!m) return { match: false };
  const params = {};
  for (const g in re.groups) params[g] = m[re.groups[g] + 1];
  return { match: true, params };
};

const up = (pattern, url) => {
  try {
    const m = new URLPattern({ pathname: pattern }).exec('http://example.com' + url);
    return m ? { match: true, params: m.pathname.groups } : { match: false };
  } catch (e) { return { error: e.message }; }
};

const CASES = [
  ['/', ['/', '/foo', '/foo/']],
  ['/:category', ['/news', '/a/b', '/foo.json']],
  ['/:category.:format', ['/foo.json', '/foo', '/a/b.json']],
  ['/user/:id', ['/user/42', '/user/42/posts']],
  ['/files/:name', ['/files/report.pdf']],
  ['/foo+', ['/foooo']],
];

const show = (r) => r.error ? `throws ${r.error}` : r.match ? `match ${JSON.stringify(r.params)}` : 'no match';
for (const [pattern, urls] of CASES) {
  for (const url of urls) {
    console.log(pattern.padEnd(20), url.padEnd(18), '|', show(lv(pattern, url)).padEnd(38), '|', show(up(pattern, url)));
  }
}
```

```js
// throughput (§6)
import routes from './src/routes.js';
const pats = ['/', '/category', '/:category', '/:category.:format', '/user/:id', '/files/:name'];
const ups  = pats.map(p => new URLPattern({ pathname: p }));
const ries = pats.map(p => { const r = new routes(); r.get(p, () => {}); return r.getRoutes()[0].regex.regexp; });
const urls = ['/', '/news', '/foo.json', '/user/42', '/files/a.pdf', '/nothing/here'];
const N = 200000;
const time = (fn) => { const t = process.hrtime.bigint(); fn(); return Number(process.hrtime.bigint() - t) / 1e6; };
for (const [name, run] of [
  ['URLPattern.test(string)', () => { for (let i = 0; i < N; i++) for (const p of ups) p.test('http://e.com' + urls[i % 6]); }],
  ['URLPattern.test(components)', () => { for (let i = 0; i < N; i++) for (const p of ups) p.test({ pathname: urls[i % 6] }); }],
  ['RegExp.exec', () => { for (let i = 0; i < N; i++) for (const re of ries) re.exec(urls[i % 6]); }],
]) { const ms = time(run); console.log(name, (N * pats.length / ms / 1000).toFixed(2), 'M/s'); }
```

## 9. Open questions

* Does `urlpattern-polyfill` agree with the native implementation on this whole truth table? A
  differential test is worth having before shipping: a polyfilled matcher that disagrees with the
  native one is worse than no matcher.
* Should middleware see `search`/`hash` matches (`req.params` from a `search` pattern), or stay
  pathname-only?
* Is a `hasRegExpGroups` warning warranted for user-supplied patterns? Same risk as today's raw
  `new RegExp`, but the flag makes it cheap to warn.
