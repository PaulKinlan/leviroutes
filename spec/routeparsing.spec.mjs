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
      r.get("/:id((\\d\\d?)+)", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/:id(([a-z][a-z]?)+)", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/:id(([0-9][0-9]?)+)", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/:id(([0-9][0-9]{0,1})+)", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/:id((..?)+)", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/:id(((\\d\\d?))+)", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/:id(((?:\\d\\d?))+)", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/:id((((\\d\\d?)))+)", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/:id(((\\d\\d?)){20})", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/:id(((\\d\\d?))*)", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/:id(((\\d\\d?)){3,})", function(){});
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

    expect(function() {
      r.get("/:id((?:a?b?)+)", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/:id((?:a?b?)*)", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/:id((?:a?b?c?)+)", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/x/(?:a?b?)+", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/x/(a?b?)+", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/x/([a-z]?[0-9]?)+", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/:id((?:[ab]?[cd]?)+)", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/:id(((?:a?b?))+)+", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/:id((.*a){20})", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/:id((.*a){5})", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/:id(([a-z]+[a-z]){15})", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/:id((\\d+\\d){20})", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/:id((a+){20})", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/:id((?:a?){24})", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/:id((?:a?){32})", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/:id((a?){24})", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/:id((?:[0-9]?){24})", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/:id((?:a?){24,24})", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/:id((?:a?){5}(?:a?){5}(?:a?){5}(?:a?){5})", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/:id(((?:a?){5}){5})", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/:id(((?:a?){7}){7})", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/:id((((?:a?){4}){4}){4})", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/:id((?:a?){5,5}){5,5}", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    // leviroutes-6ifi: a run of three or more adjacent, mutually overlapping UNBOUNDED
    // quantifiers is as dangerous without an enclosing repetition as inside one, so the
    // adjacency check runs for every branch, including plain route text and the frames the
    // pattern never closes. Measured at MAX_PATH_LENGTH (4096) with a near-miss path:
    // a run of 2 costs 32ms (allowed below) and a run of 3 costs 26.9s (refused here).
    expect(function() {
      r.get("/x/:id(\\d+\\d+\\d+)", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/x/a+\\d+\\d+\\d+", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/x/:id((a+)(a+)(a+))", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/x/[a-z]+[a-z]+[a-z]+", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    // leviroutes-nlag: the small-fixed-count exemption now multiplies the repeated branch's
    // maxima instead of only checking that they are finite. (6*6)^7 = 7.8e10 chunkings measured
    // 167s on a 40-digit near-miss, and (16)^6 = 1.7e7 measured 1.6s; both must register nothing.
    expect(function() {
      r.get("/x/:id((\\d{1,6}\\d{1,6}){7})", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/x/:id((\\d{1,4}\\d{1,4}){6})", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    // leviroutes-omc1: the parenthesised-group check must still fire one nesting level
    // deeper than the linear controls that now register - the fix narrows the test from
    // "a group's text overlaps itself" to "the group's own boundary atoms overlap", so
    // these genuinely exponential deep shapes stay refused.
    expect(function() {
      r.get("/:id(((a+a))+)", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/:id((((?:\\d\\d?))*))", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);
    // leviroutes-0144: a fixed count of ONE unbounded atom is a split-count problem too - the
    // wrap-around arm exempts any count below 8 before the unbounded test runs, so a repeat of
    // a single unbounded atom registered and ([a-z]+){3} measured 129s at the 4096-char cap
    // ((\d+){3}: 88s). Two is 59-80ms and stays accepted in the accept spec below.
    expect(function() {
      r.get("/:id(([a-z]+){3})", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    expect(function() {
      r.get("/x/:id((\\d+){3})", function(){});
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

    var r28 = new routes();
    r28.get("/:id((a+b){20})", function(){});
    expect(r28.getRoutes()[0].regex.regexp).toEqual(/^(?:\/((a+b){20}))$/);

    var r29 = new routes();
    r29.get("/:id((\\d+){2})", function(){});
    expect(r29.getRoutes()[0].regex.regexp).toEqual(/^(?:\/((\d+){2}))$/);

    var r30 = new routes();
    r30.get("/:id((\\w+){2})", function(){});
    expect(r30.getRoutes()[0].regex.regexp).toEqual(/^(?:\/((\w+){2}))$/);

    var r32 = new routes();
    r32.get("/:id((\\d{1,3}){4})", function(){});
    expect(r32.getRoutes()[0].regex.regexp).toEqual(/^(?:\/((\d{1,3}){4}))$/);

    var r33 = new routes();
    r33.get("/:id(([a-z]{2,3}){3})", function(){});
    expect(r33.getRoutes()[0].regex.regexp).toEqual(/^(?:\/(([a-z]{2,3}){3}))$/);

    var r34 = new routes();
    r34.get("/:id((a+){2,2})", function(){});
    expect(r34.getRoutes()[0].regex.regexp).toEqual(/^(?:\/((a+){2,2}))$/);

    var r35 = new routes();
    r35.get("/:id((?:a?){5})", function(){});
    expect(r35.getRoutes()[0].regex.regexp).toEqual(/^(?:\/((?:a?){5}))$/);

    var r36 = new routes();
    r36.get("/:ip(\\d{1,3}(?:.\\d{1,3}){3})", function(){});
    expect(r36.getRoutes()[0].regex.regexp).toEqual(/^(?:\/(\d{1,3}(?:.\d{1,3}){3}))$/);

    var r37 = new routes();
    r37.get("/:num(\\d{1,4}(?:.\\d{1,4}){2})", function(){});
    expect(r37.getRoutes()[0].regex.regexp).toEqual(/^(?:\/(\d{1,4}(?:.\d{1,4}){2}))$/);

    // leviroutes-omc1: one extra level of parentheses around a linear,
    // delimiter-separated repeat must register. Every iteration consumes a literal
    // delimiter (',', '/', '.'), so the inner group cannot re-partition the same
    // characters and the repetition is linear. Before this fix the self-overlap test
    // compared the group's text with itself - trivially true - and refused these
    // while the identical one-level-shallower forms registered.
    var r38 = new routes();
    r38.get("/:list(((\\d+,))*)", function(){});
    expect(r38.getRoutes()[0].regex.regexp).toEqual(/^(?:\/(((\d+,))*))$/);
    expect(r38.getRoutes()[0].regex.regexp.exec("/1,2,3,")[1]).toEqual("1,2,3,");

    var r39 = new routes();
    r39.get("/:p(((?:[^/]+/))*)", function(){});
    expect(r39.getRoutes()[0].regex.regexp).toEqual(/^(?:\/(((?:[^/]+\/))*))$/);
    expect(r39.getRoutes()[0].regex.regexp.exec("/a/b/c/")[1]).toEqual("a/b/c/");

    var r40 = new routes();
    r40.get("/:v(((\\w+\\.))*)", function(){});
    expect(r40.getRoutes()[0].regex.regexp).toEqual(/^(?:\/(((\w+\.))*))$/);
    expect(r40.getRoutes()[0].regex.regexp.exec("/a.b.c.")[1]).toEqual("a.b.c.");

    var r41 = new routes();
    r41.get("/:list(((\\d+,))+)", function(){});
    expect(r41.getRoutes()[0].regex.regexp).toEqual(/^(?:\/(((\d+,))+))$/);

    // leviroutes-6ifi calibration: two adjacent same-class unbounded quantifiers cost 32ms
    // at the 4096-char path cap, which is a quadratic match rather than a stall, so it stays
    // accepted (the authoring accident is worth allowing); a third is refused above. Adjacent
    // quantifiers over different character sets are never ambiguous and stay linear.
    var r42 = new routes();
    r42.get("/x/:id(\\d+\\d+)", function(){});
    expect(r42.getRoutes()[0].regex.regexp).toEqual(/^(?:\/x\/(\d+\d+))$/);
    expect(r42.getRoutes()[0].regex.regexp.exec("/x/1234")[1]).toEqual("1234");

    var r43 = new routes();
    r43.get("/x/:id([a-z]+[0-9]+)", function(){});
    expect(r43.getRoutes()[0].regex.regexp).toEqual(/^(?:\/x\/([a-z]+[0-9]+))$/);

    // leviroutes-nlag calibration: the small-fixed-count exemption is bounded by the PRODUCT
    // of the repeated branch's maxima, not by their finiteness alone. (\d{1,3}\d{1,3}){4} has a
    // product of 6561 and measures under 1ms at the path cap, so it registers;
    // (\d{1,6}\d{1,6}){7} has a product of 7.8e10, measures 167s on a 40-digit near-miss, and
    // is refused (the rejection control lives in the reject spec above).
    var r44 = new routes();
    r44.get("/x/:id((\\d{1,3}\\d{1,3}){4})", function(){});
    expect(r44.getRoutes()[0].regex.regexp).toEqual(/^(?:\/x\/((\d{1,3}\d{1,3}){4}))$/);

    var r45 = new routes();
    r45.get("/x/:id((\\d{1,4}\\d{1,4}){4})", function(){});
    expect(r45.getRoutes()[0].regex.regexp).toEqual(/^(?:\/x\/((\d{1,4}\d{1,4}){4}))$/);

    // leviroutes-0144 calibration: a fixed count of two unbounded atoms costs 59-80ms at the
    // 4096-char path cap, so it still registers; three measured 88-129s and is refused above.
    var r46 = new routes();
    r46.get("/x/:id((\\w+){2})", function(){});
    expect(r46.getRoutes()[0].regex.regexp).toEqual(/^(?:\/x\/((\w+){2}))$/);
  });

  // leviroutes-4qix: the guard's own parsers read a branch's text, so they have to terminate on
  // every input the guard can hand them. branchLength() looked up the closer with indexOf and then
  // did `i = close + 1`, so an unmatched '{' (close === -1) reset i to 0 and the while-loop never
  // advanced: registering any of the shapes below hung the process at import time with no error.
  // The assertions pin the terminating verdict, so a regression to the loop cannot pass silently
  // and a change in the guard's decision cannot pass either.
  it("should terminate the pattern analysis for a custom group holding an unmatched '{' (leviroutes-4qix)", function() {
    var unmatchedBrace = [
      "/x/:id((a{2,3}|a{){2})",
      "/x/:id((a{1,2}|a{){1,2})",
      "/x/:id((\\d{1,2}|\\d{){1,2})",
      "/x/:id(([a-z]{1,3}|[a-z]{){1,3})",
      "/x/:id((a{2,}|a{){2,})"
    ];
    unmatchedBrace.forEach(function(pattern) {
      var r = new routes();
      expect(function() {
        r.get(pattern, function(){});
      }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);
    });

    // Controls: an unbalanced brace outside a repeated alternation never reaches the analysis and
    // stays a literal in the compiled pattern, exactly as the regexp engine reads it.
    var literalBrace = new routes();
    literalBrace.get("/x/a{", function(){});
    expect(literalBrace.getRoutes()[0].regex.regexp).toEqual(/^(?:\/x\/a{)$/);

    var literalBraceWithTrailing = new routes();
    literalBraceWithTrailing.get("/x/a{b", function(){});
    expect(literalBraceWithTrailing.getRoutes()[0].regex.regexp).toEqual(/^(?:\/x\/a{b)$/);
  });

  // leviroutes-j6sv: expandAtoms() materialises a fixed {n} into n atoms, and nothing bounded n, so the
  // guard could exhaust the heap on its own analysis: '/:id((a{2,3}|a{100000000}){2})' pushed 2e8 atoms
  // and died with 'FATAL ERROR: JavaScript heap out of memory' at registration (1e3 -> 8ms,
  // 1e5 -> 25ms, 5e6 -> 601ms, 1e8 -> OOM at a 256MB heap). Above MAX_EXPANDED_ATOMS the expansion now
  // abstains (null) and the comparison falls through to the character probe, so these shapes take the
  // same verdict they took at a small count - and the suite's own bound proves they return instead of
  // allocating.
  it("should not expand an unbounded fixed-count repeat while analysing a custom group (leviroutes-j6sv)", function() {
    var hugeCounts = [
      "/x/:id((a{2,3}|a{100000000}){2})",   // per-atom repeat loop
      "/x/:id(((a){100000000}|a{2,3}){2})", // group repeat loop (count * inner atoms)
      "/x/:id((a{2,3}|a{1000000}){2})",
      "/x/:id((a{2,3}|a{600}){2})"          // just above MAX_EXPANDED_ATOMS
    ];
    hugeCounts.forEach(function(pattern) {
      var r = new routes();
      expect(function() {
        r.get(pattern, function(){});
      }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);
    });

    // Controls either side of the cap: the verdict is the same, so the cap is a bound on the guard's
    // own allocation and not a change to what it accepts.
    var belowCap = new routes();
    expect(function() {
      belowCap.get("/x/:id((a{2,3}|a{500}){2})", function(){});
    }).toThrowError(/contains nested quantifiers in custom regex group susceptible to catastrophic backtracking/);

    // A fixed count that the analysis does expand still registers and matches, so the cap cannot be
    // satisfied by refusing every fixed-count group.
    var expanded = new routes();
    expanded.get("/x/:id((\\d{1,3}\\d{1,3}){4})", function(){});
    expect(expanded.getRoutes()[0].regex.regexp).toEqual(/^(?:\/x\/((\d{1,3}\d{1,3}){4}))$/);
  });
});
