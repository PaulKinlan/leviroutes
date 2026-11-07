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

  it("should throw an error when route pattern exceeds maximum length", function() {
    var longRoute = "/" + "a".repeat(2049);
    expect(function() {
      r.get(longRoute, function(){});
    }).toThrowError(/route pattern exceeds maximum length of 2048 characters/);
  });

  it("should throw an error when a route contains an unmatched ')' that would alter wrapper anchoring", function() {
    expect(function() {
      r.get("/a)|b", function(){});
    }).toThrowError(/contains unmatched '\)' that alters route anchoring/);

    expect(function() {
      r.get("/a)|(?:b", function(){});
    }).toThrowError(/contains unmatched '\)' that alters route anchoring/);

    expect(function() {
      r.get("/prefix)/:id", function(){});
    }).toThrowError(/contains unmatched '\)' that alters route anchoring/);
  });

  it("should throw an error when a route contains unclosed '(' in route pattern", function() {
    expect(function() {
      r.get("/a(", function(){});
    }).toThrowError(/contains unclosed '\(' in route pattern/);

    expect(function() {
      r.get("/a/(?:b", function(){});
    }).toThrowError(/contains unclosed '\(' in route pattern/);
  });

  it("should allow escaped parentheses and parentheses inside character classes without altering route anchoring", function() {
    r.get("/a\\)/b", function(){});
    expect(r.getRoutes()[0].regex.regexp).toEqual(/^(?:\/a\)\/b)$/);

    var r2 = new routes();
    r2.get("/a[)]/b", function(){});
    expect(r2.getRoutes()[0].regex.regexp).toEqual(/^(?:\/a[)]\/b)$/);
  });

  it("should reject custom regex groups containing nested quantifiers susceptible to catastrophic backtracking", function() {
    expect(function() {
      r.get("/x/:id((a+)+b)", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/x/:id((a*)*)", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/x/:id(((a+))+b)", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/x/:id((a{1,})+b)", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/x/((a)+)+b", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/:ids((\\d+|x)+)", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/:id((a|aa)+)", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/:id((a|a?)+)", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/:id((ab|a)+)", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/:x((a|[a-z])+)", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/:x(([a-z]|a)+)", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/:x((a|\\x61)+)", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/:x(((a|aa))+)", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/:x((a|[\\x61])+)", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/:x((a|\\u0061)+)", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/x/((a|b)*)+", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/:id((a+b?)+)", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/:id((a+b*)+)", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/:id((a?c|b?c)+)", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/:id((\\w+\\s?)+)", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/:id((a+a)+)", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/:id((\\d+\\d)+)", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/:id(([a-z]+[a-z])+)", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/:id((.+.)+)", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/:id((.*\\s)+)", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/:id((\\s*,\\s*)+)", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/:id((\\d|\\d\\d)+)", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/:id(([a-z]|[a-z]{2})+)", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/:id((.|..)+)", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/:id(([a-z]+[a-z]{2})+)", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/:id((\\d{2}|\\d)+)", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/:id((\\d{4}|\\d{5})+)", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/:id(([a-z]{5}|[a-z]{6})+)", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/:id((\\d{130}|\\d{131})+)", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/:id(((?:ab){2}|(?:ab){3})+)", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/:id(((ab){4}|(ab){5})+)", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/:id((a|b)c|bc)+", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/:id((\\d|a)x|ax)+", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/:id((?:a|b)cd|bcd)+", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);
  });

  it("should accept linear non-catastrophic custom patterns without false rejection", function() {
    var r1 = new routes();
    r1.get("/:id(\\d+(?:-\\d+)?)", function(){});
    expect(r1.getRoutes()[0].regex.regexp).toEqual(/^(?:\/(\d+(?:-\d+)?))$/);

    var r2 = new routes();
    r2.get("/:id(\\d+(-\\d+)?)", function(){});
    expect(r2.getRoutes()[0].regex.regexp).toEqual(/^(?:\/(\d+(-\d+)?))$/);

    var r3 = new routes();
    r3.get("/:id([a-z]+(?:\\.[a-z]+)?)", function(){});
    expect(r3.getRoutes()[0].regex.regexp).toEqual(/^(?:\/([a-z]+(?:\.[a-z]+)?))$/);

    var r4 = new routes();
    r4.get("/:id((a+)?)", function(){});
    expect(r4.getRoutes()[0].regex.regexp).toEqual(/^(?:\/((a+)?))$/);

    var r5 = new routes();
    r5.get("/:x((?:a))+", function(){});
    expect(r5.getRoutes()[0].regex.regexp).toEqual(/^(?:\/((?:a))+)$/);

    var r6 = new routes();
    r6.get("/x/(a[+]b)+", function(){});
    expect(r6.getRoutes()[0].regex.regexp).toEqual(/^(?:\/x\/(a[+]b)+)$/);

    var r7 = new routes();
    r7.get("/:path((?:[^/]+/)*[^/]+)", function(){});
    expect(r7.getRoutes()[0].regex.regexp).toEqual(/^(?:\/((?:[^/]+\/)*[^/]+))$/);

    var r8 = new routes();
    r8.get("/:slug([a-z0-9]+(?:-[a-z0-9]+)*)", function(){});
    expect(r8.getRoutes()[0].regex.regexp).toEqual(/^(?:\/([a-z0-9]+(?:-[a-z0-9]+)*))$/);

    var r9 = new routes();
    r9.get("/:id((?:\\d{2})+)", function(){});
    expect(r9.getRoutes()[0].regex.regexp).toEqual(/^(?:\/((?:\d{2})+))$/);

    var r10 = new routes();
    r10.get("/:x((?:[a-z]|[0-9])+)", function(){});
    expect(r10.getRoutes()[0].regex.regexp).toEqual(/^(?:\/((?:[a-z]|[0-9])+))$/);

    var r11 = new routes();
    r11.get("/:x((?:en|es)+)", function(){});
    expect(r11.getRoutes()[0].regex.regexp).toEqual(/^(?:\/((?:en|es)+))$/);

    var r12 = new routes();
    r12.get("/:ext((?:\\.json|\\.xml)+)", function(){});
    expect(r12.getRoutes()[0].regex.regexp).toEqual(/^(?:\/((?:\.json|\.xml)+))$/);

    var r13 = new routes();
    r13.get("/:seg((?:v1|v2)+)", function(){});
    expect(r13.getRoutes()[0].regex.regexp).toEqual(/^(?:\/((?:v1|v2)+))$/);

    var r14 = new routes();
    r14.get("/:v(v?\\d+(?:\\.\\d+)*)", function(){});
    expect(r14.getRoutes()[0].regex.regexp).toEqual(/^(?:\/(v?\d+(?:\.\d+)*))$/);

    var r15 = new routes();
    r15.get("/:v(v?[0-9]+(?:\\.[0-9]+)*)", function(){});
    expect(r15.getRoutes()[0].regex.regexp).toEqual(/^(?:\/(v?[0-9]+(?:\.[0-9]+)*))$/);

    var r16 = new routes();
    r16.get("/:id((\\w+\\s)+)", function(){});
    expect(r16.getRoutes()[0].regex.regexp).toEqual(/^(?:\/((\w+\s)+))$/);

    var r17 = new routes();
    r17.get("/:x((apple|apricot)+)", function(){});
    expect(r17.getRoutes()[0].regex.regexp).toEqual(/^(?:\/((apple|apricot)+))$/);

    var r18 = new routes();
    r18.get("/:name([A-Za-z]+(?:[ -][A-Za-z]+)*)", function(){});
    expect(r18.getRoutes()[0].regex.regexp).toEqual(/^(?:\/([A-Za-z]+(?:[ -][A-Za-z]+)*))$/);

    var r19 = new routes();
    r19.get("/:ip(\\d{1,3}(?:\\.\\d{1,3}){3})", function(){});
    expect(r19.getRoutes()[0].regex.regexp).toEqual(/^(?:\/(\d{1,3}(?:\.\d{1,3}){3}))$/);

    var r20 = new routes();
    r20.get("/:date(\\d{4}-\\d{2}-\\d{2})", function(){});
    expect(r20.getRoutes()[0].regex.regexp).toEqual(/^(?:\/(\d{4}-\d{2}-\d{2}))$/);

    var r21 = new routes();
    r21.get("/:id(([a-z]+[0-9])+)", function(){});
    expect(r21.getRoutes()[0].regex.regexp).toEqual(/^(?:\/(([a-z]+[0-9])+))$/);

    var r22 = new routes();
    r22.get("/:host([a-z0-9-]+(?:\\.[a-z0-9-]+)+)", function(){});
    expect(r22.getRoutes()[0].regex.regexp).toEqual(/^(?:\/([a-z0-9-]+(?:\.[a-z0-9-]+)+))$/);

    var r23 = new routes();
    r23.get("/:d((?:\\d{2}:){2}\\d{2})", function(){});
    expect(r23.getRoutes()[0].regex.regexp).toEqual(/^(?:\/((?:\d{2}:){2}\d{2}))$/);

    var r24 = new routes();
    r24.get("/:id((\\d{2}x|\\d{3}y)+)", function(){});
    expect(r24.getRoutes()[0].regex.regexp).toEqual(/^(?:\/((\d{2}x|\d{3}y)+))$/);

    var r25 = new routes();
    r25.get("/:id((\\d{4}x|\\d{3}y)+)", function(){});
    expect(r25.getRoutes()[0].regex.regexp).toEqual(/^(?:\/((\d{4}x|\d{3}y)+))$/);

    var r26 = new routes();
    r26.get("/:id(([A-Z]{2}x|[A-Z]{3}y)+)", function(){});
    expect(r26.getRoutes()[0].regex.regexp).toEqual(/^(?:\/(([A-Z]{2}x|[A-Z]{3}y)+))$/);

    var r27 = new routes();
    r27.get("/:id(([a-z]{2}\\d{2}|[a-z]{2}\\d{4})+)", function(){});
    expect(r27.getRoutes()[0].regex.regexp).toEqual(/^(?:\/(([a-z]{2}\d{2}|[a-z]{2}\d{4})+))$/);
  });
});
