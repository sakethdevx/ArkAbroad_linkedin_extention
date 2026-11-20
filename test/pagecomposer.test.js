'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

module.exports = (test, load) => {
  const SRC = fs.readFileSync(path.join(__dirname, '../utils/pagecomposer.js'), 'utf8').replace(/\/\/.*$/gm, '');
  const ALLOWED = ['scrapeProfile', 'pageState', 'generateMessage', 'openPanel', 'BUILD_PROMPT', 'FINISH_DRAFTS', 'refineDraft', 'BUILD_REFINE_PROMPT'];

  test('pagecomposer: the card may only ask the background for six things, never touches the network, and has no way to click', () => {
    const actions = [...SRC.matchAll(/(?:action|type):\s*'([A-Za-z_]+)'/g)].map(m => m[1]).filter(a => !['button', 'tab', 'text'].includes(a));   // element types, not messages
    assert.ok(actions.length >= 4);
    actions.forEach(a => assert.ok(ALLOWED.includes(a), 'unexpected message: ' + a));
    assert.ok(!/\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket/.test(SRC), 'no network of its own');
    assert.ok(!/\.click\(|\.submit\(|requestSubmit/.test(SRC), 'it never clicks anything on the page');
    assert.ok(!/userApiKey/.test(SRC), 'it never reads the key');
  });

  let JSDOM; try { ({ JSDOM } = require('jsdom')); } catch (_) { /* jsdom missing: behaviour tests skipped like the popup tests */ }
  if (!JSDOM) return;
  const N = load('utils/notefill.js'), PC = load('utils/pagecomposer.js'), R = load('utils/request.js'), A = load('utils/approach.js'), RF = load('utils/refine.js');
  const DIALOG = fs.readFileSync(path.join(__dirname, 'fixtures/linkedin_invite_dialog.html'), 'utf8');
  const tick = (ms = 30) => new Promise(r => setTimeout(r, ms));
  const J = (x) => JSON.parse(JSON.stringify(x));
  const PROFILE = { name: 'Aryan Sri Ram Kalva', firstName: 'Aryan', headline: 'ML engineer', currentCompany: 'Acme', profileUrl: 'https://www.linkedin.com/in/aryan/', isConnection: false,
    educationEntries: [{ school: 'Vellore Institute of Technology' }], skills: ['Python'], recentPosts: ['Shipped a model'], experienceEntries: [], pastCompanies: [] };
  const SENDER = { schools: ['Vellore Institute of Technology'], employers: [], skills: ['Python'], city: '', intro: 'final-year CS student', projects: [], experience: [], education: [] };
  const drafts = (tag) => ({ success: true, source: tag === 'ai' ? 'ai' : 'template', variants: [1, 2, 3].map(i => ({ text: `Hi Aryan, ${tag} draft ${i}. Open to a quick chat?`, source: tag === 'ai' ? 'ai' : 'template', because: { hook: { kind: 'school', label: 'Vellore Institute of Technology' }, credential: { kind: 'intro' } } })) });

  function setup({ html = DIALOG, ai = false, scrape, generate, stored = {}, box, onDevice = null, build, finish, genDelay = 5, refine } = {}) {
    const dom = new JSDOM(`<body><div id="out">${html}</div></body>`, { runScripts: 'outside-only', url: 'https://www.linkedin.com/in/aryan/' });
    const w = dom.window, d = w.document, sent = [], clicks = [], added = [], store = { userName: 'Saketh Jangala', userBio: '', senderProfile: SENDER, prefs: { format: 'note' }, ...stored };
    d.querySelectorAll('button').forEach(b => b.addEventListener('click', () => clicks.push(b.getAttribute('aria-label') || b.textContent.trim())));
    const chrome = {
      runtime: { lastError: null, sendMessage: (m, cb) => { sent.push(m); setTimeout(() => {
        if (m.action === 'pageState') return cb({ success: true, aiReady: ai, providerName: 'Groq', host: 'api.groq.com' });
        if (m.action === 'scrapeProfile') return cb(scrape ? scrape() : { success: true, data: PROFILE });
        if (m.action === 'generateMessage') return cb(generate ? generate(m.data) : drafts(m.data.forceFree ? 'free' : 'ai'));
        if (m.action === 'refineDraft') return cb(refine ? refine(m) : { success: true, text: 'Hi Aryan, revised draft. Open to a quick chat?', applied: (m.intent && m.intent.applied) || [], source: m.data.forceFree ? 'template' : 'ai' });
        if (m.type === 'BUILD_PROMPT') return cb(build ? build(m.payload) : { success: true, system: 'S', user: 'U', schema: {} });
        if (m.type === 'FINISH_DRAFTS') return cb(finish ? finish(m.payload) : { success: true, polished: 3, variants: [1, 2, 3].map(i => ({ text: `Hi Aryan, local draft ${i}. Open to a quick chat?`, source: 'ondevice' })) });
        cb({ success: true });
      }, m.action === 'generateMessage' ? genDelay : 5); } },
      storage: { local: { get: (k, cb) => cb({ ...store }), set: (o, cb) => { Object.assign(store, o); cb && cb(); } } }
    };
    const deps = { chrome, Request: R, Approach: A, Refine: RF, OnDevice: onDevice, Cache: { addContact: (c) => added.push(c) }, limitOf: N.limitOf, currentText: N.currentText, fillBox: N.fillBox };
    const ctl = N.create(w, { view: PC.factory(w, deps) });
    ctl.scan();
    const host = () => d.querySelector('[data-outreach-composer]');
    const $ = (sel) => host().shadowRoot.querySelector(sel);
    const $$ = (sel) => [...host().shadowRoot.querySelectorAll(sel)];
    const btn = (text) => $$('button').find(b => b.textContent.includes(text));
    const until = async (fn, ms = 1500) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await tick(10); } return false; };
    return { w, d, ctl, sent, clicks, added, store, host, $, $$, btn, until };
  }

  test('pagecomposer: opening the note box reads the profile and shows 3 FREE drafts at once, with no panel and no click; the AI button is absent in Free mode', async () => {
    const s = setup();
    assert.ok(s.host(), 'the card is mounted with the box');
    assert.match(s.$('.foot').textContent, /Reading Aryan.*on this device|Reading this profile/);
    assert.ok(await s.until(() => s.$$('.tab').length === 3));
    assert.strictEqual(s.$$('.tab').length, 3);
    assert.match(s.$('.draft').textContent, /free draft 1/);
    const gen = s.sent.find(m => m.action === 'generateMessage');
    assert.strictEqual(gen.data.forceFree, true, 'opening the box never sends anything to an AI');
    assert.strictEqual(gen.data.format, 'note');
    assert.strictEqual(gen.data.messageType, 'Networking');
    assert.deepStrictEqual(J(gen.data.settings), { userName: 'Saketh Jangala', userBio: '' });
    assert.ok(gen.data.overlaps.some(o => o.kind === 'school'), 'shared school found from your stored resume');
    assert.ok(!s.btn('Write with AI'), 'no AI button in Free mode');
    assert.deepStrictEqual(s.sent.map(m => m.action).filter((a, i, arr) => arr.indexOf(a) === i).sort(), ['generateMessage', 'pageState', 'scrapeProfile']);
    assert.match(s.$('.note').textContent, /Best next move/);
    assert.deepStrictEqual(s.clicks, []);
  });

  test('pagecomposer: goal and tone chips regenerate instantly (free) and are remembered; New ideas bumps the seed', async () => {
    const s = setup(); await s.until(() => s.$$('.tab').length === 3);
    s.$$('.chip').find(b => b.textContent === 'Job').click();
    await s.until(() => s.sent.filter(m => m.action === 'generateMessage').length === 2);
    assert.strictEqual(s.sent.filter(m => m.action === 'generateMessage').at(-1).data.messageType, 'Job');
    assert.strictEqual(s.store.prefs.messageType, 'Job');
    assert.strictEqual(s.store.prefs.format, 'note', 'the panel\'s own format preference is left alone');
    await until2(s);
    s.$$('.chip').find(b => b.textContent === 'Casual').click();
    await s.until(() => s.sent.filter(m => m.action === 'generateMessage').length === 3);
    assert.strictEqual(s.sent.filter(m => m.action === 'generateMessage').at(-1).data.tone, 'Casual');
    await until2(s);
    s.btn('New ideas').click();
    await s.until(() => s.sent.filter(m => m.action === 'generateMessage').length === 4);
    assert.strictEqual(s.sent.filter(m => m.action === 'generateMessage').at(-1).data.seed, 3);
    assert.ok(s.sent.filter(m => m.action === 'generateMessage').every(m => m.data.forceFree === true));
    async function until2(x) { await x.until(() => x.$$('.tab').length === 3); }
  });

  test('pagecomposer: Use this draft types it into LinkedIn\'s box (input event fired) and saves it to Recent; Send / Cancel / Dismiss are never clicked', async () => {
    const s = setup(); await s.until(() => s.$$('.tab').length === 3);
    let seen = null; s.d.getElementById('custom-message').addEventListener('input', e => { seen = e.target.value; });
    s.$$('.tab')[1].click();
    s.btn('Use this draft').click();
    const want = 'Hi Aryan, free draft 2. Open to a quick chat?';
    assert.strictEqual(s.d.getElementById('custom-message').value, want);
    assert.strictEqual(seen, want);
    assert.match(s.$('.note.ok').textContent, /press Send yourself/);
    assert.deepStrictEqual(s.clicks, []);
    assert.strictEqual(s.added.length, 1);
    assert.deepStrictEqual(J(s.added[0]).message, want);
    assert.strictEqual(s.added[0].profileUrl, PROFILE.profileUrl);
    assert.match(s.btn('Use again').textContent, /Used/);
  });

  test('pagecomposer: text you already typed needs a second press; an over-limit draft is refused with the numbers', async () => {
    const s = setup({ html: DIALOG.replace('></textarea>', '>my own words</textarea>') }); await s.until(() => s.$$('.tab').length === 3);
    s.btn('Use this draft').click();
    assert.strictEqual(s.d.getElementById('custom-message').value, 'my own words');
    assert.match(s.$('.note.warn').textContent, /already text in the box/);
    s.btn('Use this draft').click();
    assert.match(s.d.getElementById('custom-message').value, /free draft 1/);
    const t = setup({ html: DIALOG.replace('<textarea ', '<textarea maxlength="20" ') }); await t.until(() => t.$$('.tab').length === 3);
    t.btn('Use this draft').click();
    assert.strictEqual(t.d.getElementById('custom-message').value, '');
    assert.match(t.$('.note.warn').textContent, /characters; the box allows 20/);
    assert.ok(t.$('.count.over'));
    assert.deepStrictEqual(t.clicks, []);
  });

  test('pagecomposer: in AI mode the AI writes the drafts directly (no free pass first, no extra click); chips ask the AI again; a failure falls back to free drafts with the reason', async () => {
    const s = setup({ ai: true, genDelay: 150 });
    assert.ok(await s.until(() => /Writing with Groq from a short summary/.test((s.$('.foot') || {}).textContent || ''), 800), 'the card says which AI is writing');
    await s.until(() => s.$$('.tab').length === 3);
    const gens = () => s.sent.filter(m => m.action === 'generateMessage');
    assert.strictEqual(gens().length, 1);
    assert.ok(!gens()[0].data.forceFree, 'AI mode: the AI is asked directly');
    assert.match(s.$('.draft').textContent, /ai draft 1/);
    assert.match(s.$('.foot').textContent, /Written by Groq from a short summary of this profile/);
    assert.ok(!s.btn('Write with AI'), 'there is no AI button to press: it is already on');
    s.$$('.chip').find(b => b.textContent === 'Job').click();
    assert.match(s.$('.foot').textContent, /Writing with Groq/, 'the card shows it is asking again');
    await s.until(() => gens().length === 2, 2000);
    assert.strictEqual(gens().at(-1).data.messageType, 'Job');
    assert.ok(!gens().at(-1).data.forceFree);
    await s.until(() => s.$$('.tab').length === 3);
    s.btn('Free drafts instead').click();
    await s.until(() => gens().length === 3);
    assert.strictEqual(gens().at(-1).data.forceFree, true, 'one click returns to on-device-only free drafts');
    await s.until(() => /free draft 1/.test((s.$('.draft') || {}).textContent || ''));
    assert.match(s.$('.foot').textContent, /Free drafts are made on this device/);
    assert.ok(s.btn('Use Groq again'));
    const f = setup({ ai: true, generate: (d) => (d.forceFree ? drafts('free') : { success: true, source: 'template', variants: drafts('free').variants, aiError: 'Groq is busy.' }) });
    await f.until(() => f.$('.note.warn'));
    assert.match(f.$('.note.warn').textContent, /Groq is busy\. Showing free drafts/);
    assert.match(f.$('.draft').textContent, /free draft 1/);
    assert.deepStrictEqual(f.clicks, []);
  });

  const LOCAL = (over = {}) => ({ status: async () => 'available', polish: async () => ['a', 'b', 'c'], ...over });

  test('pagecomposer: Free mode + on-device AI on → free drafts at once, then the built-in AI polishes them in place; nothing is sent to any cloud', async () => {
    const s = setup({ stored: { onDevice: true }, onDevice: LOCAL() });
    await s.until(() => s.$$('.tab').length === 3);
    assert.ok(s.sent.filter(m => m.action === 'generateMessage').every(m => m.data.forceFree === true), 'no cloud AI in Free mode');
    await s.until(() => /local draft 1/.test((s.$('.draft') || {}).textContent || ''));
    assert.match(s.$('.draft').textContent, /local draft 1/);
    assert.match(s.$('.foot').textContent, /Polished on this device by Chrome.s built-in AI; nothing left your computer/);
    assert.ok(s.sent.some(m => m.type === 'BUILD_PROMPT') && s.sent.some(m => m.type === 'FINISH_DRAFTS'));
    assert.ok(s.btn('Free drafts instead'));
    s.btn('Use this draft').click();
    assert.match(s.d.getElementById('custom-message').value, /local draft 1/);
    assert.deepStrictEqual(s.clicks, []);
  });

  test('pagecomposer: on-device polish never blocks or breaks: a failure keeps the free drafts; a newer choice makes an old result stale; an unreachable model says so', async () => {
    const bad = setup({ stored: { onDevice: true }, onDevice: LOCAL({ polish: async () => null }) });
    await bad.until(() => bad.$$('.tab').length === 3);
    await tick(80);
    assert.match(bad.$('.draft').textContent, /free draft 1/);
    assert.ok(!/Polishing/.test(bad.$('.foot').textContent), 'the polishing state ends');
    let release; const gate = new Promise(r => { release = r; });
    const slow = setup({ stored: { onDevice: true }, onDevice: LOCAL({ polish: async () => { await gate; return ['a']; } }) });
    await slow.until(() => /Polishing it on this device/.test((slow.$('.foot') || {}).textContent || ''));
    slow.$$('.chip').find(b => b.textContent === 'Job').click();       // the user changes the goal while the model is thinking
    release(); await tick(80);
    await slow.until(() => slow.$$('.tab').length === 3);
    assert.ok(!/local draft/.test(slow.$('.draft').textContent), 'the old polish must not replace drafts for a different goal');
    const none = setup({ stored: { onDevice: true }, onDevice: LOCAL({ status: async () => 'unsupported' }) });
    await none.until(() => none.$$('.tab').length === 3);
    assert.match(none.$('.draft').textContent, /free draft 1/);
    assert.match(none.$('.foot').textContent, /On-device AI is on, but Chrome does not offer it to this page/);
    assert.ok(!none.sent.some(m => m.type === 'BUILD_PROMPT'));
    const off = setup({ onDevice: LOCAL() });      // the setting is off: the model is never touched
    await off.until(() => off.$$('.tab').length === 3);
    assert.ok(!off.sent.some(m => m.type === 'BUILD_PROMPT'));
  });

  test('pagecomposer: when the profile cannot be read it says so, offers Try again, and still offers the draft from the side panel', async () => {
    let fail = true;
    const s = setup({ scrape: () => (fail ? { success: false, error: 'Could not read this page.' } : { success: true, data: PROFILE }) });
    await s.until(() => s.$('.note.warn'));
    assert.match(s.$('.note.warn').textContent, /Could not read this page/);
    s.ctl.setDraft('Hi Aryan, my panel draft.', 'note');
    await s.until(() => s.btn('Use the panel draft'));
    s.btn('Use the panel draft').click();
    assert.strictEqual(s.d.getElementById('custom-message').value, 'Hi Aryan, my panel draft.');
    fail = false; s.btn('Try again').click();
    await s.until(() => s.$$('.tab').length >= 3);
    assert.ok(s.$$('.tab').length >= 3);
    assert.deepStrictEqual(s.clicks, []);
  });

  test('pagecomposer: a draft open in the side panel appears as an extra "Panel" tab; a message box (already connected) asks for the message format', async () => {
    const s = setup(); await s.until(() => s.$$('.tab').length === 3);
    s.ctl.setDraft('Hi Aryan, panel text.', 'note');
    await s.until(() => s.$$('.tab').length === 4);
    assert.strictEqual(s.$$('.tab')[3].textContent, 'Panel');
    const msg = '<form class="msg-form"><div class="msg-form__contenteditable" contenteditable="true" role="textbox"></div><button aria-label="Send">Send</button></form>';
    const m = setup({ html: msg });
    await m.until(() => m.$$('.tab').length === 3);
    assert.strictEqual(m.sent.find(x => x.action === 'generateMessage').data.format, 'message');
    m.btn('Use this draft').click();
    assert.match(m.d.querySelector('[role="textbox"]').textContent, /free draft 1/);
    assert.deepStrictEqual(m.clicks, [], 'the message was never sent');
  });

  test('pagecomposer: ✕ hides it for this box only, and the helper stays inert off profile pages or when switched off', async () => {
    const s = setup(); await s.until(() => s.$$('.tab').length === 3);
    s.$('.x').click();
    assert.strictEqual(s.host().hidden, true);
    const dom = new JSDOM(`<body>${DIALOG}</body>`, { runScripts: 'outside-only', url: 'https://www.linkedin.com/feed/' });
    const w = dom.window;
    const ctl = N.create(w, { active: () => /^\/in\//.test(w.location.pathname) }); ctl.scan();
    assert.strictEqual(w.document.querySelectorAll('[data-outreach-fill]').length, 0, 'not a profile page: nothing happens');
    const off = setup(); await off.until(() => off.$$('.tab').length === 3);
    off.ctl.setEnabled(false);
    assert.strictEqual(off.d.querySelectorAll('[data-outreach-composer]').length, 0, 'switched off: the card is gone');
  });

  test('pagecomposer: start() follows the Settings choice live (smart → button → off) and does nothing off profile pages', async () => {
    const boot = (url, store) => {
      const dom = new JSDOM(`<body>${DIALOG}</body>`, { runScripts: 'outside-only', url });
      const w = dom.window; let onChanged = null;
      w.PageComposer = PC; w.DraftRequest = R; w.Approach = A;
      w.chrome = { runtime: { lastError: null, onMessage: { addListener() {} },
          sendMessage: (m, cb) => setTimeout(() => cb(m.action === 'scrapeProfile' ? { success: true, data: PROFILE } : m.action === 'generateMessage' ? drafts('free') : { success: true, aiReady: false }), 5) },
        storage: { local: { get: (k, cb) => cb({ ...store, senderProfile: SENDER }), set() {} }, onChanged: { addListener: (f) => { onChanged = f; } } } };
      N.start(w);
      return { w, d: w.document, change: (patch) => { Object.assign(store, patch); onChanged(Object.fromEntries(Object.keys(patch).map(k => [k, { newValue: patch[k] }])), 'local'); } };
    };
    const s = boot('https://www.linkedin.com/in/aryan/', {});
    await tick(400);
    assert.strictEqual(s.d.querySelectorAll('[data-outreach-composer]').length, 1, 'default: the smart composer');
    s.change({ pageMode: 'button' }); await tick(400);
    assert.strictEqual(s.d.querySelectorAll('[data-outreach-composer]').length, 0);
    assert.strictEqual(s.d.querySelectorAll('[data-outreach-fill]').length, 1, 'button only');
    s.change({ pageMode: 'off' }); await tick(400);
    assert.strictEqual(s.d.querySelectorAll('[data-outreach-fill]').length, 0, 'off: nothing on the page');
    s.change({ pageMode: 'smart' }); await tick(400);
    assert.strictEqual(s.d.querySelectorAll('[data-outreach-composer]').length, 1, 'back on without reloading');
    const old = boot('https://www.linkedin.com/in/aryan/', { noteFill: false });
    await tick(400);
    assert.strictEqual(old.d.querySelectorAll('[data-outreach-fill]').length, 0, 'an older install that turned the helper off stays off');
    const feed = boot('https://www.linkedin.com/feed/', {});
    await tick(400);
    assert.strictEqual(feed.d.querySelectorAll('[data-outreach-fill]').length, 0, 'not a profile page: inert');
  });

  test('pagecomposer: if the extension was reloaded while the page stayed open, the card says so and offers a page refresh (not a vague error); other failures show their reason', async () => {
    const mk = (sendMessage) => {
      const w = new JSDOM(`<body>${DIALOG}</body>`, { runScripts: 'outside-only', url: 'https://www.linkedin.com/in/aryan/' }).window;
      const chrome = { runtime: { lastError: null, sendMessage }, storage: { local: { get: (k, cb) => cb({}), set() {} } } };
      const ctl = N.create(w, { view: PC.factory(w, { chrome, Request: R, Approach: A, Cache: null, limitOf: N.limitOf, currentText: N.currentText, fillBox: N.fillBox }) });
      ctl.scan();
      return { shadow: () => w.document.querySelector('[data-outreach-composer]').shadowRoot, chrome };
    };
    const waitWarn = async (x) => { for (let i = 0; i < 100 && !x.shadow().querySelector('.note.warn'); i++) await tick(10); return x.shadow().querySelector('.note.warn').textContent; };
    const orphan = mk(() => { throw new Error('Extension context invalidated.'); });
    assert.match(await waitWarn(orphan), /reloaded or updated\. Refresh this LinkedIn page/);
    const names = [...orphan.shadow().querySelectorAll('button')].map(b => b.textContent);
    assert.ok(names.includes('Refresh this page') && names.includes('Try again'), names.join('|'));
    const other = mk(function (m, cb) { this.lastError = { message: 'Could not establish connection.' }; setTimeout(() => cb(undefined), 1); });
    other.chrome.runtime.sendMessage = other.chrome.runtime.sendMessage.bind(other.chrome.runtime);
    assert.match(await waitWarn(other), /Could not establish connection/);
    assert.ok(![...other.shadow().querySelectorAll('button')].some(b => b.textContent === 'Refresh this page'));
  });

  test('pagecomposer: "Ask for a change" rewrites the selected draft (free rules here), keeps Undo, and Use types the revised text; the other tabs are untouched', async () => {
    const s = setup(); await s.until(() => s.$$('.tab').length === 3);
    s.btn('Ask for a change').click();
    assert.deepStrictEqual(s.$$('.rchip').map(b => b.textContent), ['Shorter', 'Warmer', 'More formal', 'Mention a project']);
    s.$$('.tab')[1].click();
    const before = s.$('.draft').textContent;
    s.$$('.rchip').find(b => b.textContent === 'Shorter').click();
    await s.until(() => /Revised: /.test((s.$('.refine .note') || {}).textContent || ''));
    const sent = s.sent.find(m => m.action === 'refineDraft');
    assert.strictEqual(sent.comment, 'Make it shorter'); assert.strictEqual(sent.data.forceFree, true); assert.strictEqual(sent.draft, before);
    assert.match(s.$('.draft').textContent, /revised draft/);
    s.$$('.tab')[0].click(); assert.match(s.$('.draft').textContent, /free draft 1/, 'only the selected draft changed');
    s.$$('.tab')[1].click(); assert.match(s.$('.draft').textContent, /revised draft/);
    s.btn('Undo last change').click();
    assert.strictEqual(s.$('.draft').textContent, before);
    s.$$('.rchip').find(b => b.textContent === 'Warmer').click();
    await s.until(() => /revised draft/.test(s.$('.draft').textContent));
    s.btn('Use this draft').click();
    assert.match(s.d.getElementById('custom-message').value, /revised draft/);
    assert.deepStrictEqual(s.clicks, []);
  });

  test('pagecomposer: "Ask for a change" in AI Mode asks the AI with your own words, offers the AI-only options, keeps LinkedIn\'s keyboard shortcuts out, and refuses wording free mode cannot follow without a request', async () => {
    const s = setup({ ai: true }); await s.until(() => s.$$('.tab').length === 3);
    s.btn('Ask for a change').click();
    assert.ok(s.$$('.rchip').some(b => b.textContent === 'Add a question'));
    let leaked = 0; s.d.addEventListener('keydown', () => { leaked++; });
    const input = s.$('.rin');
    input.value = 'mention that I want summer internships'; input.dispatchEvent(new s.w.Event('input'));
    input.dispatchEvent(new s.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true }));
    await s.until(() => s.sent.some(m => m.action === 'refineDraft'));
    assert.strictEqual(leaked, 0, 'Enter / Escape typed here never reach LinkedIn\'s own handlers');
    const m = s.sent.find(x => x.action === 'refineDraft');
    assert.strictEqual(m.comment, 'mention that I want summer internships'); assert.ok(!m.data.forceFree, 'AI Mode: the AI rewrites');
    await s.until(() => /Revised: /.test((s.$('.refine .note') || {}).textContent || ''));
    assert.match(s.$('.foot').textContent, /Written by Groq/);
    const f = setup(); await f.until(() => f.$$('.tab').length === 3);
    f.btn('Ask for a change').click();
    const i2 = f.$('.rin'); i2.value = 'sound like Shakespeare'; i2.dispatchEvent(new f.w.Event('input')); f.$('.rgo').click();
    await f.until(() => f.$('.refine .note.warn'));
    assert.match(f.$('.refine .note.warn').textContent, /Free mode can.t follow that wording/);
    assert.ok(!f.sent.some(x => x.action === 'refineDraft'), 'refused locally: nothing was sent');
    const bad = setup({ ai: true, refine: () => ({ success: false, error: 'Groq is busy.' }) }); await bad.until(() => bad.$$('.tab').length === 3);
    bad.btn('Ask for a change').click(); bad.$$('.rchip')[0].click();
    await bad.until(() => bad.$('.refine .note.warn'));
    assert.match(bad.$('.refine .note.warn').textContent, /Groq is busy/); assert.match(bad.$('.draft').textContent, /ai draft 1/);
  });
};
