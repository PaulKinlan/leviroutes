describe("route management", function() {
  var r;
  beforeEach(function() {
    r = new routes();
  });

  it("should have no routes", function() {
    expect(r.getRoutes().length).toEqual(0);
  });

  it("should have one route", function() {
    r.get("/", function() { });
    expect(r.getRoutes().length).toEqual(1);
  });

  it("should have two routes", function() {
   r.get("/index.html", function() {});
   r.get("/", function() { });
   expect(r.getRoutes().length).toEqual(2);
  });
});
