/*
 * Server-side dispatch (GH #1): the same routes() instance routes Node
 * http.IncomingMessage objects, Web Fetch Requests, and plain URL strings,
 * with method-aware matching and query-string values.
 */
import routes from '../src/routes.js';

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

  it("should run the middleware chain before the route callback", function() {
    var order = [];
    r.use(function(req, next) { order.push("mw1"); next(); });
    r.use(function(req, next) { order.push("mw2"); next(); });
    r.get("/mw", function() { order.push("route"); });

    r.dispatch({ url: "/mw", method: "GET" });

    expect(order).toEqual(["mw1", "mw2", "route"]);
  });

  it("should not run the route callback when middleware does not call next", function() {
    var fired = false;
    r.use(function() { /* short-circuit, e.g. auth rejection */ });
    r.get("/guarded", function() { fired = true; });

    // The route matched, so the caller does not 404; the middleware owns the response.
    expect(r.dispatch({ url: "/guarded", method: "GET" })).toEqual(true);
    expect(fired).toEqual(false);
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
