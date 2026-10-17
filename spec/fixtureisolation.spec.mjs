/*
 * Regression specs for per-spec DOM/history fixture isolation.
 *
 * Background: constructing routes() wraps history.__proto__.pushState and
 * adds window event listeners. Before fixtures were isolated per spec, those
 * wrappers and listeners accumulated on one process-global JSDOM across all
 * spec files, making the suite order-dependent (and random:false hid it).
 *
 * These specs pin two properties:
 *  1. Every spec starts with a pristine, unwrapped history.pushState — no
 *     matter what earlier specs (in any random order) constructed.
 *  2. Within one fixture, repeated router construction stacks one
 *     'statechanged' dispatch per router (current production behaviour),
 *     and that stacking must NOT carry over into the next spec.
 */
import routes from '../src/routes.js';

describe("fixture isolation", function() {
  // Runs alongside every other spec in random order; if any earlier spec's
  // router leaked onto this fixture's History prototype, pushState would
  // dispatch 'statechanged' even though this spec constructed no router.
  it("starts with an unwrapped history.pushState", function() {
    var fired = 0;
    window.addEventListener("statechanged", function() { fired++; });

    history.pushState({}, "", "/no-router-constructed-here");

    expect(fired).toEqual(0);
  });

  it("stacks one statechanged dispatch per router constructed in the same fixture", function() {
    new routes();
    new routes();

    var fired = 0;
    window.addEventListener("statechanged", function() { fired++; });

    history.pushState({}, "", "/two-routers");

    expect(fired).toEqual(2);
  });

  it("does not carry stacked wrappers into the next spec", function() {
    var fired = 0;
    window.addEventListener("statechanged", function() { fired++; });

    history.pushState({}, "", "/must-be-pristine-again");

    expect(fired).toEqual(0);
  });

  it("gives each spec a distinct window", function() {
    window.__isolationMarker = (window.__isolationMarker || 0) + 1;
    expect(window.__isolationMarker).toEqual(1);
  });
});
