import routes from '../src/routes.js';

describe("route framework", function() {
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

  // The load handler routes for the page that was loaded; the navigation events
  // below are dispatched by hand so each spec pins exactly one sequence. Moving the
  // location with replaceState deliberately leaves the router's own bookkeeping
  // alone (it does not wrap replaceState), which makes these deterministic - the
  // fixture's own asynchronous load/popstate can only arrive after the spec body.
  describe("navigation after load", function() {
    var fired;

    beforeEach(function() {
      fired = [];
      window.history.replaceState({}, "", "/page.html");
      r.get("/page.html", function() { fired.push("page.html"); });
      r.get("/page2.html", function() { fired.push("page2.html"); });
    });

    it("should fire the route on the first Back press after load", function() {
      // leviroutes-s8o: the load-time guard used to swallow this popstate.
      window.dispatchEvent(new Event("load"));
      expect(fired).toEqual(["page.html"]);

      // The link click: a new entry, handled by the application, no route.
      window.history.pushState(undefined, "", "/page2.html");
      expect(fired).toEqual(["page.html"]);

      // The Back press: the location is already the old one when popstate fires.
      window.history.replaceState({}, "", "/page.html");
      window.dispatchEvent(new Event("popstate"));

      expect(fired).toEqual(["page.html", "page.html"]);
    });

    it("should fire for both of two Back presses onto the same location", function() {
      // leviroutes-jy0: two state-only entries share a URL, so each Back press is a
      // distinct navigation that must fire. Only the popstate/hashchange pair of one
      // fragment navigation is deduplicated - never a popstate, which cannot be told
      // apart from a real press onto a state-only entry.
      window.dispatchEvent(new Event("load"));
      window.history.pushState({ step: 1 }, "", "/page.html");
      window.history.pushState({ step: 2 }, "", "/page.html");
      window.dispatchEvent(new Event("popstate"));
      window.dispatchEvent(new Event("popstate"));

      expect(fired).toEqual(["page.html", "page.html", "page.html"]);
    });

    it("should fire for a popstate that reports the loaded location", function() {
      // The original load-time guard's case: a browser firing a spurious popstate right
      // after load. It reports the location load routed for, exactly as a Back press onto
      // a state-only entry does, so it is not suppressed - the double fire on such a
      // browser (long fixed in WebKit) is the accepted cost of never losing a real press.
      window.dispatchEvent(new Event("load"));
      window.dispatchEvent(new Event("popstate"));

      expect(fired).toEqual(["page.html", "page.html"]);
    });

    it("should fire the route on a hashchange after load", function() {
      // leviroutes-s8o: the same one-shot guard swallowed the first hashchange too.
      window.dispatchEvent(new Event("load"));
      window.history.replaceState({}, "", "/page.html#detail");
      window.dispatchEvent(new Event("hashchange"));

      expect(fired).toEqual(["page.html", "page.html"]);
    });

    it("should fire once when a fragment navigation fires popstate then hashchange", function() {
      window.dispatchEvent(new Event("load"));
      window.history.replaceState({}, "", "/page.html#detail");
      window.dispatchEvent(new Event("popstate"));
      window.dispatchEvent(new Event("hashchange"));

      expect(fired).toEqual(["page.html", "page.html"]);
    });

    it("should fire for a Back press onto the same location as a pushState entry", function() {
      // A state-only entry: the URL does not change, so the popstate back to it
      // must not be mistaken for a repeat of the location routed before it.
      window.dispatchEvent(new Event("load"));
      window.history.pushState(undefined, "", "/page.html");
      window.dispatchEvent(new Event("popstate"));

      expect(fired).toEqual(["page.html", "page.html"]);
    });
  });
});
