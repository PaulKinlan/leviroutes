/*
 * Comparative tests between original and URLPattern implementations
 */
import routesOriginal from '../src/routes.js';
import routesURLPattern from '../src/routes-urlpattern.js';

describe("URLPattern implementation comparison", function() {
  
  describe("basic routing - original vs URLPattern", function() {
    it("should match root path identically", function() {
      const rOrig = new routesOriginal();
      const rURLPat = new routesURLPattern();
      
      let origMatched = false;
      let urlpatMatched = false;
      
      rOrig.get("/", function() { origMatched = true; });
      rURLPat.get("/", function() { urlpatMatched = true; });
      
      rOrig.test("/");
      rURLPat.test("/");
      
      expect(origMatched).toEqual(true);
      expect(urlpatMatched).toEqual(true);
    });
    
    it("should match static paths identically", function() {
      const rOrig = new routesOriginal();
      const rURLPat = new routesURLPattern();
      
      let origMatched = false;
      let urlpatMatched = false;
      
      rOrig.get("/category", function() { origMatched = true; });
      rURLPat.get("/category", function() { urlpatMatched = true; });
      
      rOrig.test("/category");
      rURLPat.test("/category");
      
      expect(origMatched).toEqual(true);
      expect(urlpatMatched).toEqual(true);
    });
  });
  
  describe("named parameters - original vs URLPattern", function() {
    it("should capture named parameters identically for simple paths", function() {
      const rOrig = new routesOriginal();
      const rURLPat = new routesURLPattern();
      
      let origParam = null;
      let urlpatParam = null;
      
      rOrig.get("/:category", function(req) { origParam = req.params.category; });
      rURLPat.get("/:category", function(req) { urlpatParam = req.params.category; });
      
      rOrig.test("/books");
      rURLPat.test("/books");
      
      expect(origParam).toEqual("books");
      expect(urlpatParam).toEqual("books");
    });
    
    it("should handle dot-separated parameters identically", function() {
      const rOrig = new routesOriginal();
      const rURLPat = new routesURLPattern();
      
      let origParams = null;
      let urlpatParams = null;
      
      rOrig.get("/:category.:format", function(req) { origParams = req.params; });
      rURLPat.get("/:category.:format", function(req) { urlpatParams = req.params; });
      
      rOrig.test("/books.json");
      rURLPat.test("/books.json");
      
      expect(origParams).toEqual({ category: "books", format: "json" });
      expect(urlpatParams).toEqual({ category: "books", format: "json" });
    });
  });
  
  describe("middleware - original vs URLPattern", function() {
    it("should execute middleware identically", function() {
      const rOrig = new routesOriginal();
      const rURLPat = new routesURLPattern();
      
      let origOrder = [];
      let urlpatOrder = [];
      
      rOrig.use(function(req, next) { origOrder.push(1); next(); });
      rOrig.get("/test", function() { origOrder.push(2); });
      
      rURLPat.use(function(req, next) { urlpatOrder.push(1); next(); });
      rURLPat.get("/test", function() { urlpatOrder.push(2); });
      
      rOrig.test("/test");
      rURLPat.test("/test");
      
      expect(origOrder).toEqual([1, 2]);
      expect(urlpatOrder).toEqual([1, 2]);
    });
  });
  
  describe("edge cases", function() {
    it("should not match paths with trailing segments", function() {
      const rOrig = new routesOriginal();
      const rURLPat = new routesURLPattern();
      
      let origMatched = false;
      let urlpatMatched = false;
      
      rOrig.get("/category", function() { origMatched = true; });
      rURLPat.get("/category", function() { urlpatMatched = true; });
      
      rOrig.test("/category/sub");
      rURLPat.test("/category/sub");
      
      expect(origMatched).toEqual(false);
      expect(urlpatMatched).toEqual(false);
    });
  });
  
  describe("known differences", function() {
    it("handles dots in parameters differently (documented behavior)", function() {
      const rOrig = new routesOriginal();
      const rURLPat = new routesURLPattern();
      
      let origMatched = false;
      let urlpatMatched = false;
      let urlpatParam = null;
      
      rOrig.get("/:category", function() { origMatched = true; });
      rURLPat.get("/:category", function(req) { 
        urlpatMatched = true;
        urlpatParam = req.params.category;
      });
      
      // Original: does NOT match /books.json with /:category (dot excluded)
      rOrig.test("/books.json");
      expect(origMatched).toEqual(false);
      
      // URLPattern: DOES match /books.json with /:category
      rURLPat.test("/books.json");
      expect(urlpatMatched).toEqual(true);
      expect(urlpatParam).toEqual("books.json");
      
      // Note: This is the ONE behavioral difference
      // It's documented and can be worked around with /:category.:format
    });
  });
});
