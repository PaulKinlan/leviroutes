# LeviRoutes Examples

This directory contains working examples demonstrating the features of LeviRoutes.

## Running the Examples

To run these examples locally, you'll need a local web server. You can use any of these options:

### Using Python
```bash
# Python 3
python -m http.server 8000

# Python 2
python -m SimpleHTTPServer 8000
```

### Using Node.js (http-server)
```bash
npx http-server -p 8000
```

### Using PHP
```bash
php -S localhost:8000
```

Then navigate to `http://localhost:8000/examples/client/` and open any of the example HTML files.

## Available Examples

### 1. GET Example (`get-example1/`)
**Files:** `example.html`, `page2.html`

Demonstrates basic GET routing with HTML5 History API. Shows how to:
- Define GET routes
- Handle browser navigation (back/forward buttons)
- Intercept link clicks and use pushState

**Try it:** Click between pages and use browser back/forward buttons to see routes trigger.

### 2. POST Example (`post-example1/`)
**Files:** `example.html`, `post2.html`

Demonstrates POST form interception. Shows how to:
- Define POST routes
- Intercept form submissions
- Access form values
- Selectively handle forms (some intercepted, some passed through)

**Try it:** Submit the forms to see the difference between intercepted and non-intercepted forms.

### 3. Middleware Example (`middleware-example.html`)

Demonstrates the middleware system. Shows how to:
- Register multiple middleware functions
- Execute middleware in order
- Pass data between middleware and route handlers
- Use the `next()` callback

**Try it:** Open the page to see middleware execution logged in order.

### 4. Named Parameters Example (`named-params-example/index.html`)

Comprehensive demonstration of named parameters in routes. Shows how to:
- Define routes with single parameters (`:username`)
- Use multiple parameters (`:username/:postId`)
- Extract parameter values from the URL
- Handle format specifiers (`:category.:format`)
- Navigate programmatically with parameters

**Try it:** Click the navigation links to see how parameters are extracted and displayed.

### 5. Complete SPA Example (`spa-example/index.html`)

A full-featured single-page application showcasing all LeviRoutes features. Includes:
- Multiple pages with navigation
- Named parameter routes for dynamic content
- Middleware for logging and state management
- POST form handling with validation
- Error handling (404 pages)
- Styled UI with animations
- Real-world patterns and best practices

**Try it:** Explore the full SPA with home, about, blog, users, and contact pages.

## Example Features Covered

| Feature | GET Example | POST Example | Middleware Example | Named Params | Complete SPA |
|---------|-------------|--------------|-------------------|--------------|--------------|
| Basic routing | ✓ | ✓ | ✓ | ✓ | ✓ |
| Named parameters | - | - | - | ✓ | ✓ |
| Form handling | - | ✓ | - | - | ✓ |
| Middleware | - | - | ✓ | - | ✓ |
| HTML5 History | ✓ | - | - | ✓ | ✓ |
| Error handling | - | - | - | - | ✓ |
| Dynamic rendering | - | - | - | ✓ | ✓ |

## Notes

- All examples use the non-minified `routes.js` from the project root for easier debugging
- Examples are designed to work in modern browsers that support ES6+ and HTML5 History API
- The examples demonstrate client-side routing only (no server-side components required)

## Building Your Own

To create your own example:

1. Create a new HTML file
2. Import LeviRoutes:
   ```html
   <script type="module">
     import routes from '../../src/routes.js';
     const app = new routes();
     // ... your code
   </script>
   ```
3. Define your routes and middleware
4. Test in a browser with a local web server

See the main [README.md](../../README.md) for full API documentation.
