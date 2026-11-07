/*
 Copyright 2011 Paul Kinlan 

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

 http://www.apache.org/licenses/LICENSE-2.0
 
 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
*/

const routes = function(options) {
  var _routes = [];
  var _middleware = [];
  var me = this;
  // Opt-in matcher. 'regexp' is the historical behaviour and the default, so an
  // existing app that passes no options behaves exactly as before; 'urlpattern'
  // compiles routes with the URL Pattern API instead (see
  // docs/urlpattern-investigation.md for why that is a separate mode, not a swap).
  var matcherKind = (options && options.matcher) === "urlpattern" ? "urlpattern" : "regexp";
  // Reserved TLD: matching never looks at the host in this mode, so this cannot collide.
  var URLPATTERN_ORIGIN = "http://leviroutes.invalid";

  // Maximum lengths to bound route pattern compilation and path evaluation
  // against ReDoS or unbounded input attacks (tm-unbounded-pattern-eval-on-untrusted-path).
  var MAX_PATTERN_LENGTH = 2048;
  var MAX_PATH_LENGTH = 4096;
  var MAX_VALUES_COUNT = 1024;

  // Parse quantifier token at startIdx in pattern: returns { isRepetition, isNullable, isVariable, end } or null.
  // Repetition quantifiers (+, *, {n,m} where max > 1) can repeat multiple times.
  // Fixed quantifiers ({1}, {2} where min === max) match a fixed number of times and cannot cause variable ambiguity.
  // Optional quantifiers (?, {0,1}) match at most once.
  // Group prefixes like '(?' are syntax, not quantifiers.
  var parseQuantifierToken = function(pattern, startIdx) {
    if (startIdx >= pattern.length) return null;
    var c = pattern[startIdx];
    if (c === "+" || c === "*") {
      var end = startIdx;
      if (pattern[end + 1] === "?") end++;
      return { isRepetition: true, isNullable: c === "*", isVariable: true, end: end };
    }
    if (c === "?") {
      if (startIdx > 0 && pattern[startIdx - 1] === "(") {
        return null;
      }
      var end = startIdx;
      if (pattern[end + 1] === "?") end++;
      return { isRepetition: false, isNullable: true, isVariable: true, end: end };
    }
    if (c === "{") {
      var closeBrace = pattern.indexOf("}", startIdx);
      if (closeBrace !== -1) {
        var inner = pattern.slice(startIdx + 1, closeBrace);
        var m = /^(\d+)(?:,(\d*))?$/.exec(inner);
        if (m) {
          var min = parseInt(m[1], 10);
          var max = m[2] === undefined ? min : (m[2] === "" ? Infinity : parseInt(m[2], 10));
          var end = closeBrace;
          if (pattern[end + 1] === "?") end++;
          var isVariable = (max === Infinity || max > min);
          var isRepetition = (max === Infinity || max > 1) && isVariable;
          return { isRepetition: isRepetition, isNullable: min === 0, isVariable: isVariable, end: end };
        }
      }
    }
    return null;
  };

  var normalizeEscapes = function(str) {
    return str.replace(/\\x([0-9a-fA-F]{2})/g, function(_, h) { return String.fromCharCode(parseInt(h, 16)); })
              .replace(/\\u([0-9a-fA-F]{4})/g, function(_, h) { return String.fromCharCode(parseInt(h, 16)); });
  };

  var extractLiteralPrefix = function(branch) {
    var res = "";
    var i = 0;
    while (i < branch.length) {
      if (branch[i] === "\\") {
        if (i + 1 < branch.length) {
          var esc = branch[i + 1];
          if (/[dswDSWbB]/.test(esc)) break;
          if (i + 2 < branch.length && /[?*+{]/.test(branch[i + 2])) break;
          res += esc;
          i += 2;
          continue;
        }
      }
      if (/[\[\(\{\+\*\?\|\$\^\.]/.test(branch[i])) break;
      if (i + 1 < branch.length && /[?*+{]/.test(branch[i + 1])) break;
      res += branch[i];
      i++;
    }
    return res;
  };

  var branchesOverlap = function(b1, b2) {
    b1 = normalizeEscapes(b1);
    b2 = normalizeEscapes(b2);

    var r1, r2;
    try {
      r1 = new RegExp("^(?:" + b1 + ")$");
      r2 = new RegExp("^(?:" + b2 + ")$");
    } catch (e) {
      return true;
    }

    if (r1.test("") || r2.test("")) return true;

    var p1 = extractLiteralPrefix(b1);
    var p2 = extractLiteralPrefix(b2);

    if (p1.length > 0 && p2.length > 0) {
      if (p1.indexOf(p2) === 0 || p2.indexOf(p1) === 0) {
        return true;
      }
      return false;
    }

    if (p1.length > 0) {
      try {
        if (new RegExp("^(?:" + b2 + ")").test(p1)) return true;
      } catch (e) {}
    }
    if (p2.length > 0) {
      try {
        if (new RegExp("^(?:" + b1 + ")").test(p2)) return true;
      } catch (e) {}
    }

    for (var code = 0; code < 128; code++) {
      var ch = String.fromCharCode(code);
      try {
        if (new RegExp("^(?:" + b1 + ")").test(ch) && new RegExp("^(?:" + b2 + ")").test(ch)) {
          return true;
        }
      } catch (e) {}
    }

    return false;
  };

  // Parse-aware helper to detect nested quantifiers and overlapping repeated alternations
  // that trigger catastrophic backtracking in regular expressions (tm-unbounded-pattern-eval-on-untrusted-path,
  // leviroutes-njt, leviroutes-39k, leviroutes-1hs, leviroutes-vsu, leviroutes-8sb, leviroutes-aqt, leviroutes-0yz,
  // leviroutes-a8b, leviroutes-l45, leviroutes-bwv, leviroutes-ur3, leviroutes-kyk, leviroutes-e4f).
  var hasNestedQuantifiers = function(pattern) {
    var newBranch = function(startIdx) {
      return {
        atoms: [],
        startIdx: startIdx,
        branchText: "",
        hasInternalReDoS: false
      };
    };
    var newFrame = function() {
      return { branches: [newBranch(0)] };
    };

    var stack = [];
    var currentFrame = newFrame();
    var inCharClass = false;
    var escaped = false;
    var atomStart = 0;

    for (var i = 0; i < pattern.length; i++) {
      var c = pattern[i];
      if (escaped) {
        escaped = false;
        var curBranch = currentFrame.branches[currentFrame.branches.length - 1];
        var q = parseQuantifierToken(pattern, i + 1);
        var end = i;
        var isRep = false;
        var isNull = false;
        if (q) {
          isRep = q.isRepetition;
          isNull = q.isNullable;
          end = q.end;
          i = q.end;
        }
        curBranch.atoms.push({
          text: pattern.slice(atomStart, end + 1),
          isRepetition: isRep,
          isNullable: isNull
        });
        continue;
      }
      if (c === "\\") {
        escaped = true;
        atomStart = i;
        continue;
      }
      if (inCharClass) {
        if (c === "]") {
          inCharClass = false;
          var curBranch = currentFrame.branches[currentFrame.branches.length - 1];
          var q = parseQuantifierToken(pattern, i + 1);
          var end = i;
          var isRep = false;
          var isNull = false;
          if (q) {
            isRep = q.isRepetition;
            isNull = q.isNullable;
            end = q.end;
            i = q.end;
          }
          curBranch.atoms.push({
            text: pattern.slice(atomStart, end + 1),
            isRepetition: isRep,
            isNullable: isNull
          });
        }
        continue;
      }
      if (c === "[") {
        inCharClass = true;
        atomStart = i;
        continue;
      }
      if (c === "(") {
        if (pattern.slice(i + 1, i + 3) === "?:") {
          i += 2;
        }
        stack.push(currentFrame);
        currentFrame = { branches: [newBranch(i + 1)] };
        continue;
      }
      if (c === "|") {
        var prevBranch = currentFrame.branches[currentFrame.branches.length - 1];
        prevBranch.branchText = pattern.slice(prevBranch.startIdx, i);
        currentFrame.branches.push(newBranch(i + 1));
        continue;
      }
      if (c === ")") {
        var lastBranch = currentFrame.branches[currentFrame.branches.length - 1];
        lastBranch.branchText = pattern.slice(lastBranch.startIdx, i);

        var finishedFrame = currentFrame;
        currentFrame = stack.pop() || newFrame();
        var currentBranch = currentFrame.branches[currentFrame.branches.length - 1];

        // Check for overlapping alternations in finished frame
        var hasOverlappingAlt = false;
        if (finishedFrame.branches.length > 1) {
          for (var j = 0; j < finishedFrame.branches.length; j++) {
            for (var k = j + 1; k < finishedFrame.branches.length; k++) {
              if (branchesOverlap(finishedFrame.branches[j].branchText, finishedFrame.branches[k].branchText)) {
                hasOverlappingAlt = true;
                break;
              }
            }
            if (hasOverlappingAlt) break;
          }
        }

        var anyBranchHasInternal = false;
        for (var f = 0; f < finishedFrame.branches.length; f++) {
          if (finishedFrame.branches[f].hasInternalReDoS) {
            anyBranchHasInternal = true;
            break;
          }
        }

        if (hasOverlappingAlt || anyBranchHasInternal) {
          currentBranch.hasInternalReDoS = true;
        }

        var q = parseQuantifierToken(pattern, i + 1);
        var end = i;
        var isRep = false;
        var isNull = false;
        if (q) {
          isRep = q.isRepetition;
          isNull = q.isNullable;
          end = q.end;
          i = q.end;
        }

        var innerIsRep = false;
        var innerIsNull = false;
        if (finishedFrame.branches.length === 1 && finishedFrame.branches[0].atoms.length === 1) {
          var innerAtom = finishedFrame.branches[0].atoms[0];
          if (innerAtom.isRepetition) innerIsRep = true;
          if (innerAtom.isNullable) innerIsNull = true;
        }

        if (isRep) {
          if (anyBranchHasInternal) return true;
          if (hasOverlappingAlt) return true;
          if (innerIsRep) return true;

          for (var bIdx = 0; bIdx < finishedFrame.branches.length; bIdx++) {
            var branch = finishedFrame.branches[bIdx];
            var atoms = branch.atoms;
            if (atoms.length === 0) continue;

            // Check intra-branch reachable overlaps
            for (var j = 0; j < atoms.length; j++) {
              for (var k = j + 1; k < atoms.length; k++) {
                if (atoms[j].isRepetition || atoms[k].isRepetition) {
                  var reachable = true;
                  for (var mid = j + 1; mid < k; mid++) {
                    if (!atoms[mid].isNullable) {
                      reachable = false;
                      break;
                    }
                  }
                  if (reachable && branchesOverlap(atoms[j].text, atoms[k].text)) {
                    return true;
                  }
                }
                if (!atoms[k].isNullable) break;
              }
            }

            // Check wrap-around overlap across iterations
            for (var j = 0; j < atoms.length; j++) {
              var canReachEnd = true;
              for (var trail = j + 1; trail < atoms.length; trail++) {
                if (!atoms[trail].isNullable) {
                  canReachEnd = false;
                  break;
                }
              }
              if (!canReachEnd) continue;

              for (var k = 0; k < atoms.length; k++) {
                var canReachFromStart = true;
                for (var lead = 0; lead < k; lead++) {
                  if (!atoms[lead].isNullable) {
                    canReachFromStart = false;
                    break;
                  }
                }
                if (!canReachFromStart) continue;

                if (j === k) {
                  var allOtherNullable = true;
                  for (var o = 0; o < atoms.length; o++) {
                    if (o !== j && !atoms[o].isNullable) {
                      allOtherNullable = false;
                      break;
                    }
                  }
                  if (!allOtherNullable) continue;
                }

                if (atoms[j].isRepetition || atoms[k].isRepetition) {
                  if (branchesOverlap(atoms[j].text, atoms[k].text)) {
                    return true;
                  }
                }
              }
            }
          }
        }

        currentBranch.atoms.push({
          text: pattern.slice(atomStart, end + 1),
          isRepetition: isRep || innerIsRep,
          isNullable: isNull || innerIsNull
        });
        continue;
      }

      atomStart = i;
      var q = parseQuantifierToken(pattern, i + 1);
      var end = i;
      var isRep = false;
      var isNull = false;
      if (q) {
        isRep = q.isRepetition;
        isNull = q.isNullable;
        end = q.end;
        i = q.end;
      }
      var curBranch = currentFrame.branches[currentFrame.branches.length - 1];
      curBranch.atoms.push({
        text: pattern.slice(atomStart, end + 1),
        isRepetition: isRep,
        isNullable: isNull
      });
    }

    return false;
  };

  var urlPatternCtor = function() {
    if (typeof globalThis !== "undefined" && globalThis.URLPattern) return globalThis.URLPattern;
    if (typeof window !== "undefined" && window.URLPattern) return window.URLPattern;

    return null;
  };

  // Validates custom regex groups in URLPattern syntax for regular expression validity
  // and cross-engine parity (tm-urlpattern-custom-groups-unvalidated).
  var validateUrlPatternGroups = function(path) {
    var escaped = false;
    for (var i = 0; i < path.length; i++) {
      var c = path[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (c === "\\") {
        escaped = true;
        continue;
      }
      if (c === "(") {
        var start = i + 1;
        var depth = 1;
        var innerEscaped = false;
        var innerInCharClass = false;
        var end = -1;
        for (var j = start; j < path.length; j++) {
          var ch = path[j];
          if (innerEscaped) {
            innerEscaped = false;
            continue;
          }
          if (ch === "\\") {
            innerEscaped = true;
            continue;
          }
          if (innerInCharClass) {
            if (ch === "]") innerInCharClass = false;
            continue;
          }
          if (ch === "[") {
            innerInCharClass = true;
            continue;
          }
          if (ch === "(") {
            depth++;
          } else if (ch === ")") {
            depth--;
            if (depth === 0) {
              end = j;
              break;
            }
          }
        }
        if (end === -1) {
          throw new Error("leviroutes: route " + JSON.stringify(path) +
            " contains unclosed '(' in custom regex group");
        }

        var inner = path.slice(start, end);

        // Check for engine parity: Firefox < 149 does not support lookahead/lookbehind
        // assertions inside custom regex groups (Bugzilla 1998871; docs/urlpattern-investigation.md).
        if (inner[0] === "?" && (inner[1] === "=" || inner[1] === "!" || inner.slice(1, 3) === "<=" || inner.slice(1, 3) === "<!")) {
          throw new Error("leviroutes: route " + JSON.stringify(path) +
            " uses lookaround assertion in custom regex group which lacks cross-engine parity in URLPattern");
        }

        if (hasNestedQuantifiers(inner)) {
          throw new Error("leviroutes: route " + JSON.stringify(path) +
            " contains nested quantifiers in custom regex group susceptible to catastrophic backtracking");
        }

        var lookaroundEscaped = false;
        var lookaroundInCharClass = false;
        for (var k = 0; k < inner.length; k++) {
          var ik = inner[k];
          if (lookaroundEscaped) {
            lookaroundEscaped = false;
            continue;
          }
          if (ik === "\\") {
            lookaroundEscaped = true;
            continue;
          }
          if (lookaroundInCharClass) {
            if (ik === "]") lookaroundInCharClass = false;
            continue;
          }
          if (ik === "[") {
            lookaroundInCharClass = true;
            continue;
          }
          if (ik === "(" && inner[k + 1] === "?") {
            var next2 = inner.slice(k + 2, k + 4);
            if (next2[0] === "=" || next2[0] === "!" || next2 === "<=" || next2 === "<!") {
              throw new Error("leviroutes: route " + JSON.stringify(path) +
                " uses lookaround assertion in custom regex group which lacks cross-engine parity in URLPattern");
            }
          }
        }

        // Validate regular expression syntax
        try {
          new RegExp("(" + inner + ")");
        } catch (e) {
          throw new Error("leviroutes: custom regex group in route " + JSON.stringify(path) +
            " is not a valid regular expression: " + e.message);
        }

        i = end;
      }
    }
  };

  // Compiled shape for the urlpattern matcher: { pattern, groups, regexp: null }.
  // 'groups' is empty because URLPattern reports its own groups at match time.
  var compileUrlPattern = function(path) {
    var Ctor = urlPatternCtor();

    if (!Ctor) {
      throw new Error("leviroutes: the 'urlpattern' matcher needs the URL Pattern API " +
        "(available natively in current browsers and Node 24+, or via urlpattern-polyfill)");
    }

    validateUrlPatternGroups(path);

    try {
      // Path-only patterns keep host and protocol wildcards, so a bare pathname from
      // document.location can be passed straight to test()/exec().
      return { "pattern": new Ctor({ "pathname": path }), "groups": {}, "regexp": null };
    } catch (error) {
      // A regex-flavoured route ('/foo+', '/a|b') is not a URL pattern. Name the route:
      // the raw "Failed to construct URLPattern" is unusable in a migration.
      throw new Error("leviroutes: route " + JSON.stringify(path) + " is not a valid URL pattern: " +
        error.message);
    }
  };

  var countCaptureGroups = function(reStr) {
    var count = 0;
    var inCharClass = false;
    var escaped = false;
    for (var i = 0; i < reStr.length; i++) {
      var c = reStr[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (c === "\\") {
        escaped = true;
        continue;
      }
      if (inCharClass) {
        if (c === "]") inCharClass = false;
        continue;
      }
      if (c === "[") {
        inCharClass = true;
        continue;
      }
      if (c === "(") {
        if (reStr[i + 1] === "?") {
          // (?<name> is a named capturing group; (?:, (?=, (?!, (?<=, (?<! are non-capturing
          if (reStr[i + 2] === "<" && reStr[i + 3] !== "=" && reStr[i + 3] !== "!") {
            count++;
          }
        } else {
          count++;
        }
      }
    }
    return count;
  };

  // Dot-escaping for raw route text: a dot that is already regex-escaped ('\.')
  // is literal and must be left alone - escaping it again yields '\\.', a literal
  // backslash followed by "any character", so '/a\.b' stops matching '/a.b'
  // (leviroutes-np4). A lookbehind cannot decide this: in '\\.' the backslash
  // before the dot is itself escaped, so that dot is NOT escaped and must still be
  // made literal. A left-to-right scan tracking the escape state handles both.
  var escapeUnescapedDots = function(text) {
    var out = "";
    var escaped = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (escaped) {
        out += c;
        escaped = false;
        continue;
      }
      if (c === "\\") {
        escaped = true;
        out += c;
        continue;
      }
      out += (c === ".") ? "\\." : c;
    }
    return out;
  };

  // Audits the assembled route regex body to ensure no unmatched ')' can escape
  // the outer ^(?:...)$ wrapper and unanchor subsequent alternatives or prefixes
  // (tm-anchor-wrapper-escapable-by-route-text, leviroutes-bym, leviroutes-2io).
  var auditRouteStructure = function(body, originalPath) {
    var depth = 0;
    var inCharClass = false;
    var escaped = false;
    for (var i = 0; i < body.length; i++) {
      var c = body[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (c === "\\") {
        escaped = true;
        continue;
      }
      if (inCharClass) {
        if (c === "]") inCharClass = false;
        continue;
      }
      if (c === "[") {
        inCharClass = true;
        continue;
      }
      if (c === "(") {
        depth++;
      } else if (c === ")") {
        depth--;
        if (depth < 0) {
          throw new Error("leviroutes: route " + JSON.stringify(originalPath) +
            " contains unmatched ')' that alters route anchoring");
        }
      }
    }
    if (depth !== 0) {
      throw new Error("leviroutes: route " + JSON.stringify(originalPath) +
        " contains unclosed '(' in route pattern");
    }
    if (hasNestedQuantifiers(body)) {
      throw new Error("leviroutes: route " + JSON.stringify(originalPath) +
        " contains nested quantifiers in custom regex group susceptible to catastrophic backtracking");
    }
    try {
      new RegExp(body);
    } catch (err) {
      throw new Error("leviroutes: route " + JSON.stringify(originalPath) +
        " is not a valid regular expression: " + err.message);
    }
  };

  this.parseRoute = function(path) {
    if (typeof path !== "string") {
      throw new Error("leviroutes: route pattern must be a string");
    }
    if (path.length > MAX_PATTERN_LENGTH) {
      throw new Error("leviroutes: route pattern exceeds maximum length of " +
        MAX_PATTERN_LENGTH + " characters");
    }

    if (matcherKind === "urlpattern") return compileUrlPattern(path);

    this.parseGroups = function(loc) {
      var nameRegexp = new RegExp(":([^/.(\\\\]+)(\\((?:[^\\\\)]|\\\\.)*\\))?", "g"); 
      var groups = {};
      var matches = null;
      var lastIndex = 0;
      var newRegexp = "";
      var count = 0;

      // Find the places to edit.
      while(matches = nameRegexp.exec(loc)) {
        if (matches.index > 1 && loc.slice(matches.index - 2, matches.index) === "(?") {
          continue;
        }
        var chunk = loc.slice(lastIndex, matches.index);
        count += countCaptureGroups(chunk);
        // A literal dot in a route is path punctuation, not the regular-expression "any
        // character": without this, '/:category.:format' matches '/foo' with
        // {category: 'f', format: 'o'}, and '/a/b.json' with {category: 'b'}. Other
        // regular-expression syntax in a route is deliberately left untouched - which
        // includes a dot the route author already escaped, so only unescaped dots are
        // escaped here.
        newRegexp += escapeUnescapedDots(chunk);

        var replacement = matches[2] ? matches[2] : "([^/.\\\\]+)";
        var captures = countCaptureGroups(replacement);
        if (matches[2] && captures === 0) {
          throw new Error("custom pattern for :" + matches[1] + " contains no capturing group");
        }
        groups[matches[1]] = count;
        count += captures;
        newRegexp += replacement;
        lastIndex = matches.index + matches[0].length;
      }

      var tail = loc.slice(lastIndex);
      var body = newRegexp + escapeUnescapedDots(tail);

      // Audit the assembled body: verify parenthesis nesting so an unescaped ')'
      // inside route text cannot close the ^(?:...)$ wrapper early and unanchor
      // subsequent alternatives or prefixes (leviroutes-bym, leviroutes-2io).
      auditRouteStructure(body, loc);

      // Match the whole path: end-anchored so '/category' does not match
      // '/category/extra', start-anchored so '/user/:id' does not match '/deep/user/42'
      // (the old end-only anchor was an accident that made every route a suffix match).
      // The anchors must bind to the whole route, not to the first and last alternative:
      // a bare "^" + route + "$" makes §/index.html|/§ compile to /^\/index\.html|\/$/,
      // which also matches '/x/' - a path neither alternative names (leviroutes-bym). The
      // group is non-capturing, so every recorded group index in 'groups' is unchanged.
      newRegexp = "^(?:" + body + ")$"; 

      return { "groups" : groups, "regexp": new RegExp(newRegexp)};
    };
      
    return this.parseGroups(path); 
  };

  this.use = function(middleware) {
    _middleware.push(middleware);
  };

  // Routes match a path, so an absolute URL (a form's action resolves to one) is
  // reduced to its pathname before matching. Without this, anchoring at '^' would
  // stop POST interception working, which the end-only anchor used to hide.
  var pathnameOf = function(url) {
    if (typeof url !== "string") return url;

    try {
      var base = (typeof document !== "undefined" && document.baseURI) || "http://localhost/";
      return new URL(url, base).pathname;
    } catch (e) {
      return url;
    }
  };

  var matchRoute = function(url, e, server) {
    var route = null;
    var path = pathnameOf(url);
    if (typeof path !== "string" || path.length > MAX_PATH_LENGTH) {
      return false;
    }
    for(var i = 0; route = _routes[i]; i ++) {
      var params = null;

      // Server dispatch is method-aware; the browser paths pass no server argument
      // and keep the historical behaviour of matching a URL regardless of method.
      // matchMethod differs from the request's method only for HEAD, which is
      // routed to GET handlers (RFC 9110 s9.3.2: HEAD is GET without the body).
      if(server && route.method !== server.matchMethod) continue;

      if (route.regex.pattern) {
        // Matching is on the pathname, so the origin is irrelevant - but it must be
        // present: Chrome returns null for a bare path string passed to URLPattern.exec()
        // (it parses the input as a URL), while Node accepts it. Passing an absolute URL
        // keeps both engines on the same path, which is not something a Node-only test
        // would catch.
        var patternMatch = route.regex.pattern.exec(URLPATTERN_ORIGIN + path);
        if (!patternMatch) continue;

        // Only named groups become req.params: URLPattern also reports positional
        // keys ('0', '1', ...) for wildcards, which are not named parameters.
        params = Object.create(null);
        var named = patternMatch.pathname.groups;
        for(var name in named) {
          if (/^\d+$/.test(name) == false && typeof named[name] === "string") params[name] = named[name];
        }
      } else {
        var routeMatch = route.regex.regexp.exec(path);
        if(!!routeMatch == false) continue;

        params = Object.create(null);
        for(var g in route.regex.groups) {
          var group = route.regex.groups[g];
          params[g] = routeMatch[group + 1];
        }
      }

      var values = Object.create(null);
      var valuesCount = 0;
      if(e && e.target instanceof HTMLFormElement) {
        var form = e.target;
        var controls = form.elements || form;
        var count = controls.length;
        var item;
        for(var j = 0; j < count; j++) {
          item = controls[j] || form[j];
          if(item && !!item.name) {
            // Last-wins semantics for duplicate field names (leviroutes-ghj),
            // and bound distinct keys to MAX_VALUES_COUNT.
            if (!(item.name in values)) {
              if (valuesCount >= MAX_VALUES_COUNT) continue;
              valuesCount++;
            }
            values[item.name] = item.value;
          }
        }
      }

      // On the server there is no form to read values from; the query string is
      // the equivalent carrier, so its parameters become req.values.
      // Duplicate search parameters predictably collapse to the last value (last-wins),
      // bounded to at most MAX_VALUES_COUNT distinct keys.
      if(server) {
        try {
          var parsed = new URL(url, "http://localhost/");
          parsed.searchParams.forEach(function(value, name) {
            if (!(name in values)) {
              if (valuesCount >= MAX_VALUES_COUNT) return;
              valuesCount++;
            }
            values[name] = value;
          });
        } catch (err) { /* an unparseable URL simply has no values */ }
      }

      var req = {"url": url, "params": params, "values" : values, "e": e};
      if(server) {
        req.method = server.method;
        req.request = server.request;
        req.response = server.response;
      }
      
      // Execute middleware chain
      var middlewareIndex = 0;
      var aborted = false;
      var handled = false;
      var next = function() {
        if (aborted) return;
        if (middlewareIndex < _middleware.length) {
          var middleware = _middleware[middlewareIndex++];
          middleware(req, next);
        } else {
          // All middleware executed, call the route callback
          handled = true;
          route.callback(req);
        }
      };
      
      // A synchronous server middleware can explicitly transfer responsibility
      // back to the caller. Without that signal, no immediate next() is also a
      // valid deferred next(), so a matched route must still count as handled.
      // Once the route callback executes (handled = true), dispatch() always reports
      // handled: a late abort afterwards cannot un-handle an executed route.
      next.abort = function() { aborted = true; };

      // Start middleware execution
      next();

      return !server || handled || !aborted || !!(server.response &&
        (server.response.headersSent || server.response.writableEnded || server.response.finished));
    }

    return false;
  };

  this.get = function(route, callback) {
    _routes.push({regex: this.parseRoute(route), "callback": callback, method: "get"});
  };

  this.post = function(route, callback) {
    _routes.push({regex: this.parseRoute(route), "callback": callback, method: "post"});
  };

  this.test = function(url) {
    matchRoute(url);
  };

  // Server-side entry point (GH #1): route a Node http.IncomingMessage, a Web
  // Fetch Request, or a plain URL string through the same route table the
  // browser uses. Matching honours the method each route was registered with
  // (get/post), unlike the browser paths which stay method-agnostic for
  // backwards compatibility. Returns true when a route matches, unless server
  // middleware explicitly calls next.abort() before returning without
  // committing the response; the caller can then send its own fallback. If the
  // route handler has already executed, dispatch() returns true even if
  // middleware calls next.abort() afterwards; a late abort cannot un-handle a
  // request whose callback ran.
  this.dispatch = function(request, response) {
    var url;
    var method;

    if(typeof request === "string") {
      url = request;
      method = "get";
    } else if(request && typeof request.url === "string") {
      // http.IncomingMessage exposes a relative url ('/path?query'); a Fetch
      // Request exposes an absolute one - pathnameOf() reduces both.
      url = request.url;
      method = (request.method || "get").toLowerCase();
    } else {
      throw new Error("leviroutes: dispatch() needs a URL string, an http.IncomingMessage, or a Fetch Request");
    }

    // HEAD is defined as GET without the body, so it routes to GET handlers; the
    // handler still writes its body and the server runtime strips it. req.method
    // keeps the real method so a handler can tell the two apart.
    var matchMethod = method === "head" ? "get" : method;

    return matchRoute(url, null, {method: method, matchMethod: matchMethod, request: request, response: response});
  };

  this.getRoutes = function() {
    return _routes;
  };

  var attach = function() {
    // Only attach browser-specific event handlers if in a browser environment
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }

    var triggered = false;

    // The only duplicate a navigation event can be is the second half of ONE fragment
    // navigation: the browser fires popstate and then hashchange for a single location
    // change, so the first handler routes it and the second must not route it again.
    // Nothing else is suppressed. An earlier version also suppressed any event reporting a
    // location the router had already routed for, which swallowed the first real Back
    // press after load (leviroutes-s8o); keeping pushState as an exception then swallowed
    // the second of two same-URL Back presses (leviroutes-jy0, src/routes.js:224-225),
    // because a state-only history entry looks exactly like the load-time location. The
    // pair above needs no URL-based guesswork: the event kind says which case it is.
    //
    // Consequence, stated rather than hidden: a browser that fires a spurious popstate
    // right after load - the reason the original load-time guard existed - now fires that
    // route a second time, because such a popstate is indistinguishable from a Back press
    // onto a state-only entry, and that press must route. That behaviour is long gone from
    // current browsers (WebKit fixed it in 2011) and is not worth losing real Back presses.
    var lastRoutedUrl = null;
    var lastRoutedBy = null;

    var currentUrl = function() {
      var loc = document.location;
      return loc.pathname + loc.search + loc.hash;
    };

    var markRouted = function(by) {
      lastRoutedUrl = currentUrl();
      lastRoutedBy = by;
    };

    // true only for the second event of one fragment navigation.
    var isPairedNavigationEvent = function(by) {
      if (lastRoutedUrl !== currentUrl()) return false;
      if (by === "popstate") return lastRoutedBy === "hashchange";
      if (by === "hashchange") return lastRoutedBy === "popstate";
      return false;
    };

    // Add a new event to HTML5 History
    if(!!window.history && !!window.history.pushState) {
      
      var pushStateProxy = history.__proto__.pushState;

      history.__proto__.pushState = function(state, title, url) {
        pushStateProxy.apply(history, arguments);

        // No route runs for a pushState, but the location moved: record it so the Back
        // that follows reads as a traversal rather than as the paired half of a
        // fragment navigation.
        markRouted("pushState");

        //var evt = document.createEvent("PopStateEvent");
        //evt.initPopStateEvent("statechange", false, false, state);
        var evt = document.createEvent("Event");
        evt.initEvent("statechanged",false, false);
        evt.state = state;
        window.dispatchEvent(evt);
        return;
      };
    }

    me.run = function() {
      if(!triggered) {
        matchRoute(document.location.pathname);
        triggered = true;
        markRouted("run");
      }
    };

    // Intercept FORM submissions.
    window.addEventListener("submit", function(e) {
      if(e.target.method == "post") {
        var matched;
        try {
          matched = matchRoute(e.target.action, e);
        } catch (err) {
          // matchRoute only runs its middleware chain after a route matched, so a
          // throw here belongs to a matched route's handler. Without this guard the
          // error would unwind past preventDefault() and the browser would perform
          // the native POST to the form action - potentially cross-origin - with
          // the error visible only in the console (leviroutes-303). Prevent the
          // native submit, then rethrow so the failure stays loud.
          e.preventDefault();
          throw err;
        }
        if (matched) {
           e.preventDefault();
           return false;
        }
      }
      // If we haven't matched a URL let the normal request happen. 
      return true;
    });

    // popstate and hashchange share one handler because they describe the same
    // navigation: a fragment navigation fires popstate and then hashchange for one
    // location, so the second event matches routedUrl and does not fire again.
    var routeOnNavigation = function(e) {
      var by = (e && e.type === "hashchange") ? "hashchange" : "popstate";

      if(isPairedNavigationEvent(by)) return;

      matchRoute(document.location.pathname);
      markRouted(by);
    };

    window.addEventListener("popstate", routeOnNavigation, false);

    window.addEventListener("load", function(e) {
      if(!triggered) {
        matchRoute(document.location.pathname);
        triggered = true;
      }

      markRouted("load");
    }, false);

    window.addEventListener("hashchange", routeOnNavigation, false);
  };

  attach();
};

export default routes;
