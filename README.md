LeviRoutes
==========

> **⚠️ DISCLAIMER:** This project has not been updated or maintained for a long time. While I might add more features in the future, please do not rely on this project for production use or active development.

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
