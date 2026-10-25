/*
 * Server-side dispatch (GH #1): the same routes() instance routes Node
 * http.IncomingMessage objects, Web Fetch Requests, and plain URL strings,
 * with method-aware matching and query-string values.
 */
import routes from '../src/routes.js';
import http from 'node:http';

describe("server dispatch", function() {
  var r;
  beforeEach(function() {
    r = new routes();
  });

  it("should route an http.IncomingMessage-like object to a matching get route", function() {
    var seen = null;
    r.get("/user/:id", function(req) { seen = req; });

    var incoming = { url: "/user/42", method: "GET" };
    var matched = r.dispatch(incoming);

    expect(matched).toEqual(true);
    expect(seen.params.id).toEqual("42");
    expect(seen.method).toEqual("get");
    expect(seen.url).toEqual("/user/42");
    expect(seen.request).toBe(incoming);
  });

  it("should route a Fetch Request using its absolute URL's pathname", function() {
    var seen = null;
    r.get("/user/:id", function(req) { seen = req; });

    var request = new Request("http://example.com/user/42");
    var matched = r.dispatch(request);

    expect(matched).toEqual(true);
    expect(seen.params.id).toEqual("42");
    expect(seen.method).toEqual("get");
  });

  it("should pass the response object through to the route as req.response", function() {
    var seen = null;
    r.get("/thing", function(req) { seen = req; });

    var response = { writeHead: function() {}, end: function() {} };
    r.dispatch({ url: "/thing", method: "GET" }, response);

    expect(seen.response).toBe(response);
  });

  it("should treat a plain string as a GET request", function() {
    var seen = null;
    r.get("/plain", function(req) { seen = req; });

    expect(r.dispatch("/plain")).toEqual(true);
    expect(seen.method).toEqual("get");
  });

  it("should not match a route registered for a different method", function() {
    var fired = [];
    r.get("/item", function() { fired.push("get"); });
    r.post("/item", function() { fired.push("post"); });

    expect(r.dispatch({ url: "/item", method: "POST" })).toEqual(true);
    expect(fired).toEqual(["post"]);

    expect(r.dispatch({ url: "/item", method: "GET" })).toEqual(true);
    expect(fired).toEqual(["post", "get"]);
  });

  it("should route HEAD to the get handler, reporting the real method", function() {
    var seen = null;
    r.get("/item", function(req) { seen = req; });

    // RFC 9110 s9.3.2: HEAD is GET without the body; Node strips the body itself.
    expect(r.dispatch({ url: "/item", method: "HEAD" })).toEqual(true);
    expect(seen.method).toEqual("head");
  });

  it("should not route HEAD to a post-only route", function() {
    r.post("/item", function() {});

    expect(r.dispatch({ url: "/item", method: "HEAD" })).toEqual(false);
  });

  it("should return false when no route matches, so the server can 404", function() {
    r.get("/exists", function() {});

    expect(r.dispatch({ url: "/missing", method: "GET" })).toEqual(false);
    // A path that exists but only for another method is also a miss.
    expect(r.dispatch({ url: "/exists", method: "POST" })).toEqual(false);
  });

  it("should populate req.values from the query string", function() {
    var seen = null;
    r.get("/search", function(req) { seen = req; });

    r.dispatch({ url: "/search?q=hello&page=2", method: "GET" });

    expect(seen.params).toEqual({});
    expect(seen.values).toEqual({ q: "hello", page: "2" });
  });

  it("should populate req.values from a Fetch Request's query string", function() {
    var seen = null;
    r.get("/search", function(req) { seen = req; });

    r.dispatch(new Request("http://example.com/search?q=hello"));

    expect(seen.values).toEqual({ q: "hello" });
  });

  it("should safely store prototype-named query parameters in req.values without collision", function() {
    var seen = null;
    r.get("/search", function(req) { seen = req; });

    r.dispatch({ url: "/search?hasOwnProperty=true&toString=val&__proto__=pollute", method: "GET" });

    expect(seen.values.hasOwnProperty).toEqual("true");
    expect(seen.values.toString).toEqual("val");
    expect(seen.values.__proto__).toEqual("pollute");
    expect(Object.prototype.hasOwnProperty.call(seen.values, "hasOwnProperty")).toBe(true);
    expect(Object.getPrototypeOf(seen.values)).toBeNull();
  });

  it("should run the middleware chain before the route callback", function() {
    var order = [];
    r.use(function(req, next) { order.push("mw1"); next(); });
    r.use(function(req, next) { order.push("mw2"); next(); });
    r.get("/mw", function() { order.push("route"); });

    r.dispatch({ url: "/mw", method: "GET" });

    expect(order).toEqual(["mw1", "mw2", "route"]);
  });

  it("should preserve route ownership when middleware does not call next immediately", function() {
    var fired = false;
    r.use(function() { /* may call next later, or own the response */ });
    r.get("/guarded", function() { fired = true; });

    expect(r.dispatch({ url: "/guarded", method: "GET" })).toEqual(true);
    expect(fired).toEqual(false);
  });

  it("should return false on explicit abort and ignore late next", function() {
    var fired = false;
    var continueLater;
    r.use(function(req, next) { continueLater = next; next.abort(); });
    r.get("/guarded", function() { fired = true; });

    expect(r.dispatch({ url: "/guarded", method: "GET" })).toEqual(false);
    continueLater();
    expect(fired).toEqual(false);
  });

  it("should retain handled status when middleware aborts after calling next", function() {
    var fired = false;
    r.use(function(req, next) { next(); next.abort(); });
    r.get("/guarded", function() { fired = true; });

    var response = { headersSent: false, writableEnded: false, finished: false };
    expect(r.dispatch({ url: "/guarded", method: "GET" }, response)).toEqual(true);
    expect(fired).toEqual(true);
    expect(r.dispatch("/guarded")).toEqual(true);
  });

  it("should not trigger caller 404 fallback when middleware aborts after executing route", async function() {
    r.use(function(req, next) {
      next();
      next.abort();
    });
    r.get("/handled-abort", function(req) { req.response.end("handled ok"); });
    var handled;
    var server = http.createServer(function(request, response) {
      handled = r.dispatch(request, response);
      if (!handled) { response.statusCode = 404; response.end("Fallback 404"); }
    });

    try {
      await new Promise(function(resolve) { server.listen(0, "127.0.0.1", resolve); });
      var result = await fetch("http://127.0.0.1:" + server.address().port + "/handled-abort");
      expect(handled).toEqual(true);
      expect(result.status).toEqual(200);
      expect(await result.text()).toEqual("handled ok");
    } finally {
      await new Promise(function(resolve) { server.close(resolve); });
    }
  });

  it("should return true when middleware stops after ending the response", function() {
    var fired = false;
    var response = {
      writableEnded: false,
      end: function() { this.writableEnded = true; }
    };
    r.use(function(req, next) { req.response.end("Denied"); next.abort(); });
    r.get("/guarded", function() { fired = true; });

    expect(r.dispatch({ url: "/guarded", method: "GET" }, response)).toEqual(true);
    expect(response.writableEnded).toEqual(true);
    expect(fired).toEqual(false);
  });

  it("should keep ownership after headers are committed, even if the body is incomplete", function() {
    var response = { headersSent: true, writableEnded: false };
    r.use(function(req, next) { next.abort(); });
    r.get("/guarded", function() {});

    // A caller fallback cannot safely change the status or append to a streamed body.
    expect(r.dispatch({ url: "/guarded", method: "GET" }, response)).toEqual(true);
  });

  it("should make next.abort available on the browser routing path", function() {
    var fired = false;
    r.use(function(req, next) { next.abort(); });
    r.get("/private", function() { fired = true; });

    expect(function() { r.test("/private"); }).not.toThrow();
    expect(fired).toEqual(false);
  });

  it("should allow deferred next without triggering the caller's fallback", async function() {
    r.use(async function(req, next) {
      await new Promise(function(resolve) { setTimeout(resolve, 5); });
      next();
    });
    r.get("/slow", function(req) { req.response.end("slow ok"); });
    var handled;
    var server = http.createServer(function(request, response) {
      handled = r.dispatch(request, response);
      if (!handled) { response.statusCode = 404; response.end("Fallback"); }
    });

    try {
      await new Promise(function(resolve) { server.listen(0, "127.0.0.1", resolve); });
      var result = await fetch("http://127.0.0.1:" + server.address().port + "/slow");
      expect(handled).toEqual(true);
      expect(result.status).toEqual(200);
      expect(await result.text()).toEqual("slow ok");
    } finally {
      await new Promise(function(resolve) { server.close(resolve); });
    }
  });

  it("should match with the urlpattern matcher too", function() {
    if (typeof URLPattern === "undefined") return;
    var up = new routes({ matcher: "urlpattern" });
    var seen = null;
    up.get("/user/:id", function(req) { seen = req; });

    up.dispatch(new Request("http://example.com/user/7"));

    expect(seen.params.id).toEqual("7");
  });

  it("should throw a named error for an undispatchable argument", function() {
    expect(function() { r.dispatch(null); }).toThrowError(/dispatch\(\) needs a URL string/);
    expect(function() { r.dispatch(42); }).toThrowError(/dispatch\(\) needs a URL string/);
  });

  it("should leave browser matching method-agnostic", function() {
    // The pre-dispatch contract: the browser paths (test/run/popstate/submit)
    // match a URL regardless of the method the route was registered with.
    var fired = [];
    r.get("/both", function() { fired.push("get"); });
    r.post("/both", function() { fired.push("post"); });

    r.test("/both");

    // First match wins; the point is that the get route is not skipped.
    expect(fired).toEqual(["get"]);
  });
});
