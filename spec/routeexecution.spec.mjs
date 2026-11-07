/*
 * Testing the output of when routes are executed. 
 */
import routes from '../src/routes.js';

describe("routing", function() {
  var r;
  beforeEach(function() {
    r = new routes();
  });

  it("should fire on push state", function() {
    // This test is intentionally left empty as in the original
  });

  it("should fire on form submission", function() {
    var triggered = false;
    r.post("/test", function() {
      triggered = true;
    });
    var form = document.createElement("form");
    var submit = document.createElement("input");
    submit.type = "submit";
    form.action = "/test";
    form.method = "post";
    form.appendChild(submit);
     
    window.document.body.appendChild(form);
    
    submit.click();

    window.document.body.removeChild(form);

    expect(triggered).toEqual(true);
  }); 

  it("should not fire a form route for a deeper path on another origin", function() {
    var triggered = false;
    r.post("/test", function() {
      triggered = true;
    });
    var form = document.createElement("form");
    // A form action resolves to an absolute URL; the route must match its pathname
    // exactly, not as a suffix. Dispatch the event directly so jsdom does not try to
    // navigate (an unmatched submit falls through to the real request, as intended).
    form.action = "http://example.com/deep/test";
    form.method = "post";
    window.document.body.appendChild(form);

    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    window.document.body.removeChild(form);

    expect(triggered).toEqual(false);
  });

  it("should prevent the native submit when a matched route runs without throwing", function() {
    var triggered = false;
    r.post("/test", function() {
      triggered = true;
    });
    var form = document.createElement("form");
    form.action = "/test";
    form.method = "post";
    window.document.body.appendChild(form);

    var e = new Event("submit", { bubbles: true, cancelable: true });
    form.dispatchEvent(e);

    window.document.body.removeChild(form);

    expect(triggered).toEqual(true);
    expect(e.defaultPrevented).toEqual(true);
  });

  it("should populate req.values with last-wins semantics for duplicate form field names", function() {
    var seen = null;
    r.post("/tags", function(req) {
      seen = req.values;
    });

    var form = document.createElement("form");
    form.action = "/tags";
    form.method = "post";

    var input1 = document.createElement("input");
    input1.name = "tag";
    input1.value = "first";
    form.appendChild(input1);

    var input2 = document.createElement("input");
    input2.name = "tag";
    input2.value = "second";
    form.appendChild(input2);

    window.document.body.appendChild(form);

    var e = new Event("submit", { bubbles: true, cancelable: true });
    form.dispatchEvent(e);
    window.document.body.removeChild(form);

    expect(seen).toEqual({ tag: "second" });
  });

  it("should bound req.values to MAX_VALUES_COUNT distinct keys for form submissions", function() {
    var seen = null;
    r.post("/form-bulk", function(req) {
      seen = req.values;
    });

    var form = document.createElement("form");
    form.action = "/form-bulk";
    form.method = "post";

    for (var i = 0; i < 1100; i++) {
      var input = document.createElement("input");
      input.name = "k" + i;
      input.value = "v" + i;
      form.appendChild(input);
    }

    window.document.body.appendChild(form);

    var e = new Event("submit", { bubbles: true, cancelable: true });
    form.dispatchEvent(e);
    window.document.body.removeChild(form);

    expect(Object.keys(seen).length).toEqual(1024);
    expect(seen["k0"]).toEqual("v0");
    expect(seen["k1023"]).toEqual("v1023");
    expect(seen["k1024"]).toBeUndefined();
  });

  it("should not fall back to a native submit when a matched route's middleware throws", function() {
    var middlewareRan = false;
    var callbackRan = false;
    var submitListener = null;

    // Capture the router's submit listener instead of dispatchEvent: jsdom
    // reports listener exceptions through its virtual console instead of
    // returning them to the caller, and this spec must assert the rethrow.
    var r2 = null;
    var originalAdd = window.addEventListener;
    window.addEventListener = function(type, fn) {
      if (type === "submit") submitListener = fn;
    };
    try {
      r2 = new routes();
    } finally {
      window.addEventListener = originalAdd;
    }

    // Register on the same instance whose listener was captured above.
    r2.use(function() {
      middlewareRan = true;
      throw new Error("middleware boom");
    });
    r2.post("/test", function() {
      callbackRan = true;
    });

    var form = document.createElement("form");
    form.action = "/test";
    form.method = "post";
    window.document.body.appendChild(form);

    var e = new Event("submit", { bubbles: true, cancelable: true });
    // A synthetic Event has no target of its own; the listener reads e.target.method.
    Object.defineProperty(e, "target", { value: form });

    var thrown = null;
    try {
      submitListener(e);
    } catch (err) {
      thrown = err;
    }

    window.document.body.removeChild(form);

    // The middleware ran, its throw unwound the dispatch, the error must stay
    // loud (rethrown), and the submit must not become a native POST (leviroutes-303).
    expect(middlewareRan).toEqual(true);
    expect(callbackRan).toEqual(false);
    expect(thrown).not.toBe(null);
    expect(e.defaultPrevented).toEqual(true);
  });

  it("should match a named route on the whole path, not as a suffix", function() {
    var matched = null;
    r.get("/user/:id", function(req) {
      matched = req.params.id;
    });

    r.test("/deep/user/42");
    expect(matched).toEqual(null);

    r.test("/user/42");
    expect(matched).toEqual("42");
  });

  it("should not treat a literal dot in a route as a wildcard", function() {
    var matched = null;
    r.get("/:category.:format", function(req) {
      matched = req.params;
    });

    r.test("/foo");
    expect(matched).toEqual(null);

    r.test("/a/b.json");
    expect(matched).toEqual(null);

    r.test("/foo.json");
    expect(matched).toEqual({ category: "foo", format: "json" });
  });

  it("should match a route written with an escaped dot against a literal dot", function() {
    // leviroutes-np4: '/a\\.b' must match '/a.b' exactly - not '/aXb' (the dot is
    // not a wildcard) and not '/a\b' (the pre-fix double-escape '\\.' matched a
    // literal backslash plus any character). '/a\b' never reaches the regex as
    // written: the URL parser reads a backslash in a path as a slash - but the
    // assertion that it does not match is the point of the spec.
    var matched = 0;
    r.get("/a\\.b", function() { matched++; });

    r.test("/aXb");
    r.test("/a\\b");
    expect(matched).toEqual(0);

    r.test("/a.b");
    expect(matched).toEqual(1);
  });

  it("should only fire the root route for the root path", function() {
    var fired = 0;
    r.get("/", function() {
      fired++;
    });

    r.test("/anything/");
    expect(fired).toEqual(0);

    r.test("/");
    expect(fired).toEqual(1);
  });

  it("should not route a path that only shares one alternative of an alternation route", function() {
    var matched = [];
    r.get("/index.html|/", function(req) {
      matched.push(req.url);
    });

    // '/x/' ends with '/' but is neither '/index.html' nor '/' - the pre-fix pattern
    // /^\/index\.html|\/$/ matched it through the stray end anchor (leviroutes-bym).
    r.test("/x/");
    expect(matched).toEqual([]);

    r.test("/index.html");
    r.test("/");
    expect(matched).toEqual(["/index.html", "/"]);
  });

  it("should still match the whole path inside the chosen alternative of an alternation route", function() {
    var params = null;
    r.get("/a|/b/:id", function(req) {
      params = req.params;
    });

    r.test("/b/deep/42");
    expect(params).toEqual(null);

    r.test("/b/42");
    expect(params).toEqual({ id: "42" });
  });

  it("should match an absolute URL by its pathname", function() {
    var matched = null;
    r.get("/user/:id", function(req) {
      matched = req.params.id;
    });

    r.test("http://example.com/user/42");
    expect(matched).toEqual("42");

    matched = null;
    r.test("http://example.com/deep/user/42");
    expect(matched).toEqual(null);
  });

  it("should extract correct named params when route contains regex capture groups", function() {
    var params = null;
    r.get("/foo/([a-z]+)/:id", function(req) {
      params = req.params;
    });

    r.test("/foo/bar/123");
    expect(params).toEqual({ id: "123" });
  });

  it("should handle multiple named params mixed with regex capture groups", function() {
    var params = null;
    r.get("/user/([a-z]+)/:id/(\\d+)/:action", function(req) {
      params = req.params;
    });

    r.test("/user/admin/42/99/edit");
    expect(params).toEqual({ id: "42", action: "edit" });
  });

  it("should create req.params with null prototype so parameter names cannot collide with Object.prototype", function() {
    var seen = null;
    r.get("/items/:hasOwnProperty", function(req) { seen = req; });

    r.test("/items/test-value");
    expect(seen.params.hasOwnProperty).toEqual("test-value");
    expect(Object.prototype.hasOwnProperty.call(seen.params, "hasOwnProperty")).toBe(true);
    expect(Object.getPrototypeOf(seen.params)).toBeNull();
  });

  it("should match named params with custom regex groups and extract params correctly", function() {
    var seen = null;
    r.get("/user/:id(\\d+)", function(req) { seen = req.params; });

    r.test("/user/42");
    expect(seen).toEqual({ id: "42" });

    seen = null;
    r.test("/user/abc");
    expect(seen).toEqual(null);
  });

  it("should match named params with character-class groups", function() {
    var seen = null;
    r.get("/user/:id([a-z]+)", function(req) { seen = req.params; });

    r.test("/user/ab");
    expect(seen).toEqual({ id: "ab" });

    seen = null;
    r.test("/user/12");
    expect(seen).toEqual(null);
  });

  it("should match hyphenated named parameters", function() {
    var seen = null;
    r.get("/user/:user-id", function(req) { seen = req.params; });

    r.test("/user/42");
    expect(seen).toEqual({ "user-id": "42" });
  });

  it("should correctly extract parameters following custom-group parameters", function() {
    var seen = null;
    r.get("/api/:version(v\\d+)/:resource/:id", function(req) { seen = req.params; });

    r.test("/api/v1/users/7");
    expect(seen).toEqual({ version: "v1", resource: "users", id: "7" });
  });

  it("should match routes with non-capturing groups and extract named parameters by offset", function() {
    var seen = null;
    r.get("/(?:x)/:x", function(req) { seen = req.params; });

    r.test("/x/test-val");
    expect(seen).toEqual({ x: "test-val" });
  });

  it("should match literal colon strings in non-capturing groups without silent parameter mis-parse", function() {
    var seen = null;
    r.get("/(?:a:x)/:x", function(req) { seen = req.params; });

    r.test("/aQ/:x");
    expect(seen).toEqual(null);

    r.test("/a:x/foo");
    expect(seen).toEqual({ x: "foo" });
  });

  it("should correctly extract parameters following multi-capture or nested-capture custom groups", function() {
    var seen = null;
    r.get("/:pet((cat|dog))/:id", function(req) { seen = req.params; });

    r.test("/cat/42");
    expect(seen).toEqual({ pet: "cat", id: "42" });

    var seen2 = null;
    var r2 = new routes();
    r2.get("/p/:a((a)|(b))/:b/:c", function(req) { seen2 = req.params; });

    r2.test("/p/a/1/2");
    expect(seen2).toEqual({ a: "a", b: "1", c: "2" });

    var seen3 = null;
    var r3 = new routes();
    r3.get("/:action((?:run|walk))/:id", function(req) { seen3 = req.params; });

    r3.test("/run/123");
    expect(seen3).toEqual({ action: "run", id: "123" });
  });

  it("should not match paths exceeding MAX_PATH_LENGTH", function() {
    var matched = false;
    r.get("/api/:endpoint", function() {
      matched = true;
    });

    var longPath = "/api/" + "x".repeat(5000);
    r.test(longPath);
    expect(matched).toEqual(false);
  });

  it("should fail closed on dispatch when path exceeds MAX_PATH_LENGTH", function() {
    var matched = false;
    r.get("/test", function() {
      matched = true;
    });

    // Path itself is oversized:
    var longPathUrl = "/" + "a".repeat(5000);
    expect(r.dispatch(longPathUrl)).toEqual(false);
  });

  it("should match valid short paths even when query string is large (> 8192 chars)", function() {
    var hit = null;
    var r2 = new routes();
    r2.get("/search", function() {
      hit = "search";
    });

    // Query string is over 8192 chars, but pathname is /search:
    var longQueryUrl = "/search?" + "q=" + "a".repeat(9000);
    expect(r2.dispatch(longQueryUrl)).toEqual(true);
    expect(hit).toEqual("search");
  });

  it("should not match a catch-all route when path is oversized", function() {
    var hit = null;
    var r3 = new routes();
    r3.get("(.*)", function() {
      hit = "catchall";
    });

    var oversizedPath = "/" + "a".repeat(5000);
    expect(r3.dispatch(oversizedPath)).toEqual(false);
    expect(hit).toEqual(null);
  });
});
