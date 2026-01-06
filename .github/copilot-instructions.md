# Copilot Instructions for LeviRoutes

## Project Overview
LeviRoutes is a lightweight JavaScript routing framework for HTML5 History API. It enables client-side routing with support for GET/POST methods, named parameters, and middleware.

**⚠️ Note**: This is a legacy project that is not actively maintained. Changes should maintain backward compatibility and the minimal footprint philosophy.

## Technology Stack
- **Language**: JavaScript (ES Modules)
- **Testing**: Jasmine 5.1.0
- **Build**: Terser for minification
- **Environment**: Browser-based (with Node.js for testing via jsdom)

## Project Structure
```
src/
  routes.js           # Main routing framework (single file, ~190 lines)
spec/
  *.spec.mjs         # Jasmine test files
  support/           # Test configuration
  helpers/           # Test helpers
examples/
  client/            # Example implementations
tests/               # Legacy test files
dist/
  routes.min.js      # Minified build output (generated)
```

## Coding Conventions

### JavaScript Style
- Use `var` for variable declarations (legacy ES5 style maintained for consistency)
- Use constructor functions, not ES6 classes
- Export using ES modules: `export default routes;`
- Private variables prefixed with underscore: `_routes`, `_middleware`
- Use function expressions for internal functions

### Code Patterns
- **Route definition**: Routes stored as objects with `regex`, `callback`, and `method` properties
- **Named parameters**: Parse `:paramName` syntax into regex groups
- **Middleware chain**: Execute middleware sequentially via `next()` callback pattern
- **Request object**: `{ url, params, values, e }` structure

### Browser Detection
Always check for browser environment before accessing DOM:
```javascript
if (typeof window === 'undefined' || typeof document === 'undefined') {
  return;
}
```

## Development Workflow

### Installing Dependencies
```bash
npm install
```

### Running Tests
```bash
npm test
```
- All tests must pass before committing
- Tests use Jasmine with jsdom for DOM emulation
- Test files end with `.spec.mjs`

### Building
```bash
npm run build
```
- Creates minified version at `dist/routes.min.js`
- Build runs automatically before publish (`prepublishOnly`)
- Uses Terser for compression

### Testing Locally
Start a local web server to test examples:
```bash
# Example with Python
python -m http.server 8000
# Then navigate to http://localhost:8000/examples/
```

## Common Tasks

### Adding a New Route Method
1. Add method to routes constructor function
2. Push to `_routes` array with appropriate method type
3. Add tests in `spec/routemanagement.spec.mjs`
4. Update README.md with usage example

### Adding Middleware Features
1. Modify middleware chain in `matchRoute` function
2. Ensure `next()` callback pattern is preserved
3. Add tests in `spec/middleware.spec.mjs`
4. Document in README.md

### Modifying Route Parsing
1. Edit `parseRoute` or `parseGroups` functions
2. Update regex patterns carefully (affects backward compatibility)
3. Add comprehensive tests in `spec/routeparsing.spec.mjs`
4. Test with existing examples

## Testing Guidelines

### Test Structure
```javascript
import routes from '../src/routes.js';

describe("feature name", function() {
  var r;
  beforeEach(function() {
    r = new routes();
  });

  it("should describe expected behavior", function() {
    // Test implementation
    expect(result).toEqual(expected);
  });
});
```

### Test Coverage Areas
- Route parsing and regex generation
- Named parameter extraction
- Middleware execution order
- GET/POST method handling
- Browser environment detection

## Common Pitfalls

### RegExp Escaping
- Route patterns need proper escaping: `[^/.\\\\]+`
- Test regex patterns thoroughly with special characters

### Middleware Chain
- Always call `next()` to continue the chain
- Middleware executes before route callback
- Order matters: middleware runs in registration order

### Browser API Usage
- Always check for browser environment availability
- Don't assume `window`, `document`, or `history` exist
- Use feature detection, not browser detection

### History API
- Proxy `pushState` to add custom event support
- Handle both `popstate` and `hashchange` events
- Prevent duplicate event firing with cancellation flags

## Documentation Standards
- Update README.md for new features
- Include code examples for public APIs
- Maintain existing example files
- Keep Apache 2.0 license header on source files

## Git Workflow
- Keep commits focused and atomic
- Test before committing
- Update documentation in the same PR as code changes
- Don't commit `node_modules/` or `dist/` (handled by .gitignore and build process)

## Security Considerations
- No external dependencies in production code
- Validate all route parameters
- Be cautious with form value extraction
- Avoid XSS vulnerabilities in route handlers (user responsibility, but document)

## Performance Considerations
- Keep the framework lightweight (current: ~190 lines unminified)
- Minimize regex compilation (done once per route)
- Efficient route matching (linear search is acceptable for typical use cases)
- No unnecessary DOM operations

## Backward Compatibility
- This is a legacy project used in production by unknown users
- Breaking changes require major version bump
- Maintain existing API surface
- Deprecate before removing features
