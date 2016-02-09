LeviRoutes
==========

A simple lightweight routes framework for hooking in to HTML5 history.  Currently when the system pop's state the route is triggered if matched.

```js
var app = new routes();

app.get("/", function(req) {
  alert("State popped for /");
});
```

It also named parameters for route syntax

```js
app.get("/:category", function(req) {
  alert("In " + req.params.category);
});

app.get("/:category.:format", function(req) {
  alert("format: " + req.params.format);
});
```

LeviRoutes can also intercept POST requests via forms, the framework will intercept all submits, and naturally let through requests that don't match the path, whilst firing your callback if there is a mathc

```js
app.post("/:category", function(req) {
  alert("posting form: In Category ", req.params.category);
});
```
