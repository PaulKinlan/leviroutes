import routes from '../src/routes.js';

describe("route parsing", function() {
  var r;
  beforeEach(function() {
    r = new routes();
  });

  it("should parse / and add endmarker", function() {
    r.get("/", function() { });
    expect(r.getRoutes()[0].regex.regexp).toEqual(/^\/$/);
  });

  it("should parse basic route and leave untouched", function() {
    r.get("/category", function() { });
    expect(r.getRoutes()[0].regex.regexp).toEqual(/^\/category$/);
  });

  it("should parse basic named identifier in position 0", function() {
    r.get("/:category", function(){});
    expect(r.getRoutes()[0].regex.groups["category"]).toEqual(0);
    expect(r.getRoutes()[0].regex.regexp).toEqual(/^\/([^/.\\]+)$/);
  });

  it("should treat a literal dot in a route as a dot, not any character", function() {
    r.get("/:category.:format", function(){});
    expect(r.getRoutes()[0].regex.groups).toEqual({ "category": 0, "format": 1 });
    expect(r.getRoutes()[0].regex.regexp).toEqual(/^\/([^/.\\]+)\.([^/.\\]+)$/);
  });

  it("should calculate correct group index when preceded by regex capture groups", function() {
    r.get("/foo/([a-z]+)/:id", function(){});
    expect(r.getRoutes()[0].regex.groups["id"]).toEqual(1);
    expect(r.getRoutes()[0].regex.regexp).toEqual(/^\/foo\/([a-z]+)\/([^/.\\]+)$/);
  });

  it("should parse named param followed by custom regex group", function() {
    r.get("/user/:id(\\d+)", function(){});
    expect(r.getRoutes()[0].regex.groups["id"]).toEqual(0);
    expect(r.getRoutes()[0].regex.regexp).toEqual(/^\/user\/(\d+)$/);
  });

  it("should parse named param followed by character-class regex group", function() {
    r.get("/user/:id([a-z]+)", function(){});
    expect(r.getRoutes()[0].regex.groups["id"]).toEqual(0);
    expect(r.getRoutes()[0].regex.regexp).toEqual(/^\/user\/([a-z]+)$/);
  });

  it("should parse hyphenated named parameter names", function() {
    r.get("/user/:user-id", function(){});
    expect(r.getRoutes()[0].regex.groups["user-id"]).toEqual(0);
    expect(r.getRoutes()[0].regex.regexp).toEqual(/^\/user\/([^/.\\]+)$/);
  });

  it("should calculate correct group indices for params following custom-group params", function() {
    r.get("/api/:version(v\\d+)/:resource/:id", function(){});
    expect(r.getRoutes()[0].regex.groups["version"]).toEqual(0);
    expect(r.getRoutes()[0].regex.groups["resource"]).toEqual(1);
    expect(r.getRoutes()[0].regex.groups["id"]).toEqual(2);
    expect(r.getRoutes()[0].regex.regexp).toEqual(/^\/api\/(v\d+)\/([^/.\\]+)\/([^/.\\]+)$/);
  });

  it("should preserve skipped non-capturing groups with colon patterns and compile params by offset", function() {
    r.get("/(?:x)/:x", function(){});
    expect(r.getRoutes()[0].regex.groups["x"]).toEqual(0);
    expect(r.getRoutes()[0].regex.regexp).toEqual(/^\/(?:x)\/([^/.\\]+)$/);
  });

  it("should preserve literal colon strings inside non-capturing groups without mis-binding repeated param names", function() {
    r.get("/(?:a:x)/:x", function(){});
    expect(r.getRoutes()[0].regex.groups["x"]).toEqual(0);
    expect(r.getRoutes()[0].regex.regexp).toEqual(/^\/(?:a:x)\/([^/.\\]+)$/);
  });

  it("should calculate correct group indices for params following multi-capture or nested-capture custom groups", function() {
    r.get("/:pet((cat|dog))/:id", function(){});
    expect(r.getRoutes()[0].regex.groups["pet"]).toEqual(0);
    expect(r.getRoutes()[0].regex.groups["id"]).toEqual(2);
    expect(r.getRoutes()[0].regex.regexp).toEqual(/^\/((cat|dog))\/([^/.\\]+)$/);

    var r2 = new routes();
    r2.get("/p/:a((a)|(b))/:b/:c", function(){});
    expect(r2.getRoutes()[0].regex.groups["a"]).toEqual(0);
    expect(r2.getRoutes()[0].regex.groups["b"]).toEqual(3);
    expect(r2.getRoutes()[0].regex.groups["c"]).toEqual(4);
  });
});
