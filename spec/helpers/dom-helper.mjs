import { JSDOM } from 'jsdom';

// Set up a DOM environment for tests
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'http://localhost',
  pretendToBeVisual: true,
});

global.window = dom.window;
global.document = dom.window.document;
global.HTMLFormElement = dom.window.HTMLFormElement;
global.history = dom.window.history;
global.Event = dom.window.Event;
