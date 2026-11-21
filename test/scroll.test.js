'use strict';
// Simulates a lazily-rendered page: content "below the fold" only exists once the reader has scrolled near it.
const assert = require('assert');

module.exports = (test, load) => {
  const PS = load('utils/page_scroll.js');
  const noWait = () => Promise.resolve();

  // A fake scrolling surface. `sections` render when scrollTop + view >= their threshold (like IntersectionObserver-driven lazy load).
  function fakePage({ view = 800, baseHeight = 1600, lazy = [{ name: 'experience', at: 1200, adds: 1500 }, { name: 'education', at: 2600, adds: 900 }, { name: 'skills', at: 3400, adds: 700 }], inContainer = false } = {}) {
    const state = { top: 0, rendered: new Set(), scrollCalls: [] };
    const height = () => baseHeight + lazy.filter(s => state.rendered.has(s.name)).reduce((a, s) => a + s.adds, 0);
    const update = () => lazy.forEach(s => { if (state.top + view >= s.at) state.rendered.add(s.name); });

    const scrollEl = {
      get scrollHeight() { return height(); }, get clientHeight() { return view; },
      get scrollTop() { return state.top; },
      set scrollTop(v) { state.top = Math.max(0, Math.min(v, height() - view)); state.scrollCalls.push(state.top); update(); }
    };
    const docEl = inContainer
      ? { scrollHeight: view, clientHeight: view, scrollTop: 0 }                  // the document itself can't scroll
      : scrollEl;
    const container = { ...Object.getOwnPropertyDescriptors(scrollEl) };
    const containerEl = Object.defineProperties({}, container);

    const doc = {
      documentElement: docEl, body: {}, scrollingElement: docEl,
      querySelectorAll: () => (inContainer ? [containerEl] : [])
    };
    const win = {
      innerHeight: view,
      get scrollY() { return inContainer ? 0 : state.top; },
      scrollTo: (x, y) => { if (!inContainer) scrollEl.scrollTop = y; },
      getComputedStyle: () => ({ overflowY: 'auto' })
    };
    return { state, doc, win, isRendered: (n) => state.rendered.has(n), height };
  }

  test('scroll: loads every lazy section on a long page (window scroll) and restores the position', async () => {
    const p = fakePage();
    p.state.top = 0;
    const r = await PS.loadAll({ win: p.win, doc: p.doc, wait: noWait });
    ['experience', 'education', 'skills'].forEach(n => assert.ok(p.isRendered(n), n + ' should have rendered'));
    assert.strictEqual(p.state.top, 0, 'reader is put back where they started');
    assert.ok(r.reachedBottom && r.steps > 3 && r.container === 'document');
  });

  test('scroll: restores a non-zero starting position', async () => {
    const p = fakePage();
    p.state.top = 300;
    await PS.loadAll({ win: p.win, doc: p.doc, wait: noWait });
    assert.strictEqual(p.state.top, 300);
  });

  test('scroll: works when the page scrolls inside a container, not the window', async () => {
    const p = fakePage({ inContainer: true });
    const r = await PS.loadAll({ win: p.win, doc: p.doc, wait: noWait });
    ['experience', 'education', 'skills'].forEach(n => assert.ok(p.isRendered(n), n + ' should have rendered'));
    assert.strictEqual(r.container, 'element');
  });

  test('scroll: stops early once the page reports it has what it needs', async () => {
    const p = fakePage();
    const r = await PS.loadAll({ win: p.win, doc: p.doc, wait: noWait, isReady: () => p.isRendered('experience') });
    assert.ok(p.isRendered('experience'));
    assert.ok(!p.isRendered('skills'), 'should not scroll further than needed');
    assert.ok(r.steps <= 4, 'steps: ' + r.steps);
  });

  test('scroll: keeps going while the page keeps growing at the bottom, and always terminates', async () => {
    // infinite-growth page: every time we hit the bottom, more appears
    const state = { top: 0, h: 2000 };
    const el = { get scrollHeight() { return state.h; }, get clientHeight() { return 800; }, get scrollTop() { return state.top; },
      set scrollTop(v) { state.top = Math.min(v, state.h - 800); if (state.top >= state.h - 800 - 4) state.h += 400; } };
    const doc = { documentElement: el, body: {}, scrollingElement: el, querySelectorAll: () => [] };
    const win = { innerHeight: 800, get scrollY() { return state.top; }, scrollTo: (x, y) => { el.scrollTop = y; }, getComputedStyle: () => ({}) };
    const r = await PS.loadAll({ win, doc, wait: noWait, maxSteps: 12 });
    assert.ok(r.steps <= 12);
  });

  test('scroll: short page / no scrollable area / throwing scroll API never crash', async () => {
    const short = fakePage({ baseHeight: 500, lazy: [] });
    await PS.loadAll({ win: short.win, doc: short.doc, wait: noWait });
    const bad = { documentElement: { scrollHeight: 0, clientHeight: 0 }, body: {}, scrollingElement: null, querySelectorAll: () => [] };
    const r = await PS.loadAll({ win: { innerHeight: 0, scrollY: 0, scrollTo() { throw new Error('nope'); }, getComputedStyle: () => ({}) }, doc: bad, wait: noWait });
    assert.ok(r.steps >= 0);
  });

  test('scroll: the time cap bounds the work', async () => {
    const p = fakePage({ lazy: [] , baseHeight: 100000});
    const slow = () => new Promise(r => setTimeout(r, 5));
    const r = await PS.loadAll({ win: p.win, doc: p.doc, wait: slow, maxMs: 60, maxSteps: 1000 });
    assert.ok(r.ms < 400, 'ms: ' + r.ms);
  });
};
