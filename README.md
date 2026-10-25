LeviRoutes
==========

> **⚠️ DISCLAIMER:** This project has not been updated or maintained for a long time. While I might add more features in the future, please do not rely on this project for production use or active development.

A simple lightweight routes framework for hooking in to HTML5 history.  Currently when the system pop's state the route is triggered if matched.

LeviRoutes can also intercept POST requests via forms, the framework will intercept all submits, and naturally let through requests that don't match the path, whilst firing your callback if there is a match

## Installation

Install via npm:

```bash
npm install leviroutes
```

Or use it directly from a CDN with ES modules:

```html
<script type="module">
  import routes from 'https://esm.sh/leviroutes';
  
  const app = new routes();
  // ... use the library
</script>
```

## Usage

### ES Modules (Recommended)

```javascript
import routes from 'leviroutes';

const app = new routes();

app.get("/", function(req) {
  alert("State popped for /");
});
```

### Classic Script Tag

```html
<script type="module">
  import routes from './node_modules/leviroutes/src/routes.js';
  
  const app = new routes();
  // ...
</script>
```

## Features

### Basic Routing

```javascript
const app = new routes();

app.get("/", function(req) {
  alert("State popped for /");
});
```

### Named Parameters

It also has named parameters for route syntax.

```javascript
app.get("/:category", function(req) {
  alert("In " + req.params.category);
});

app.get("/:category.:format", function(req) {
  alert("format: " + req.params.format);
});
```

### Route matching

A route is matched against the **whole pathname**, and a literal `.` in a route is a literal dot:

* `/user/:id` matches `/user/42` but not `/deep/user/42`, and `/` matches only `/` (not `/anything/`).
* `/:category.:format` matches `/foo.json` (`category: "foo"`, `format: "json"`) but not `/foo`.
* A named parameter stops at `/` and `.`, so `/files/:name` does not match `/files/report.pdf` -
  use `/files/:name.:ext`.
* Form actions resolve to absolute URLs; the pathname is matched, so `action="http://other.test/test"`
  reaches `app.post("/test")` while `action="http://other.test/deep/test"` does not.

The rest of a route string is still treated as regular-expression syntax (`/foo+`, `/a|b`) by the
default matcher.

### Optional: the URL Pattern matcher

`new routes({ matcher: "urlpattern" })` compiles routes with the
[URL Pattern API](https://developer.mozilla.org/en-US/docs/Web/API/URLPattern) instead. It is
opt-in because it changes matching semantics; the default is unchanged.

```javascript
const app = new routes({ matcher: "urlpattern" });

app.get("/files/:name", function(req) {
  // /files/report.pdf now matches: URL Pattern segments may contain dots
  console.log(req.params.name); // "report.pdf"
});

app.get("/books/:id(\\d+)", function(req) {
  // regex groups, optional groups and wildcards are available
});
```

Differences from the default matcher:

| | default (`regexp`) | `urlpattern` |
| --- | --- | --- |
| `/:category` vs `/foo.json` | no match (segment excludes `.`) | match (`foo.json`) |
| `/files/:name` vs `/files/report.pdf` | no match | match |
| trailing slash | `/foo` and `/foo/` are different routes | same; use `/foo{/}?` to accept both |
| `/foo+` | regex quantifier | **throws** — name the route in the error and escape literals |
| optional segment | not expressible | `/files{/:id}?` |

The API is available natively in current browsers and in Node 24+; elsewhere load
[`urlpattern-polyfill`](https://github.com/kenchris/urlpattern-polyfill) before registering routes.
The constructor does not check for the API: the first `get()`/`post()` is what throws a message
saying so. Matching is still on the
pathname, and only named groups become `req.params`. See
[`docs/urlpattern-investigation.md`](docs/urlpattern-investigation.md) for the measurements behind
this and the migration plan.

### POST Request Handling

LeviRoutes can also intercept POST requests via forms, intercept all submits, and naturally let through requests that don't match the path, whilst firing your callback if there is a match.

```javascript
app.post("/:category", function(req) {
  alert("posting form: In Category " + req.params.category);
});
```

## Middleware Support

LeviRoutes supports middleware functions that execute before route handlers. Middleware functions receive the request object and a `next` callback.

```javascript
app.use(function(req, next) {
  console.log("Request to: " + req.url);
  next(); // Call next to continue to the next middleware or route handler
});

app.use(function(req, next) {
  req.timestamp = Date.now();
  next();
});

app.get("/", function(req) {
  alert("Request timestamp: " + req.timestamp);
});
```

Middleware functions are executed in the order they are registered, before any route handler is called.

## Server-side dispatch (Node.js)

The same route table works on the server. `dispatch()` routes a Node
`http.IncomingMessage`, a Web Fetch [`Request`](https://developer.mozilla.org/en-US/docs/Web/API/Request),
or a plain URL string, honouring the method each route was registered with. It returns `true` when a route matches, including when middleware will call `next()` later.
It returns `false` when no route matches, or when server middleware explicitly
calls `next.abort()` before `dispatch()` returns without committing response
headers, so your server can send its own fallback response. If the route handler
has already executed, `dispatch()` returns `true` even if middleware calls
`next.abort()` afterwards; a late abort cannot un-handle a request whose callback ran.
A middleware that simply omits `next()` still owns the request; `dispatch()` cannot
distinguish that from an asynchronous continuation while returning a synchronous boolean.

```javascript
app.use(function(req, next) {
  if (req.url === "/private" && !authorized(req)) {
    next.abort(); // Caller sends its fallback response.
    return;
  }
  next();
});
```

After `next.abort()`, a later `next()` cannot invoke the route handler. If the
route handler has executed, the route owns the request and may complete asynchronously.
Similarly, if middleware has already sent headers (even with an unfinished body),
`dispatch()` returns `true`: a fallback would corrupt the response, so middleware
must finish it. The `next.abort()` method also stops the chain on browser routes, without
changing browser navigation behavior. For asynchronous rejection, middleware
must send its own response; aborting after `dispatch()` returns cannot signal
the caller to send a fallback.

```javascript
import http from 'node:http';
import routes from 'leviroutes';

const app = new routes();

app.get("/user/:id", function(req) {
  req.response.writeHead(200, { "Content-Type": "application/json" });
  req.response.end(JSON.stringify({ id: req.params.id }));
});

app.post("/user", function(req) {
  // ...
});

http.createServer(function(request, response) {
  if (!app.dispatch(request, response)) {
    response.writeHead(404);
    response.end("Not found");
  }
}).listen(3000);
```

In dispatch mode the `req` passed to middleware and route callbacks gains:

* `req.method` — the lowercased HTTP method of the request (`"get"`, `"post"`, ...)
* `req.request` / `req.response` — the original objects passed to `dispatch()`
* `req.values` — parsed from the query string (the server equivalent of the
  browser's form-field values)

Routes are registered with `get()` and `post()`. A `HEAD` request is routed to the
matching `get()` handler (RFC 9110: HEAD is GET without the body — write the body
normally and the server runtime strips it); `req.method` is still `"head"`. Other
verbs do not match and `dispatch()` returns `false`.

Browser behaviour is unchanged: `popstate`, form interception and `test()` still
match a URL regardless of the method a route was registered with. Request bodies
are not parsed; stream them from `req.request` inside your route as usual.

## Examples

Check out the [examples](examples/) directory for complete working examples demonstrating:

- **GET Routes**: Basic routing with HTML5 History API
- **POST Routes**: Form interception and handling
- **Middleware**: Multiple middleware functions with request processing
- **Named Parameters**: Dynamic route parameters (e.g., `/user/:id`)
- **Complete SPA**: A full single-page application showcasing all features

To run the examples, start a local web server in the project root and navigate to the examples directory.

## Development

### Running Tests

```bash
npm test
```

### Building

The build process creates a minified version in `dist/routes.min.js`:

```bash
npm run build
```

### URLPattern investigation

[`docs/urlpattern-investigation.md`](docs/urlpattern-investigation.md) assesses the URL Pattern
API as a replacement for the built-in matcher (GH #22): what it would fix, what it would break,
and the measured cost. Short version: feasible, not a drop-in swap.

## License

Licensed under the Apache License, Version 2.0. See the [LICENCE](LICENCE) file for details.
