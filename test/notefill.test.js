'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

module.exports = (test, load) => {
  // source-level guarantees hold even without jsdom
  const SRC = fs.readFileSync(path.join(__dirname, '../utils/notefill.js'), 'utf8').replace(/\/\/.*$/gm, '');
  test('notefill: the helper contains no way to click a page button or touch the network', () => {
    assert.ok(!/\.click\(/.test(SRC), 'it must never call .click() on anything');
    assert.ok(!/\.submit\(|requestSubmit|dispatchEvent\(\s*new\s+\w*\.?(Mouse|Pointer|Keyboard)Event/.test(SRC), 'no synthetic clicks, key presses or form submits');
    assert.ok(!/\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket|sendMessage\(/.test(SRC), 'it never sends anything anywhere');
  });

  let JSDOM; try { ({ JSDOM } = require('jsdom')); } catch (_) { /* jsdom missing: the behaviour tests are skipped like the popup tests */ }
  if (!JSDOM) return;
  const N = load('utils/notefill.js');

  const INVITE = (extra = '', value = '') => `<div role="dialog" id="dlg"><h2>Add a note to your invitation</h2><p>LinkedIn members are more likely to accept invitations that include a personal note.</p>
    <textarea id="custom-message" maxlength="300" placeholder="Ex: We know each other from...">${value}</textarea><span>0/300</span>
    <button id="cancel">Cancel</button><button id="send">Send</button><button id="nonote">Send without a note</button>${extra}</div>`;
  const setup = (html) => {
    const dom = new JSDOM(`<body><main><h1>Aryan</h1><button id="connect">Connect</button></main>${html}</body>`, { runScripts: 'outside-only' });
    const w = dom.window, clicks = [], inputs = [];
    w.document.querySelectorAll('button, a').forEach(b => b.addEventListener('click', () => clicks.push(b.id || b.textContent)));
    const ctl = N.create(w);
    const ui = () => w.document.querySelector('[data-outreach-fill]');
    const btn = () => ui().shadowRoot.getElementById('fill');
    const hint = () => ui().shadowRoot.getElementById('hint').textContent;
    return { w, d: w.document, ctl, ui, btn, hint, clicks, inputs };
  };

  test('notefill: the invitation note box gets ONE button; before a draft exists it says to write one and fills nothing', () => {
    const s = setup(INVITE()); s.ctl.scan(); s.ctl.scan();
    assert.strictEqual(s.d.querySelectorAll('[data-outreach-fill]').length, 1, 'scanning twice must not add a second button');
    assert.match(s.hint(), /Write a draft in the Outreach AI panel first/);
    s.btn().click();
    assert.strictEqual(s.d.getElementById('custom-message').value, '');
  });

  test('notefill: pressing the button types the draft the way a person would (React sees the input event) and stops', () => {
    const s = setup(INVITE());
    let seen = null; s.d.getElementById('custom-message').addEventListener('input', e => { seen = e.target.value; });
    s.ctl.setDraft('Hi Aryan,\nWe both studied at VIT. Open to a quick chat?', 'note');
    assert.match(s.hint(), /Draft ready \(\d+ characters\)/);
    s.btn().click();
    assert.strictEqual(s.d.getElementById('custom-message').value, 'Hi Aryan,\nWe both studied at VIT. Open to a quick chat?');
    assert.strictEqual(seen, 'Hi Aryan,\nWe both studied at VIT. Open to a quick chat?', 'an input event fired, so LinkedIn enables its Send button');
    assert.match(s.hint(), /press Send yourself/);
    assert.deepStrictEqual(s.clicks, [], 'no page button was ever clicked: not Send, not Send without a note, not Cancel, not Connect');
  });

  test('notefill: a draft longer than the box allows is refused with the exact numbers, never cut', () => {
    const s = setup(INVITE());
    s.ctl.setDraft('x'.repeat(230), 'note');
    s.d.getElementById('custom-message').setAttribute('maxlength', '200');
    s.btn().click();
    assert.strictEqual(s.d.getElementById('custom-message').value, '');
    assert.match(s.hint(), /Your draft is 230 characters; this box allows 200/);
    const c = setup(INVITE().replace(' maxlength="300"', '').replace('0/300', '0/200'));   // no maxlength: use the counter LinkedIn shows
    c.ctl.setDraft('y'.repeat(201), 'note'); c.btn().click();
    assert.match(c.hint(), /this box allows 200/);
  });

  test('notefill: text you already typed is replaced only after a second, deliberate click', () => {
    const s = setup(INVITE('', 'my own words'));
    s.ctl.setDraft('Hi Aryan, quick hello.', 'note');
    s.btn().click();
    assert.strictEqual(s.d.getElementById('custom-message').value, 'my own words');
    assert.match(s.btn().textContent, /Click again to replace/);
    s.btn().click();
    assert.strictEqual(s.d.getElementById('custom-message').value, 'Hi Aryan, quick hello.');
    assert.deepStrictEqual(s.clicks, []);
  });

  test('notefill: nothing appears where there is no note box (the first dialog, a read-only box, a post composer), and the button goes away with the box', () => {
    const first = setup('<div role="dialog"><h2>Add a note to your invitation?</h2><button id="addnote">Add a note</button><button id="nonote">Send without a note</button></div>');
    first.ctl.setDraft('hello', 'note'); first.ctl.scan();
    assert.strictEqual(first.d.querySelectorAll('[data-outreach-fill]').length, 0);
    const ro = setup(INVITE().replace('<textarea', '<textarea readonly')); ro.ctl.scan();
    assert.strictEqual(ro.d.querySelectorAll('[data-outreach-fill]').length, 0);
    const post = setup('<div class="share-box"><div contenteditable="true" role="textbox">Start a post</div></div>'); post.ctl.scan();
    assert.strictEqual(post.d.querySelectorAll('[data-outreach-fill]').length, 0);
    const s = setup(INVITE()); s.ctl.scan(); assert.ok(s.ui());
    s.d.getElementById('dlg').remove(); s.ctl.scan();
    assert.strictEqual(s.d.querySelectorAll('[data-outreach-fill]').length, 0);
  });

  test('notefill: a message box (already connected) is filled too, replacing nothing without a second click', () => {
    const msg = '<form class="msg-form"><div class="msg-form__contenteditable" contenteditable="true" role="textbox" aria-label="Write a message…"></div><button id="msgsend">Send</button></form>';
    const s = setup(msg);
    s.ctl.setDraft('Hi Aryan,\nGreat to be connected.\n\nBest regards,\nSaketh Jangala', 'message'); s.ctl.scan();
    assert.ok(s.ui(), 'the button appears beside the message box');
    s.btn().click();
    assert.match(s.d.querySelector('[role="textbox"]').textContent, /Great to be connected/);
    assert.deepStrictEqual(s.clicks, [], 'the message was never sent');
    s.btn().click();   // box now has text → asks first
    assert.match(s.btn().textContent, /Click again to replace/);
  });

  test('notefill: LinkedIn draws this pop-up inside a shadow root (#interop-outlet): the box is still found, filled, and watched for', async () => {
    const dom = new JSDOM('<body><main><h1>Aryan</h1></main><div id="interop-outlet"></div></body>', { runScripts: 'outside-only' });
    const w = dom.window, d = w.document, clicks = [];
    const outlet = d.getElementById('interop-outlet'), root = outlet.attachShadow({ mode: 'open' });
    const ctl = N.create(w); ctl.setDraft('Hi Aryan, quick hello.', 'note'); ctl.watch();
    assert.strictEqual(root.querySelectorAll('[data-outreach-fill]').length, 0, 'no pop-up yet, no button');
    root.innerHTML = INVITE();                                                   // the pop-up opens later, inside the shadow root
    root.querySelectorAll('button').forEach(b => b.addEventListener('click', () => clicks.push(b.id)));
    await new Promise(r => setTimeout(r, 400));
    const host = root.querySelector('[data-outreach-fill]');
    assert.ok(host, 'the button appears inside the shadow-root pop-up');
    host.shadowRoot.getElementById('fill').click();
    assert.strictEqual(root.getElementById('custom-message').value, 'Hi Aryan, quick hello.');
    assert.deepStrictEqual(clicks, [], 'still no page button clicked');
    root.getElementById('dlg').remove(); await new Promise(r => setTimeout(r, 400));
    assert.strictEqual(root.querySelectorAll('[data-outreach-fill]').length, 0, 'the button leaves with the pop-up');
    ctl.setEnabled(false); root.innerHTML = INVITE(); await new Promise(r => setTimeout(r, 400));
    assert.strictEqual(root.querySelectorAll('[data-outreach-fill]').length, 0, 'switched off: nothing appears');
    ctl.setEnabled(true); await new Promise(r => setTimeout(r, 50));
    assert.strictEqual(root.querySelectorAll('[data-outreach-fill]').length, 1, 'switched back on: it works again without reloading');
    ctl.destroy();
  });

  test('notefill: the REAL LinkedIn "Add a note to your invitation" markup (pasted from linkedin.com) is found, in the page and in a shadow root, and filled', () => {
    const real = fs.readFileSync(path.join(__dirname, 'fixtures/linkedin_invite_dialog.html'), 'utf8');
    for (const where of ['page', 'shadow']) {
      const dom = new JSDOM('<body><div id="artdeco-modal-outlet"></div><div id="interop-outlet"></div></body>', { runScripts: 'outside-only' });
      const w = dom.window, d = w.document, clicks = [];
      const root = where === 'page' ? d.getElementById('artdeco-modal-outlet') : d.getElementById('interop-outlet').attachShadow({ mode: 'open' });
      root.innerHTML = real;
      root.querySelectorAll('button').forEach(b => b.addEventListener('click', () => clicks.push(b.getAttribute('aria-label'))));
      const ctl = N.create(w); ctl.scan();
      let host = root.querySelector('[data-outreach-fill]');
      assert.ok(host, where + ': the button appears even before a draft exists');
      assert.match(host.shadowRoot.getElementById('hint').textContent, /Write a draft in the Outreach AI panel first/);
      ctl.setDraft('Hi Aryan,\nWe both study at VIT. Open to a quick chat?', 'note');
      host.shadowRoot.getElementById('fill').click();
      assert.strictEqual(root.querySelector('#custom-message').value, 'Hi Aryan,\nWe both study at VIT. Open to a quick chat?', where);
      assert.strictEqual(N.limitOf(N.findNoteBox(d)), 300, 'the limit comes from the 0/300 counter (this textarea has no maxlength)');
      assert.deepStrictEqual(clicks, [], where + ': Send / Cancel / Dismiss never clicked');
    }
  });

  test('notefill: the button lives in a shadow root and the draft is never written into the page until you press it', () => {
    const s = setup(INVITE());
    s.ctl.setDraft('SECRET-DRAFT-TEXT', 'note');
    assert.ok(!s.d.documentElement.outerHTML.includes('SECRET-DRAFT-TEXT'), 'the page cannot read the draft before you press the button');
    assert.ok(s.ui().shadowRoot, 'LinkedIn CSS cannot restyle the button');
  });
};
