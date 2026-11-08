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

  // leviroutes-evd: matching reduces an absolute URL to its pathname, so a route says
  // nothing about the host - but req.url stays exactly as the caller supplied it, and
  // nothing validates the origin. A handler that acts on the host must check it.
  it("should keep req.url as the raw URL while matching only its pathname", function() {
    var seen = null;
    r.get("/user/:id", function(req) { seen = req; });

    expect(r.dispatch(new Request("http://other.test/user/42?tab=posts"))).toEqual(true);

    expect(seen.params.id).toEqual("42");
    expect(seen.url).toEqual("http://other.test/user/42?tab=posts");
    expect(seen.values.tab).toEqual("posts");
  });

  it("should not treat the origin of an absolute URL as part of the match", function() {
    var seen = null;
    r.get("/test", function(req) { seen = req; });

    expect(r.dispatch("http://other.test/test")).toEqual(true);
    expect(seen.url).toEqual("http://other.test/test");
    // Same path one level deeper still misses: the pathname is what is anchored.
    expect(r.dispatch("http://other.test/deep/test")).toEqual(false);
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

  it("should collapse duplicate query parameters using last-wins semantics", function() {
    var seen = null;
    r.get("/filter", function(req) { seen = req; });

    r.dispatch({ url: "/filter?tag=first&tag=second&tag=final", method: "GET" });

    expect(seen.values).toEqual({ tag: "final" });
  });

  it("should bound req.values to MAX_VALUES_COUNT distinct keys", function() {
    var seen = null;
    r.get("/bulk", function(req) { seen = req; });

    var params = [];
    for (var i = 0; i < 1100; i++) {
      params.push("k" + i + "=v" + i);
    }
    r.dispatch({ url: "/bulk?" + params.join("&"), method: "GET" });

    expect(Object.keys(seen.values).length).toEqual(1024);
    expect(seen.values["k0"]).toEqual("v0");
    expect(seen.values["k1023"]).toEqual("v1023");
    expect(seen.values["k1024"]).toBeUndefined();
  });

  it("should not match a request target longer than MAX_URL_LENGTH", function() {
    // leviroutes-esva: only the pathname was capped, so the URL parse and query iteration ran on
    // a target of any length (a 400KB target measured 29.7ms of work per request). The whole
    // target is now bounded at 16KB, matching Node's default maxHeaderSize, and an over-long
    // target simply does not match so the caller can fall back.
    var fired = 0;
    r.get("/user/:id", function() { fired++; });

    var handled = r.dispatch({ url: "/user/42?" + "a".repeat(20000), method: "GET" }, { headersSent: false, writableEnded: false });

    expect(handled).toEqual(false);
    expect(fired).toEqual(0);
  });

  it("should stop scanning query parameters at MAX_VALUES_COUNT", function() {
    // The key cap bounded what was stored, not what was iterated. Scanning now stops at the same
    // bound, so a query string with thousands of parameters costs a bounded amount of work.
    var seen = null;
    r.get("/bulk", function(req) { seen = req; });

    var params = [];
    for (var i = 0; i < 2000; i++) {
      params.push("p" + i + "=v");
    }
    var url = "/bulk?" + params.join("&");
    expect(url.length).toBeLessThan(16384);

    r.dispatch({ url: url, method: "GET" });
    expect(Object.keys(seen.values).length).toEqual(1024);
    expect(seen.values["p1023"]).toEqual("v");
    expect(seen.values["p1024"]).toBeUndefined();
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
    r.get("/handled-abort", function(req) {
      // Defer completion so writableEnded/headersSent stay false while dispatch() evaluates
      setTimeout(function() {
        req.response.end("handled ok");
      }, 5);
    });
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

  it("should settle the response with a 500 and still surface a throwing handler", function() {
    // leviroutes-pxcx: the browser submit path is guarded because a throw unwinding past
    // preventDefault() triggered a native POST (leviroutes-303); the server path had no
    // containment, so the throw reached the http listener with the response unwritten.
    var settled = { status: null, ended: false, body: null };
    var response = {
      headersSent: false,
      writableEnded: false,
      finished: false,
      writeHead: function(code) { settled.status = code; this.headersSent = true; },
      end: function(body) { settled.ended = true; settled.body = body; this.writableEnded = true; }
    };
    r.get("/boom", function() { throw new Error("handler blew up"); });

    var escaped = null;
    try {
      r.dispatch({ url: "/boom", method: "GET" }, response);
    } catch (error) {
      escaped = error;
    }

    expect(settled.status).toEqual(500);
    expect(settled.ended).toEqual(true);
    expect(escaped && escaped.message).toEqual("handler blew up");
  });

  it("should contain a throwing middleware the same way", function() {
    var status = null;
    var response = {
      headersSent: false,
      writableEnded: false,
      writeHead: function(code) { status = code; this.headersSent = true; },
      end: function() { this.writableEnded = true; }
    };
    r.use(function() { throw new Error("middleware blew up"); });
    r.get("/boom", function() {});

    expect(function() { r.dispatch({ url: "/boom", method: "GET" }, response); })
      .toThrowError(/middleware blew up/);
    expect(status).toEqual(500);
  });

  it("should not write a 500 over a response whose headers were already sent", function() {
    var writeHeadCalls = 0;
    var response = {
      headersSent: true,
      writableEnded: false,
      writeHead: function() { writeHeadCalls++; },
      end: function() { this.writableEnded = true; }
    };
    r.get("/boom", function() { throw new Error("late failure"); });

    expect(function() { r.dispatch({ url: "/boom", method: "GET" }, response); })
      .toThrowError(/late failure/);
    expect(writeHeadCalls).toEqual(0);
    expect(response.writableEnded).toEqual(false);
  });

  it("should contain a deferred chain throw instead of killing the process", async function() {
    // leviroutes-llq8: a deferred next() is a supported pattern, and a throw from that later
    // frame lands in the TIMER's context - no app-level try/catch around dispatch() can see a
    // rethrow there, so it used to be an uncaughtException (process death) even after the 500 was
    // settled. It must be contained and recorded on the request instead.
    var settled = { status: null, ended: false };
    var incoming = { url: "/boom", method: "GET" };
    var response = {
      headersSent: false,
      writableEnded: false,
      writeHead: function(code) { settled.status = code; this.headersSent = true; },
      end: function() { settled.ended = true; this.writableEnded = true; }
    };
    r.use(function(req, next) { setTimeout(next, 5); });
    r.get("/boom", function() { throw new Error("deferred blow up"); });

    var escaped = null;
    try {
      r.dispatch(incoming, response);
    } catch (error) {
      escaped = error;
    }
    expect(escaped).toBe(null);

    await new Promise(function(resolve) { setTimeout(resolve, 30); });
    expect(settled.status).toEqual(500);
    expect(settled.ended).toEqual(true);
    expect(incoming.error && incoming.error.message).toEqual("deferred blow up");
  });

  it("should contain a rejected async handler", async function() {
    var status = null;
    var incoming = { url: "/async-boom", method: "GET" };
    var response = {
      headersSent: false,
      writableEnded: false,
      writeHead: function(code) { status = code; this.headersSent = true; },
      end: function() { this.writableEnded = true; }
    };
    r.get("/async-boom", async function() { throw new Error("async blow up"); });

    r.dispatch(incoming, response);
    await new Promise(function(resolve) { setTimeout(resolve, 10); });

    expect(status).toEqual(500);
    expect(incoming.error && incoming.error.message).toEqual("async blow up");
  });

  it("should leave the browser path's error behaviour unchanged", function() {
    // dispatch() only contains handlers for server callers; test()/navigation keep propagating,
    // which is what the browser submit path's own try/catch depends on.
    var response = { headersSent: false, writableEnded: false, writeHead: function() {}, end: function() {} };
    r.get("/boom", function() { throw new Error("browser blew up"); });

    expect(function() { r.test("/boom"); }).toThrowError(/browser blew up/);
    expect(response.writableEnded).toEqual(false);
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
