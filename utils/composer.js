'use strict';

// composer.js — "Copy & open": after you copy a draft, this OPENS LinkedIn's own message box (or the connection
// dialog with the note box) on the profile you are looking at. It never types anything, never pastes and never presses
// Send: you paste and send it yourself. It is best-effort; if LinkedIn changes its page and nothing is found, it
// says so and the copy still worked.
//   Composer.open('message' | 'note')  → Promise<{ ok, opened: 'message'|'note'|'connect'|null, reason? }>
// `open` runs INSIDE the LinkedIn page (injected by the background worker), so it must be self-contained.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Composer = api;
})(typeof self !== 'undefined' ? self : this, function () {

  async function open(want, doc = document) {
    const label = (el) => (el.getAttribute('aria-label') || el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    // whatever the label says, these are never clicked: this feature opens a box and that is all
    const FORBIDDEN = /\b(send|post|submit|accept|withdraw|remove|follow|block|report)\b/i;
    const h1 = doc.querySelector('h1');
    const top = (h1 && (h1.closest('section') || h1.parentElement)) || doc.querySelector('main') || doc.body;
    const find = (scope, test) => [...scope.querySelectorAll('button, a, [role="button"]')].find(el => {
      const t = label(el);
      return t && t.length < 90 && !FORBIDDEN.test(t) && test(t) && el.getAttribute('aria-hidden') !== 'true' && !el.disabled;
    });
    const wait = (ms) => new Promise(r => setTimeout(r, ms));

    if (want === 'message') {
      const btn = find(top, t => /^message\b/i.test(t) && !/messaging/i.test(t));
      if (!btn) return { ok: false, opened: null, reason: 'not-found' };
      btn.click();
      return { ok: true, opened: 'message' };
    }

    const connect = find(top, t => /^connect$/i.test(t) || /^invite .+ to connect$/i.test(t));
    if (!connect) return { ok: false, opened: null, reason: 'not-found' };
    connect.click();
    for (let i = 0; i < 12; i++) {                       // the dialog appears a moment later
      await wait(150);
      const dialog = doc.querySelector('[role="dialog"], .artdeco-modal');
      if (!dialog) continue;
      const add = find(dialog, t => /^add a note$/i.test(t));
      if (add) { add.click(); return { ok: true, opened: 'note' }; }
    }
    return { ok: true, opened: 'connect' };               // the dialog opened but its note button was not found
  }

  return { open };
});
