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
});
