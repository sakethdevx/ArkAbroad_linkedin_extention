'use strict';

// notefill.js — a small helper that runs INSIDE a LinkedIn tab, only after you have written a draft in the panel.
// When LinkedIn shows a note box (the "Add a note to your invitation" dialog, or a message box), it adds ONE button
// beside it: "Fill with my draft". Pressing that button types the draft into the box. That is all it does.
//
//   • It never clicks anything on the page. Not Send, not "Send without a note", not Cancel, not "Add a note".
//     The only click it ever handles is on its own button, and you make that click. You read the text and press Send.
//   • The draft lives only in this helper (the page's own scripts cannot read it). Nothing is sent anywhere.
//   • If it cannot find the box, it shows nothing and the panel's Copy button still works.
// Plain functions are exported so they can be tested; in the browser it starts itself and listens for the panel.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.NoteFill = api;
    api.start(root);
  }
})(typeof self !== 'undefined' ? self : this, function () {

  const VERSION = 'notefill-1';
  const NOTE_WORDS = /invitation|add a note|personal note|your note/i;

  const isShown = (el) => !!el && !el.hidden && el.getAttribute('aria-hidden') !== 'true' && !el.closest('[hidden], [aria-hidden="true"]');

  // ── Finding the box ──────────────────────────────────────────────────────────────────────────────────────────────
  function findNoteBox(doc) {
    // 1. the invitation note: an editable textarea inside a dialog about an invitation / note
    for (const dlg of doc.querySelectorAll('[role="dialog"], .artdeco-modal')) {
      if (!isShown(dlg) || !NOTE_WORDS.test(dlg.textContent || '')) continue;
      const ta = [...dlg.querySelectorAll('textarea')].find(t => !t.readOnly && !t.disabled && isShown(t));
      if (ta) return { kind: 'textarea', el: ta, scope: dlg };
    }
    // 2. a message box (already connected): the messaging text box, never the post composer
    const ed = [...doc.querySelectorAll('[contenteditable="true"][role="textbox"]')].find(e =>
      isShown(e) && (e.closest('form[class*="msg-"], [class*="msg-form"], [class*="msg-overlay"]')) &&
      !e.closest('[class*="share-"], [class*="comments-"]'));
    return ed ? { kind: 'editable', el: ed, scope: ed.closest('form') || ed.parentElement } : null;
  }

  // The box's character limit: its maxlength, else the counter LinkedIn shows next to it ("0/300").
  function limitOf(box) {
    const ml = Number(box.el.getAttribute && box.el.getAttribute('maxlength'));
    if (ml > 0) return ml;
    const m = String(box.scope && box.scope.textContent || '').match(/\b\d{1,4}\s*\/\s*(\d{2,4})\b/);
    return m ? Number(m[1]) : null;
  }

  const currentText = (box) => (box.kind === 'textarea' ? box.el.value : box.el.innerText || box.el.textContent || '');

  // ── Typing into the box (the one place we write to the page) ────────────────────────────────────────────────
  function fillBox(box, text, win) {
    const doc = box.el.ownerDocument, w = win || doc.defaultView;
    box.el.focus();
    if (box.kind === 'textarea') {
      const setter = Object.getOwnPropertyDescriptor(w.HTMLTextAreaElement.prototype, 'value').set;   // React ignores plain .value = …
      setter.call(box.el, text);
      box.el.dispatchEvent(new w.Event('input', { bubbles: true }));
      box.el.dispatchEvent(new w.Event('change', { bubbles: true }));
      try { box.el.setSelectionRange(text.length, text.length); } catch (_) { /* cosmetic */ }
      return true;
    }
    // contenteditable: select what is there, then insert, so the editor's own handlers run
    const sel = w.getSelection && w.getSelection();
    if (sel && doc.createRange) { const r = doc.createRange(); r.selectNodeContents(box.el); sel.removeAllRanges(); sel.addRange(r); }
    let ok = false;
    try { ok = typeof doc.execCommand === 'function' && doc.execCommand('insertText', false, text); } catch (_) { ok = false; }
    if (!ok) {
      box.el.textContent = text;
      box.el.dispatchEvent(new w.InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    }
    return true;
  }

  // ── The one button we add (in a shadow root, so LinkedIn's styles cannot restyle it) ────────────────────────────
  const CSS = `
    :host { all: initial; display: block; margin: 8px 0 4px; font-family: -apple-system, system-ui, 'Segoe UI', Roboto, sans-serif; }
    .row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    button { font: 600 13px/1 inherit; font-family: inherit; padding: 8px 14px; border-radius: 16px; border: 1px solid #1a56db; background: #fff; color: #1a56db; cursor: pointer; }
    button:hover, button:focus-visible { background: #ebf0ff; }
    .hint { font-size: 12px; color: #555; line-height: 1.35; }
    .hint.warn { color: #9a3412; }
    .hint.ok { color: #166534; }`;

  function mountUi(box, ctl) {
    const host = box.el.ownerDocument.createElement('div');
    host.setAttribute('data-outreach-fill', '');
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>${CSS}</style><div class="row"><button type="button" id="fill">Fill with my draft</button><span class="hint" id="hint"></span></div>`;
    const anchor = box.kind === 'textarea' ? box.el : (box.el.parentElement || box.el);
    anchor.insertAdjacentElement('afterend', host);
    const ui = { host, box, btn: shadow.getElementById('fill'), hint: shadow.getElementById('hint'), confirm: false, timer: null };
    ui.btn.addEventListener('click', () => ctl.onFillClick(ui));
    return ui;
  }

  const say = (ui, text, kind) => { ui.hint.textContent = text; ui.hint.className = 'hint' + (kind ? ' ' + kind : ''); };

  // ── The controller: one per page ──────────────────────────────────────────────────────────────────────────────
  function create(win) {
    const doc = win.document;
    let draft = { text: '', format: 'note' };
    let enabled = true;
    const uis = new Map();   // box element → ui

    const ctl = {
      setDraft(text, format) { draft = { text: String(text || '').trim(), format: format === 'message' ? 'message' : 'note' }; ctl.scan(); },
      getDraft: () => ({ ...draft }),
      setEnabled(on) { enabled = !!on; if (!enabled) ctl.destroy(); else ctl.scan(); },

      scan() {
        if (!enabled) return;
        for (const [el, ui] of uis) if (!el.isConnected) { ui.host.remove(); uis.delete(el); }   // the box went away
        const box = findNoteBox(doc);
        if (!box) return;
        let ui = uis.get(box.el);
        if (!ui) { ui = mountUi(box, ctl); uis.set(box.el, ui); }
        ui.box = box;
        if (!ui.busy) ctl.describe(ui);
      },

      describe(ui) {
        ui.confirm = false;
        ui.btn.textContent = 'Fill with my draft';
        if (!draft.text) return say(ui, 'Write a draft in the Outreach AI panel first. Outreach AI never presses Send.', '');
        say(ui, `Draft ready (${draft.text.length} characters). You press Send yourself.`, '');
      },

      onFillClick(ui) {
        const box = ui.box;
        if (!draft.text) return say(ui, 'Write a draft in the Outreach AI panel first.', 'warn');
        const lim = limitOf(box);
        if (lim && draft.text.length > lim) return say(ui, `Your draft is ${draft.text.length} characters; this box allows ${lim}. Shorten it in the panel.`, 'warn');
        if (currentText(box).trim() && !ui.confirm) {     // never overwrite what you typed without asking once more
          ui.confirm = true; ui.btn.textContent = 'Click again to replace what is there';
          say(ui, 'There is already text in this box.', 'warn');
          clearTimeout(ui.timer); ui.timer = setTimeout(() => ctl.describe(ui), 6000);
          return;
        }
        clearTimeout(ui.timer);
        fillBox(box, draft.text, win);
        ui.confirm = false; ui.btn.textContent = 'Fill again';
        say(ui, 'Filled. Read it, edit it if you like, then press Send yourself.', 'ok');
      },

      destroy() { uis.forEach(ui => ui.host.remove()); uis.clear(); }
    };
    return ctl;
  }

  // ── Browser start-up: listen for the panel, watch for the box ─────────────────────────────────────────────────
  function start(win) {
    if (!win || !win.document || !win.chrome || !win.chrome.runtime || !win.chrome.runtime.onMessage) return;
    if (win.__outreachNoteFill && win.__outreachNoteFill.version === VERSION) return;
    if (win.__outreachNoteFill) win.__outreachNoteFill.ctl.destroy();
    const ctl = create(win);
    win.__outreachNoteFill = { version: VERSION, ctl };
    win.chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg) return;
      if (msg.action === 'noteFillPing') { sendResponse({ ok: true, version: VERSION }); return; }
      if (msg.action === 'noteFillDraft') { ctl.setEnabled(msg.enabled !== false); ctl.setDraft(msg.text, msg.format); sendResponse({ ok: true }); return; }
    });
    let t = null;
    new win.MutationObserver(() => { clearTimeout(t); t = setTimeout(() => ctl.scan(), 150); }).observe(win.document.body, { childList: true, subtree: true });
    ctl.scan();
  }

  return { VERSION, create, start, findNoteBox, limitOf, fillBox };
});
