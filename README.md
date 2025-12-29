LeviRoutes
==========

> **⚠️ Maintenance Notice:** This project is no longer actively maintained. While it may still work for your use case, please be aware that issues and pull requests may not be addressed.

A simple lightweight routes framework for hooking in to HTML5 history.  Currently when the system pop's state the route is triggered if matched.

    var app = new routes();

    app.get("/", function(req) {
      alert("State popped for /");
    });

It also has named parameters for route syntax.

    app.get("/:category", function(req) {
      alert("In " + req.params.category);
    });

    app.get("/:category.:format", function(req) {
      alert("format: " + req.params.format);
    });

LeviRoutes can also intercept POST requests via forms, intercept all submits, and naturally let through requests that don't match the path, whilst firing your callback if there is a match.

    app.post("/:category", function(req) {
      alert("posting form: In Category " + req.params.category);
    });

## Middleware Support

LeviRoutes supports middleware functions that execute before route handlers. Middleware functions receive the request object and a `next` callback.

    app.use(function(req, next) {
      console.log("Request to: " + req.url);
      next(); // Call next to continue to the next middleware or route handler
    });

    app.use(function(req, next) {
      req.timestamp = Date.now();
      next();
    });

    app.get("/", function(req) {
      alert("Request timestamp: " + req.timestamp);
    });

Middleware functions are executed in the order they are registered, before any route handler is called.
