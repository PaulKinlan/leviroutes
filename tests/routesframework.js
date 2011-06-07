describe("route management", function() {
  var r;
  beforeEach(function() {
    r = new routes();
  });

  it("should have fire an event on pushState", function() {
    var triggered = false;

    window.addEventListener("statechanged", function() {
      triggered = true;
    });

    window.history.pushState({}, "test1", "asdasda");
    window.history.back();
    expect(triggered).toEqual(true);
  });
});
