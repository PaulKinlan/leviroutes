import { JSDOM } from 'jsdom';

// Per-spec DOM fixture.
//
// Every spec gets its own JSDOM instance so that no state can leak between
// specs or spec files:
//  - routes() wraps history.__proto__.pushState on every construction; a
//    fresh window per spec means a fresh, unwrapped History prototype.
//  - routes() adds window event listeners (submit/popstate/load/hashchange)
//    on every construction; closing the window in afterEach discards them.
//
// Helpers are loaded before specs, so these global hooks run around every
// spec in every file, including each spec file's own beforeEach/afterEach.

let dom = null;

beforeEach(function() {
  dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'http://localhost',
    pretendToBeVisual: true,
  });

  global.window = dom.window;
  global.document = dom.window.document;
  global.HTMLFormElement = dom.window.HTMLFormElement;
  global.history = dom.window.history;
  global.Event = dom.window.Event;
});

afterEach(function() {
  if (dom) {
    dom.window.close();
    dom = null;
  }

  delete global.window;
  delete global.document;
  delete global.HTMLFormElement;
  delete global.history;
  delete global.Event;
});
