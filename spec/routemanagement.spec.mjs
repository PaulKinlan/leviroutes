import routes from '../src/routes.js';

describe("route management", function() {
  var r;
  beforeEach(function() {
    r = new routes();
  });

  it("should have no routes", function() {
    expect(r.getRoutes().length).toEqual(0);
  });

  it("should have one route", function() {
    r.get("/", function() { });
    expect(r.getRoutes().length).toEqual(1);
  });

  it("should have two routes", function() {
    r.get("/index.html", function() {});
    r.get("/", function() { });
    expect(r.getRoutes().length).toEqual(2);
  });

  it("should return a defensive copy so array mutations do not affect internal routes", function() {
    r.get("/original", function() { });
    var externalRoutes = r.getRoutes();
    expect(externalRoutes.length).toEqual(1);

    // Mutate the returned array by pushing an unvalidated route
    var fired = false;
    externalRoutes.push({
      method: "get",
      regex: { regexp: /^\/injected$/ },
      callback: function() { fired = true; }
    });

    expect(r.getRoutes().length).toEqual(1);
    expect(r.dispatch("/injected")).toBe(false);
    expect(fired).toBe(false);

    // Mutating length or clearing the returned array does not affect router
    externalRoutes.length = 0;
    expect(r.getRoutes().length).toEqual(1);

    // Mutating regex property assignment on returned route entries does not affect internal routes
    var routeEntries = r.getRoutes();
    routeEntries[0].regex.regexp = /.*/;
    expect(r.dispatch("/completely/different/path")).toBe(false);

    // In-place RegExp.prototype.compile() or flag/lastIndex mutation on returned matcher does not affect router
    var matcherEntries = r.getRoutes();
    if (matcherEntries[0].regex.regexp && typeof matcherEntries[0].regex.regexp.compile === "function") {
      matcherEntries[0].regex.regexp.compile(".*");
      expect(r.dispatch("/completely/different/path")).toBe(false);
      matcherEntries[0].regex.regexp.compile("^\\/original$", "g");
      expect(r.dispatch("/original")).toBe(true);
      expect(r.dispatch("/original")).toBe(true);
    }

    var hijackedCalled = false;
    var originalRan = false;
    r = new routes();
    r.get("/original", function() { originalRan = true; });
    var entries = r.getRoutes();
    entries[0].callback = function() { hijackedCalled = true; };
    r.dispatch("/original");
    expect(originalRan).toBe(true);
    expect(hijackedCalled).toBe(false);
  });
});
