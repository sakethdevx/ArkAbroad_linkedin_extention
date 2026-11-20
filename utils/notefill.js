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

  const VERSION = 'notefill-4';
  const NOTE_WORDS = /invitation|add a note|personal note|your note/i;
  // short breadcrumbs in the page console (DevTools → Console → filter "Outreach AI"), never the draft's text
  const log = (...a) => { try { console.info('[Outreach AI]', ...a); } catch (_) { /* no console */ } };

  const isShown = (el) => !!el && !el.hidden && el.getAttribute('aria-hidden') !== 'true' && !el.closest('[hidden], [aria-hidden="true"]');

  // ── Finding the box ──────────────────────────────────────────────────────────────────────────────────────────────
  // LinkedIn draws many of its pop-ups (including this one) inside a shadow root (#interop-outlet), where a normal
  // document.querySelector cannot see them. So we search the page AND every open shadow root in it.
  function shadowRoots(doc) {
    const out = [];
    const walk = (root) => {
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) { out.push(el.shadowRoot); walk(el.shadowRoot); }
      }
    };
    walk(doc);
    return out;
  }

  function findNoteBox(doc) {
    const roots = [doc, ...shadowRoots(doc)];
    for (const r of roots) { const b = findIn(r); if (b) return b; }
    return null;
  }

  // The pop-up is recognised by what it says (not by the element LinkedIn happens to wrap it in): a visible, editable
  // textarea with "invitation" / "personal note" around it, or LinkedIn's own "We know each other from…" placeholder.
  function noteScope(ta) {
    if (/know each other|personal note/i.test(ta.getAttribute('placeholder') || '')) return ta.closest('[role="dialog"], dialog, .artdeco-modal') || ta.parentElement;
    let a = ta.parentElement;
    for (let i = 0; i < 8 && a; i++, a = a.parentElement) {
      const t = a.textContent || '';
      if (t.length > 3000) break;
      if (NOTE_WORDS.test(t)) return a;
    }
    return null;
  }

  function findIn(doc) {
    // 1. the invitation note
    for (const ta of doc.querySelectorAll('textarea')) {
      if (ta.readOnly || ta.disabled || !isShown(ta)) continue;
      const scope = noteScope(ta);
      if (scope) return { kind: 'textarea', el: ta, scope };
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
  // opts.view: factory (box, ctl) → ui for the richer on-page composer; without it the plain "Fill with my draft" button is used.
  // opts.active(): false makes the helper inert (e.g. not on a profile page).
  function create(win, opts = {}) {
    const doc = win.document;
    let view = opts.view || null;
    const active = opts.active || (() => true);
    let draft = { text: '', format: 'note' };
    let enabled = true;
    let lastMiss = 0;
    const uis = new Map();   // box element → ui

    const ctl = {
      setDraft(text, format) {
        draft = { text: String(text || '').trim(), format: format === 'message' ? 'message' : 'note' };
        log(`draft received (${draft.text.length} characters)`);
        ctl.scan();
        uis.forEach(ui => { if (ui.onPanelDraft) ui.onPanelDraft(draft); });
      },
      setView(v) { view = v || null; uis.forEach(ui => ui.destroy ? ui.destroy() : ui.host.remove()); uis.clear(); ctl.scan(); },
      getDraft: () => ({ ...draft }),
      setEnabled(on) { enabled = !!on; if (!enabled) { uis.forEach(ui => ui.destroy ? ui.destroy() : ui.host.remove()); uis.clear(); } else ctl.scan(); },

      scan() {
        if (!enabled || !active()) return;
        for (const [el, ui] of uis) if (!el.isConnected) { ui.destroy ? ui.destroy() : ui.host.remove(); uis.delete(el); }   // the box went away
        const box = findNoteBox(doc);
        if (!box) {
          const n = [doc, ...shadowRoots(doc)].reduce((k, r) => k + r.querySelectorAll('textarea').length, 0);
          if (n && Date.now() - lastMiss > 5000) { lastMiss = Date.now(); log(`saw ${n} text box(es) but none looks like a note box`); }
          return;
        }
        let ui = uis.get(box.el);
        if (!ui) {
          ui = view ? view(box, ctl) : mountUi(box, ctl);
          uis.set(box.el, ui);
          if (ui.smart && draft.text && ui.onPanelDraft) ui.onPanelDraft(draft);
          log(`found the ${box.kind === 'textarea' ? 'invitation note' : 'message'} box; ${view ? 'composer' : 'button'} added`);
        }
        ui.box = box;
        if (ui.smart) { if (ui.refreshBox) ui.refreshBox(box); }
        else if (!ui.busy) ctl.describe(ui);
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

      // watch the page, and every shadow root in it, for the box appearing
      watch() {
        const seen = new WeakSet(); let t = null;
        const MO = win.MutationObserver;
        const later = () => { clearTimeout(t); t = setTimeout(() => { attach(); ctl.scan(); }, 150); };
        const observer = new MO(later);
        const attach = () => {
          [doc.body, ...shadowRoots(doc)].forEach(r => { if (r && !seen.has(r)) { seen.add(r); observer.observe(r, { childList: true, subtree: true }); } });
        };
        attach(); ctl.scan();
        ctl.stop = () => { clearTimeout(t); observer.disconnect(); };
      },

      destroy() { enabled = false; if (ctl.stop) ctl.stop(); uis.forEach(ui => ui.destroy ? ui.destroy() : ui.host.remove()); uis.clear(); }
    };
    return ctl;
  }

  // ── Browser start-up: listen for the panel, watch for the box ─────────────────────────────────────────────────
  function start(win) {
    if (!win || !win.document || !win.chrome || !win.chrome.runtime || !win.chrome.runtime.onMessage) return;
    if (win.__outreachNoteFill && win.__outreachNoteFill.version === VERSION) return;
    if (win.__outreachNoteFill) win.__outreachNoteFill.ctl.destroy();

    // Inert everywhere except a profile page: LinkedIn is a single-page app, so this script is present on every
    // linkedin.com page but only looks for a note box on /in/… pages.
    const onProfile = () => /^\/in\//.test(win.location.pathname);
    const ctl = create(win, { active: onProfile });
    let mode = 'smart';
    win.__outreachNoteFill = { version: VERSION, ctl };

    const view = (win.PageComposer && win.DraftRequest)
      ? win.PageComposer.factory(win, { chrome: win.chrome, Request: win.DraftRequest, Approach: win.Approach, Cache: typeof Cache !== 'undefined' ? Cache : null, limitOf, currentText, fillBox })
      : null;
    const modeFrom = (r) => (['smart', 'button', 'off'].includes(r.pageMode) ? r.pageMode : (r.noteFill === false ? 'off' : 'smart'));   // older installs only had the on/off switch
    const apply = (next) => {
      if (next === mode && win.__outreachNoteFill.ready) return;
      mode = next; win.__outreachNoteFill.ready = true;
      ctl.setEnabled(mode !== 'off');
      ctl.setView(mode === 'smart' ? view : null);
    };
    const read = () => { try { win.chrome.storage.local.get(['pageMode', 'noteFill'], r => apply(modeFrom(r || {}))); } catch (_) { apply('smart'); } };
    ctl.setEnabled(false);   // until we know the setting
    read();
    try { win.chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && (ch.pageMode || ch.noteFill)) read(); }); } catch (_) { /* no live updates */ }

    win.chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg) return;
      if (msg.action === 'noteFillPing') { sendResponse({ ok: true, version: VERSION, mode }); return; }
      if (msg.action === 'noteFillDraft') { if (mode !== 'off') ctl.setEnabled(msg.enabled !== false); ctl.setDraft(msg.text, msg.format); sendResponse({ ok: true }); return; }
    });
    ctl.watch();
    log('helper running (' + VERSION + ')');
  }

  return { VERSION, create, start, findNoteBox, limitOf, fillBox, currentText };
});
