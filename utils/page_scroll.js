'use strict';

// page_scroll.js — make LinkedIn render its lazy sections by scrolling the page the way a reader would,
// then put the reader back where they were. Scrolling only: never clicks, types or navigates.
//
// The base version jumped to fixed offsets (800/1600/2400px) with fixed waits, on `window` only. On long profiles
// the lower sections (Education, Skills…) never rendered, and when the page scrolls inside a container
// instead of the window, nothing scrolled at all. This version:
//   • finds the element that really scrolls (window/document, else the largest scrollable ancestor)
//   • steps down one viewport at a time, waiting for the page to grow / the sections to appear
//   • stops as soon as the sections we need exist, the bottom is reached and stable, or a time cap is hit

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PageScroll = api;
})(typeof self !== 'undefined' ? self : this, function () {

  // Wrap "the thing that scrolls" so callers don't care whether it is the document or a container.
  function wrap(el, win, doc) {
    const isDoc = !el || el === doc.documentElement || el === doc.body || el === doc.scrollingElement;
    const target = isDoc ? (doc.scrollingElement || doc.documentElement) : el;
    return {
      el: target,
      isDoc,
      get top()    { return isDoc ? (win.scrollY || target.scrollTop || 0) : target.scrollTop; },
      get height() { return target.scrollHeight || 0; },
      get view()   { return isDoc ? (win.innerHeight || target.clientHeight || 0) : target.clientHeight; },
      scrollTo(y)  {
        if (isDoc) { try { win.scrollTo(0, y); } catch (_) { /* ignore */ } target.scrollTop = y; }
        else target.scrollTop = y;
      }
    };
  }

  // Prefer the document; if it can't scroll (the app scrolls inside a container), use the tallest scrollable element.
  function findScroller(win, doc) {
    const main = wrap(null, win, doc);
    if (main.height > main.view + 80) return main;
    let best = null, bestH = 0;
    for (const el of Array.from(doc.querySelectorAll('main, div, section'))) {
      if (el.scrollHeight <= el.clientHeight + 200 || !el.clientHeight) continue;
      let oy = '';
      try { oy = win.getComputedStyle(el).overflowY; } catch (_) { continue; }
      if (!/(auto|scroll|overlay)/.test(oy)) continue;
      if (el.scrollHeight > bestH) { best = el; bestH = el.scrollHeight; }
    }
    return best ? wrap(best, win, doc) : main;
  }

  const defaultWait = (ms) => new Promise(r => setTimeout(r, ms));

  // Scrolls through the page to trigger lazy loading, then restores the original position.
  // isReady(): optional, return true once everything we need is on the page (lets us stop early).
  async function loadAll({ win = window, doc = document, wait = defaultWait, isReady = () => false, maxSteps = 24, maxMs = 9000, stepWait = 350 } = {}) {
    const scroller = findScroller(win, doc);
    const startTop = scroller.top;
    const t0 = Date.now();
    let steps = 0, stable = 0, reachedBottom = false, lastHeight = scroller.height;

    try {
      let pos = startTop;
      while (steps < maxSteps && Date.now() - t0 < maxMs) {
        const step = Math.max(350, Math.round((scroller.view || 600) * 0.75));
        pos = Math.min(pos + step, Math.max(0, scroller.height - scroller.view));
        scroller.scrollTo(pos);
        steps++;
        await wait(stepWait);

        const h = scroller.height;
        const grew = h > lastHeight + 20;
        lastHeight = h;
        const atBottom = pos >= h - scroller.view - 4;

        if (isReady() && steps >= 2) break;           // everything we need has rendered
        if (atBottom) {
          reachedBottom = true;
          if (grew) { stable = 0; continue; }          // the page grew while we were at the bottom: keep going
          if (++stable >= 2) break;                    // two quiet checks in a row: nothing more is coming
          await wait(stepWait * 1.5);
        }
      }
      if (!isReady()) await wait(stepWait);            // let the last render settle before reading
    } finally {
      scroller.scrollTo(startTop);                     // always leave the reader where they were
    }
    return { steps, reachedBottom, height: scroller.height, ms: Date.now() - t0, container: scroller.isDoc ? 'document' : 'element' };
  }

  return { findScroller, loadAll };
});
