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
