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

const routes = function() {
  var _routes = [];
  var _middleware = [];
  var me = this;

  this.parseRoute = function(path) {
    this.parseGroups = function(loc) {
      var nameRegexp = new RegExp(":([^/.\\\\]+)", "g"); 
      // A literal dot in a route is path punctuation, not the regular-expression "any
      // character": without this, '/:category.:format' matches '/foo' with
      // {category: 'f', format: 'o'}, and '/a/b.json' with {category: 'b'}. Other
      // regular-expression syntax in a route is deliberately left untouched.
      var newRegexp = "" + loc.replace(/\./g, "\\.");
      var groups = {};
      var matches = null;
      var i = 0;

      // Find the places to edit.
      while(matches = nameRegexp.exec(loc)) {
        groups[matches[1]] = i++;
        newRegexp = newRegexp.replace(matches[0], "([^/.\\\\]+)"); 
      }

      // Match the whole path: end-anchored so '/category' does not match
      // '/category/extra', start-anchored so '/user/:id' does not match '/deep/user/42'
      // (the old end-only anchor was an accident that made every route a suffix match).
      newRegexp = "^" + newRegexp + "$"; 

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

  var matchRoute = function(url, e) {
    var route = null;
    var path = pathnameOf(url);
    for(var i = 0; route = _routes[i]; i ++) {
      var routeMatch = route.regex.regexp.exec(path);
      if(!!routeMatch == false) continue;
      
      var params = {};
      for(var g in route.regex.groups) {
        var group = route.regex.groups[g];
        params[g] = routeMatch[group + 1];
      }

      var values = {};
      if(e && e.target instanceof HTMLFormElement) {
        var form = e.target;
        var items = form.length;
        var item;
        for(var j = 0; item = form[j]; j++) {
          if(!!item.name) values[item.name] = item.value;
        }
      }
      
      var req = {"url": url, "params": params, "values" : values, "e": e};
      
      // Execute middleware chain
      var middlewareIndex = 0;
      var next = function() {
        if (middlewareIndex < _middleware.length) {
          var middleware = _middleware[middlewareIndex++];
          middleware(req, next);
        } else {
          // All middleware executed, call the route callback
          route.callback(req);
        }
      };
      
      // Start middleware execution
      next();
      
      return true;
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

  this.getRoutes = function() {
    return _routes;
  };

  var attach = function() {
    // Only attach browser-specific event handlers if in a browser environment
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }

    var triggered = false;
    var cancelHashChange = false;
    var cancelPopstate = false;

    // Add a new event to HTML5 History
    if(!!window.history && !!window.history.pushState) {
      
      var pushStateProxy = history.__proto__.pushState;

      history.__proto__.pushState = function(state, title, url) {
        pushStateProxy.apply(history, arguments);

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
      }
    };

    // Intercept FORM submissions.
    window.addEventListener("submit", function(e) {
      if(e.target.method == "post") {
        if (matchRoute(e.target.action, e)) {
           e.preventDefault();
           return false;
        }
      }
      // If we haven't matched a URL let the normal request happen. 
      return true;
    });

    window.addEventListener("popstate", function(e) {
      if(cancelPopstate) {
        cancelPopstate = false;
        cancelHashChange = false;
        return;
      }

      matchRoute(document.location.pathname);
      // popstate fires before a hash change, don't fire twice.
      cancelHashChange = true;
    }, false);

    window.addEventListener("load", function(e) {
      if(!triggered) {
        matchRoute(document.location.pathname);
        triggered = true;
      }

      cancelHashChange = true;
      cancelPopstate = true;
    }, false);

    window.addEventListener("hashchange", function(e) {
      if(cancelHashChange) {
        cancelHashChange = false;
        cancelPopstate = false;
        return;
      }
      matchRoute(document.location.pathname);
    }, false);
  };

  attach();
};

export default routes;
