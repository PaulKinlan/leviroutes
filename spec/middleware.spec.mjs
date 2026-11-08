/*
 * Testing middleware functionality
 */
import routes from '../src/routes.js';

describe("middleware", function() {
  var r;
  beforeEach(function() {
    r = new routes();
  });

  it("should execute middleware before route handler", function() {
    var middlewareExecuted = false;
    var handlerExecuted = false;
    
    r.use(function(req, next) {
      middlewareExecuted = true;
      next();
    });
    
    r.get("/test", function(req) {
      handlerExecuted = true;
    });
    
    r.test("/test");
    
    expect(middlewareExecuted).toEqual(true);
    expect(handlerExecuted).toEqual(true);
  });

  it("should execute multiple middleware in order", function() {
    var order = [];
    
    r.use(function(req, next) {
      order.push(1);
      next();
    });
    
    r.use(function(req, next) {
      order.push(2);
      next();
    });
    
    r.get("/test", function(req) {
      order.push(3);
    });
    
    r.test("/test");
    
    expect(order).toEqual([1, 2, 3]);
  });

  it("should allow middleware to modify request object", function() {
    var modifiedValue = null;
    
    r.use(function(req, next) {
      req.customProperty = "modified";
      next();
    });
    
    r.get("/test", function(req) {
      modifiedValue = req.customProperty;
    });
    
    r.test("/test");
    
    expect(modifiedValue).toEqual("modified");
  });

  it("should stop execution if next is not called", function() {
    var handlerExecuted = false;
    
    r.use(function(req, next) {
      // Don't call next()
    });
    
    r.get("/test", function(req) {
      handlerExecuted = true;
    });
    
    r.test("/test");
    
    expect(handlerExecuted).toEqual(false);
  });

  it("should run the route handler once when a middleware calls next() twice", function() {
    // leviroutes-hphu: the chain driver only guarded post-abort continuation, so a middleware
    // that advanced the chain twice (synchronous fall-through plus async branch - the classic
    // double-advance bug) ran the matched route's side effects twice, and next.abort() could
    // not prevent the re-entry.
    var runs = 0;

    r.use(function(req, next) {
      next();
      next();
    });

    r.get("/test", function() {
      runs++;
    });

    r.test("/test");

    expect(runs).toEqual(1);
  });

  it("should still advance the chain once per middleware when the first one doubles up", function() {
    var order = [];

    r.use(function(req, next) {
      order.push("first");
      next();
      next();
    });

    r.use(function(req, next) {
      order.push("second");
      next();
    });

    r.get("/test", function() {
      order.push("handler");
    });

    r.test("/test");

    expect(order).toEqual(["first", "second", "handler"]);
  });

  it("should ignore a late next() from a saved reference after the handler has run", function() {
    var runs = 0;
    var saved = null;

    r.use(function(req, next) {
      saved = next;
      next();
    });

    r.get("/test", function() {
      runs++;
    });

    r.test("/test");
    saved();

    expect(runs).toEqual(1);
  });

  it("should still allow a deferred next() from a saved reference", function() {
    var runs = 0;
    var saved = null;

    r.use(function(req, next) {
      saved = next;
    });

    r.get("/test", function() {
      runs++;
    });

    r.test("/test");
    expect(runs).toEqual(0);

    saved();
    expect(runs).toEqual(1);
  });

  it("should work with parameterized routes", function() {
    var capturedParam = null;
    
    r.use(function(req, next) {
      req.middlewareProcessed = true;
      next();
    });
    
    r.get("/:category", function(req) {
      capturedParam = req.params.category;
    });
    
    r.test("/books");
    
    expect(capturedParam).toEqual("books");
  });
});
