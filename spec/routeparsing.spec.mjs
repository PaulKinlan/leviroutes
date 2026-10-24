import routes from '../src/routes.js';

describe("route parsing", function() {
  var r;
  beforeEach(function() {
    r = new routes();
  });

  it("should parse / and add endmarker", function() {
    r.get("/", function() { });
    expect(r.getRoutes()[0].regex.regexp).toEqual(/^(?:\/)$/);
  });

  it("should parse basic route and leave untouched", function() {
    r.get("/category", function() { });
    expect(r.getRoutes()[0].regex.regexp).toEqual(/^(?:\/category)$/);
  });

  it("should parse basic named identifier in position 0", function() {
    r.get("/:category", function(){});
    expect(r.getRoutes()[0].regex.groups["category"]).toEqual(0);
    expect(r.getRoutes()[0].regex.regexp).toEqual(/^(?:\/([^/.\\]+))$/);
  });

  it("should treat a literal dot in a route as a dot, not any character", function() {
    r.get("/:category.:format", function(){});
    expect(r.getRoutes()[0].regex.groups).toEqual({ "category": 0, "format": 1 });
    expect(r.getRoutes()[0].regex.regexp).toEqual(/^(?:\/([^/.\\]+)\.([^/.\\]+))$/);
  });

  it("should not double-escape an already-escaped dot in a route", function() {
    // leviroutes-np4: escaping every dot turned '\.' into '\\.' (a literal
    // backslash plus any character), so the route never matched its own text.
    r.get("/a\\.b", function(){});
    expect(r.getRoutes()[0].regex.regexp).toEqual(/^(?:\/a\.b)$/);
  });

  it("should still escape a dot that follows an escaped backslash", function() {
    // Route text '\\.' is an escaped backslash followed by a BARE dot: the dot
    // is not itself escaped, so it is still path punctuation and must become
    // literal. A lookbehind-based escape would misread the preceding backslash.
    r.get("/a\\\\.b", function(){});
    expect(r.getRoutes()[0].regex.regexp).toEqual(/^(?:\/a\\\.b)$/);
  });

  it("should calculate correct group index when preceded by regex capture groups", function() {
    r.get("/foo/([a-z]+)/:id", function(){});
    expect(r.getRoutes()[0].regex.groups["id"]).toEqual(1);
    expect(r.getRoutes()[0].regex.regexp).toEqual(/^(?:\/foo\/([a-z]+)\/([^/.\\]+))$/);
  });

  it("should parse named param followed by custom regex group", function() {
    r.get("/user/:id(\\d+)", function(){});
    expect(r.getRoutes()[0].regex.groups["id"]).toEqual(0);
    expect(r.getRoutes()[0].regex.regexp).toEqual(/^(?:\/user\/(\d+))$/);
  });

  it("should parse named param followed by character-class regex group", function() {
    r.get("/user/:id([a-z]+)", function(){});
    expect(r.getRoutes()[0].regex.groups["id"]).toEqual(0);
    expect(r.getRoutes()[0].regex.regexp).toEqual(/^(?:\/user\/([a-z]+))$/);
  });

  it("should parse hyphenated named parameter names", function() {
    r.get("/user/:user-id", function(){});
    expect(r.getRoutes()[0].regex.groups["user-id"]).toEqual(0);
    expect(r.getRoutes()[0].regex.regexp).toEqual(/^(?:\/user\/([^/.\\]+))$/);
  });

  it("should calculate correct group indices for params following custom-group params", function() {
    r.get("/api/:version(v\\d+)/:resource/:id", function(){});
    expect(r.getRoutes()[0].regex.groups["version"]).toEqual(0);
    expect(r.getRoutes()[0].regex.groups["resource"]).toEqual(1);
    expect(r.getRoutes()[0].regex.groups["id"]).toEqual(2);
    expect(r.getRoutes()[0].regex.regexp).toEqual(/^(?:\/api\/(v\d+)\/([^/.\\]+)\/([^/.\\]+))$/);
  });

  it("should preserve skipped non-capturing groups with colon patterns and compile params by offset", function() {
    r.get("/(?:x)/:x", function(){});
    expect(r.getRoutes()[0].regex.groups["x"]).toEqual(0);
    expect(r.getRoutes()[0].regex.regexp).toEqual(/^(?:\/(?:x)\/([^/.\\]+))$/);
  });

  it("should preserve literal colon strings inside non-capturing groups without mis-binding repeated param names", function() {
    r.get("/(?:a:x)/:x", function(){});
    expect(r.getRoutes()[0].regex.groups["x"]).toEqual(0);
    expect(r.getRoutes()[0].regex.regexp).toEqual(/^(?:\/(?:a:x)\/([^/.\\]+))$/);
  });

  it("should calculate correct group indices for params following multi-capture or nested-capture custom groups", function() {
    r.get("/:pet((cat|dog))/:id", function(){});
    expect(r.getRoutes()[0].regex.groups["pet"]).toEqual(0);
    expect(r.getRoutes()[0].regex.groups["id"]).toEqual(2);
    expect(r.getRoutes()[0].regex.regexp).toEqual(/^(?:\/((cat|dog))\/([^/.\\]+))$/);

    var r2 = new routes();
    r2.get("/p/:a((a)|(b))/:b/:c", function(){});
    expect(r2.getRoutes()[0].regex.groups["a"]).toEqual(0);
    expect(r2.getRoutes()[0].regex.groups["b"]).toEqual(3);
    expect(r2.getRoutes()[0].regex.groups["c"]).toEqual(4);
  });

  it("should anchor an alternation route as a whole, not one alternative at a time", function() {
    r.get("/index.html|/", function(){});
    expect(r.getRoutes()[0].regex.regexp).toEqual(/^(?:\/index\.html|\/)$/);
  });

  it("should keep param offsets correct when a route contains top-level alternation", function() {
    r.get("/a|/b/:id", function(){});
    expect(r.getRoutes()[0].regex.groups["id"]).toEqual(0);
    expect(r.getRoutes()[0].regex.regexp).toEqual(/^(?:\/a|\/b\/([^/.\\]+))$/);
  });

  it("should throw an error when a custom pattern contains no capturing groups", function() {
    expect(function() {
      r.get("/:a(?:x)/:id", function(){});
    }).toThrowError("custom pattern for :a contains no capturing group");

    expect(function() {
      r.get("/p/:a(?:[a-z]+)/:b/:c", function(){});
    }).toThrowError("custom pattern for :a contains no capturing group");

    expect(function() {
      r.get("/item/:id(?=[0-9]+)", function(){});
    }).toThrowError("custom pattern for :id contains no capturing group");
  });
});
