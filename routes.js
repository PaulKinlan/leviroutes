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

var routes = function() {
  var routes = [];

  this.parseRoute = function(path) {
    this.parseGroups = function(loc) {
      var nameRegexp = new RegExp(":([^/.\\\\]+)", "g"); 
      var newRegexp = "" + loc;
      var groups = {};
      var matches = null;
      var i = 0;

      // Find the places to edit.
      while(matches = nameRegexp.exec(loc)) {
        groups[matches[1]] = i++;
        newRegexp = newRegexp.replace(matches[0], "([^/.\\\\]+)"); 
      }

      newRegexp += "$"; // Only do a full string match

      return { "groups" : groups, "regexp": new RegExp(newRegexp)};
    };
      
    return this.parseGroups(path); 
  };

  var matchRoute = function(url) {
    var route = null;
    for(var i = 0; route = routes[i]; i ++) {
      var routeMatch = route.regex.regexp.exec(url);
      if(!!routeMatch == false) continue;
      
      var params = {};
      for(var g in route.regex.groups) {
        var group = route.regex.groups[g];
        params[g] = routeMatch[group + 1];
      }
      
      route.callback({"url": url, "params": params});
      return;
    }
  };

  this.get = function(route, callback) {
    routes.push({regex: this.parseRoute(route), "callback": callback});
  };

  this.test = function(url) {
    matchRoute(url);
  };

  this.getRoutes = function() {
    return routes;
  };

  var attach = function() {
    var triggered = false;
    var cancelHashChange = false;
    var cancelPopstate = false;
    window.addEventListener("popstate", function(e) {
      if(cancelPopstate) {
        cancelPopstate = false;
        return;
      }

      matchRoute(document.location.pathname);
      // popstate fires before a hash change, don't fire twice.
      cancelHashChange = true;

    }, false);

    window.addEventListener("load", function(e) {
      matchRoute(document.location.pathname);
      cancelHashChange = true;
      cancelPopstate = true;
    }, false);

    window.addEventListener("hashchange", function(e) {
      if(cancelHashChange) {
        cancelHashChange = false;
        return;
      }
      matchRoute(document.location.pathname);
    }, false);
  };

  attach();
};
