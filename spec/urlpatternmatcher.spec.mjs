import routes from '../src/routes.js';

// The opt-in 'urlpattern' matcher. The default matcher must be untouched by any of
// this, so the first describe block pins the default and the rest tests the opt-in.
describe("urlpattern matcher (opt-in)", function() {
  var supported = typeof URLPattern !== "undefined";

  // Registers one route, matches one URL, returns the params the handler received
  // (or the string "none" when no route fired).
  var paramsFor = function(route, url, options) {
    var app = new routes(options);
    var captured = "none";
    app.get(route, function(req) { captured = req.params; });
    app.test(url);
    return captured;
  };

  it("keeps the default matcher when no options are given", function() {
    var app = new routes();
    app.get("/foo+", function() {});
    // Regex semantics: 'fo' followed by one or more 'o'.
    expect(app.getRoutes()[0].regex.regexp instanceof RegExp).toEqual(true);
  });

  it("still honours the 'regexp' matcher explicitly", function() {
    var app = new routes({ matcher: "regexp" });
    app.get("/user/:id", function() {});
    expect(app.getRoutes()[0].regex.regexp instanceof RegExp).toEqual(true);
  });

  it("compiles routes with URLPattern when opted in", function() {
    if (!supported) return pending("URLPattern is not available in this environment");
    var app = new routes({ matcher: "urlpattern" });
    app.get("/user/:id", function() {});
    expect(app.getRoutes()[0].regex.pattern instanceof URLPattern).toEqual(true);
    expect(app.getRoutes()[0].regex.regexp).toEqual(null);
  });

  it("captures named parameters", function() {
    if (!supported) return pending("URLPattern is not available in this environment");
    expect(paramsFor("/user/:id", "/user/42", { matcher: "urlpattern" })).toEqual({ id: "42" });
    expect(paramsFor("/:category.:format", "/news.json", { matcher: "urlpattern" }))
      .toEqual({ category: "news", format: "json" });
  });

  it("matches a dotted segment, which the regexp matcher cannot", function() {
    if (!supported) return pending("URLPattern is not available in this environment");
    expect(paramsFor("/files/:name", "/files/report.pdf", { matcher: "urlpattern" }))
      .toEqual({ name: "report.pdf" });
    // The default matcher still refuses it, deliberately (leviroutes-5z6 keeps the
    // segment-dot change for the major version; see the README).
    expect(paramsFor("/files/:name", "/files/report.pdf")).toEqual("none");
  });

  it("does not match a route against a longer path", function() {
    if (!supported) return pending("URLPattern is not available in this environment");
    expect(paramsFor("/user/:id", "/deep/user/42", { matcher: "urlpattern" })).toEqual("none");
    expect(paramsFor("/", "/anything/", { matcher: "urlpattern" })).toEqual("none");
  });

  it("does not expose positional wildcard keys as parameters", function() {
    if (!supported) return pending("URLPattern is not available in this environment");
    expect(paramsFor("/files/*", "/files/a/b.txt", { matcher: "urlpattern" })).toEqual({});
  });

  it("supports regex groups and modifiers that the route grammar needs escaping for", function() {
    if (!supported) return pending("URLPattern is not available in this environment");
    expect(paramsFor("/books/:id(\\d+)", "/books/42", { matcher: "urlpattern" })).toEqual({ id: "42" });
    expect(paramsFor("/books/:id(\\d+)", "/books/abc", { matcher: "urlpattern" })).toEqual("none");
    expect(paramsFor("/books/:id?", "/books", { matcher: "urlpattern" })).toEqual({});
    expect(paramsFor("/files{/:id}?", "/files", { matcher: "urlpattern" })).toEqual({});
    expect(paramsFor("/files{/:id}?", "/files/7", { matcher: "urlpattern" })).toEqual({ id: "7" });
  });

  it("registers a linear nested custom group in the urlpattern matcher too", function() {
    if (!supported) return pending("URLPattern is not available in this environment");
    // leviroutes-omc1: the nested-quantifier guard is shared by both matchers, so the
    // linear delimiter-separated repeat it used to refuse must register here as well.
    // Non-capturing wrappers only: URLPattern itself refuses a repeated group that holds
    // a capturing group, which is a separate engine limitation from this guard.
    expect(paramsFor("/list/:items((?:(?:\\d+,))*)", "/list/1,2,3,", { matcher: "urlpattern" }))
      .toEqual({ items: "1,2,3," });
  });

  it("names the route when a regex-flavoured route cannot be a URL pattern", function() {
    if (!supported) return pending("URLPattern is not available in this environment");
    var app = new routes({ matcher: "urlpattern" });
    expect(function() { app.get("/foo+", function() {}); })
      .toThrowError(/route "\/foo\+" is not a valid URL pattern/);
  });

  it("explains how to get the API when it is missing", function() {
    var saved = globalThis.URLPattern;
    delete globalThis.URLPattern;

    try {
      var app = new routes({ matcher: "urlpattern" });
      expect(function() { app.get("/user/:id", function() {}); })
        .toThrowError(/needs the URL Pattern API .*urlpattern-polyfill/);
    } finally {
      globalThis.URLPattern = saved;
    }
  });

  it("matches form actions by pathname in the opt-in mode too", function() {
    if (!supported) return pending("URLPattern is not available in this environment");
    var app = new routes({ matcher: "urlpattern" });
    var fired = null;
    app.post("/test", function(req) { fired = req.url; });

    var submit = function(action) {
      var form = document.createElement("form");
      form.method = "post";
      form.action = action;
      window.document.body.appendChild(form);
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      window.document.body.removeChild(form);
    };

    // The action resolves to an absolute URL; matching is on its pathname.
    submit("http://example.com/test");
    expect(fired).toEqual("http://example.com/test");

    fired = null;
    submit("http://example.com/deep/test");
    expect(fired).toEqual(null);
  });

  it("creates req.params with null prototype", function() {
    if (!supported) return pending("URLPattern is not available in this environment");
    var seen = null;
    var app = new routes({ matcher: "urlpattern" });
    app.get("/items/:hasOwnProperty", function(req) { seen = req; });

    app.test("/items/test-value");
    expect(seen.params.hasOwnProperty).toEqual("test-value");
    expect(Object.getPrototypeOf(seen.params)).toBeNull();
  });

  // leviroutes-evd: the normalisation half both modes must agree on. Captures stay
  // percent-encoded exactly as the default matcher reports them (leviroutes-o01), so a
  // handler never sees one mode decoded and the other not.
  it("keeps captured parameters percent-encoded, like the default matcher", function() {
    if (!supported) return pending("URLPattern is not available in this environment");

    expect(paramsFor("/files/:name", "/files/a%20b", { matcher: "urlpattern" }).name).toEqual("a%20b");
    expect(paramsFor("/files/:name", "/files/a%20b").name).toEqual("a%20b");
  });

  // The documented divergence (README matcher table, docs/urlpattern-investigation.md):
  // URLPattern encodes route TEXT into a pattern, so '/a b' matches '/a%20b'; the default
  // matcher compares its compiled regexp to the encoded pathname as-is, so the route has to
  // be written encoded. Pinned here because it is a migration trap, not a detail.
  it("encodes route text like a URL pattern, where the default matcher needs it encoded", function() {
    if (!supported) return pending("URLPattern is not available in this environment");

    expect(paramsFor("/a b", "/a%20b", { matcher: "urlpattern" })).not.toEqual("none");
    expect(paramsFor("/a b", "/a%20b")).toEqual("none");
    expect(paramsFor("/a%20b", "/a%20b")).not.toEqual("none");
  });

  it("rejects route patterns exceeding maximum length in urlpattern matcher", function() {
    if (!supported) return pending("URLPattern is not available in this environment");
    var app = new routes({ matcher: "urlpattern" });
    var longPattern = "/" + "a".repeat(2049);
    expect(function() {
      app.get(longPattern, function(){});
    }).toThrowError(/route pattern exceeds maximum length of 2048 characters/);
  });

  it("rejects lookaround assertions in URLPattern custom regex groups due to lack of cross-engine parity", function() {
    if (!supported) return pending("URLPattern is not available in this environment");
    var app = new routes({ matcher: "urlpattern" });

    expect(function() {
      app.get("/items/:id((?=foo))", function(){});
    }).toThrowError(/uses lookaround assertion in custom regex group which lacks cross-engine parity/);

    expect(function() {
      app.get("/items/:id((?!bar))", function(){});
    }).toThrowError(/uses lookaround assertion in custom regex group which lacks cross-engine parity/);

    expect(function() {
      app.get("/items/((?<=foo))", function(){});
    }).toThrowError(/uses lookaround assertion in custom regex group which lacks cross-engine parity/);

    expect(function() {
      app.get("/items/((?<!foo))", function(){});
    }).toThrowError(/uses lookaround assertion in custom regex group which lacks cross-engine parity/);
  });

  it("rejects invalid regex syntax in URLPattern custom regex groups", function() {
    if (!supported) return pending("URLPattern is not available in this environment");
    var app = new routes({ matcher: "urlpattern" });

    expect(function() {
      app.get("/items/:id(+foo)", function(){});
    }).toThrowError(/is not a valid regular expression/);

    expect(function() {
      app.get("/items/:id([0-9+)", function(){});
    }).toThrowError(/contains unclosed '\(' in custom regex group/);

    expect(function() {
      app.get("/items/:id((a+)+b)", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);
  });

  it("rejects adjacent same-class quantifier runs in the urlpattern matcher too", function() {
    if (!supported) return pending("URLPattern is not available in this environment");
    var app = new routes({ matcher: "urlpattern" });
    // leviroutes-6ifi: the adjacency check is shared by both matchers, so a run of three
    // overlapping unbounded quantifiers is refused here as well, while a run of two (a
    // quadratic match, not a stall) still registers.
    expect(function() {
      app.get("/x/:id(\\d+\\d+\\d+)", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    var ok = new routes({ matcher: "urlpattern" });
    ok.get("/x/:id(\\d+\\d+)", function(){});
    expect(ok.getRoutes()[0].regex.pattern instanceof URLPattern).toEqual(true);
  });

  it("does not match paths exceeding MAX_PATH_LENGTH in urlpattern matcher", function() {
    if (!supported) return pending("URLPattern is not available in this environment");
    var app = new routes({ matcher: "urlpattern" });
    var matched = false;
    app.get("/items/:id", function() { matched = true; });

    var longPath = "/items/" + "a".repeat(5000);
    app.test(longPath);
    expect(matched).toEqual(false);
  });
});
