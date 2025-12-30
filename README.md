LeviRoutes
==========

> **⚠️ DISCLAIMER:** This project has not been updated or maintained for a long time. While I might add more features in the future, please do not rely on this project for production use or active development.

A simple lightweight routes framework for hooking in to HTML5 history.  Currently when the system pop's state the route is triggered if matched.

LeviRoutes can also intercept POST requests via forms, the framework will intercept all submits, and naturally let through requests that don't match the path, whilst firing your callback if there is a match

## Installation

Install via npm:

```bash
npm install leviroutes
```

Or use it directly from a CDN with ES modules:

```html
<script type="module">
  import routes from 'https://esm.sh/leviroutes';
  
  const app = new routes();
  // ... use the library
</script>
```

## Usage

### ES Modules (Recommended)

```javascript
import routes from 'leviroutes';

const app = new routes();

app.get("/", function(req) {
  alert("State popped for /");
});
```

### Classic Script Tag

```html
<script type="module">
  import routes from './node_modules/leviroutes/src/routes.js';
  
  const app = new routes();
  // ...
</script>
```

## Features

### Basic Routing

```javascript
const app = new routes();

app.get("/", function(req) {
  alert("State popped for /");
});

### Named Parameters

It also has named parameters for route syntax.

```javascript
app.get("/:category", function(req) {
  alert("In " + req.params.category);
});

app.get("/:category.:format", function(req) {
  alert("format: " + req.params.format);
});
```

### POST Request Handling

LeviRoutes can also intercept POST requests via forms, intercept all submits, and naturally let through requests that don't match the path, whilst firing your callback if there is a match.

```javascript
app.post("/:category", function(req) {
  alert("posting form: In Category " + req.params.category);
});
```

## Middleware Support

LeviRoutes supports middleware functions that execute before route handlers. Middleware functions receive the request object and a `next` callback.

```javascript
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
```

Middleware functions are executed in the order they are registered, before any route handler is called.

## Development

### Running Tests

```bash
npm test
```

### Building

The build process creates a minified version in `dist/routes.min.js`:

```bash
npm run build
```

## License

Licensed under the Apache License, Version 2.0. See the [LICENCE](LICENCE) file for details.
