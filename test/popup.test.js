'use strict';
// Drives the REAL popup.html + scripts in jsdom with a stubbed chrome API. Needs jsdom (skips without it).
const assert = require('assert');
const fs = require('fs');
const path = require('path');

module.exports = (test) => {
  let JSDOM;
  try { ({ JSDOM } = require('jsdom')); } catch (_) { return; }

  const root = path.join(__dirname, '..');
  const PP = require(path.join(root, 'utils/profile_parse.js'));
  const tick = (n = 40) => new Promise(r => setTimeout(r, n));
  const SCRIPTS = ['utils/profile_parse.js', 'utils/overlap.js', 'utils/compose.js', 'utils/resume.js', 'utils/cache.js', 'popup.js'];

  const PRIYA = () => PP.buildProfile({
    name: 'Priya Rao', headline: 'Data Scientist at Globex', location: 'Chennai, India',
    experience: [{ title: 'Data Scientist', company: 'Globex', isCurrent: true, dates: '2023 - Present' }],
    education: [{ school: 'Indian Institute of Technology Madras', degree: 'B.Tech', dates: '2016 – 2020' }],
    skills: ['Python'], recentPosts: ['Shipped a forecasting model this week and learned a lot about drift'], profileUrl: 'https://www.linkedin.com/in/priya/'
  });

  async function boot(store = {}, { url = 'https://www.linkedin.com/in/priya/' } = {}) {
    const html = fs.readFileSync(path.join(root, 'popup.html'), 'utf8').replace(/<script[^>]*src[^>]*><\/script>/g, '');
    const w = new JSDOM(html, { runScripts: 'outside-only', url: 'chrome-extension://x/popup.html' }).window;
    const errors = []; w.addEventListener('error', e => errors.push(e.message));
    const calls = [], scrapes = [], listeners = [];
    let tabUrl = url;
    w.chrome = {
      tabs: { query: async () => [{ id: 42, url: tabUrl, active: true }], onActivated: { addListener: f => listeners.push(f) }, onUpdated: { addListener: f => listeners.push(f) } },
      storage: { local: {
        get: (k, cb) => cb({ ...store }),
        set: (o, cb) => { Object.assign(store, o); cb && cb(); },
        remove: (k, cb) => { [].concat(k).forEach(x => delete store[x]); cb && cb(); } } },
      runtime: { lastError: null, getURL: x => x, sendMessage: (m, cb) => {
        if (m.action === 'scrapeProfile') { scrapes.push(m); return cb({ success: true, data: PRIYA() }); }
        if (m.type === 'PREVIEW_PAYLOAD') return cb({ success: true, model: 'claude-haiku-5-5', system: 'SYS', user: '{"recipient_profile":{"name":"Priya Rao"}}' });
        if (m.action === 'generateMessage') {
          calls.push(m.data); const n = calls.length;
          return cb({ success: true, generatedMessage: 'x', warnings: [], injection: [], variants: [
            { text: `Hi Priya, we both went to IIT Madras (${m.data.format} #${n}). Open to a chat?`, source: m.data.forceFree ? 'template' : (store.userApiKey ? 'ai' : 'template') },
            { text: `Draft B #${n}`, source: 'template' }, { text: `Draft C #${n}`, source: 'template' }] });
        }
        cb({});
      } }
    };
    w.navigator.clipboard = { writeText: async () => {} };
    w.eval(SCRIPTS.map(f => fs.readFileSync(path.join(root, f), 'utf8').replace(/^'use strict';/, '')).join('\n;'));
    w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
    await tick();
    const $ = id => w.document.getElementById(id);
    return { w, $, errors, calls, scrapes, store, listeners, setUrl: u => { tabUrl = u; }, click: async (id, ms = 100) => { $(id).click(); await tick(ms); } };
  }

  const SENDER = { schools: ['IIT Madras'], skills: ['Python'], intro: 'CS student' };

  test('popup: scrape → drafts with tabs, counter, checklist; scrape is sent the panel\'s tab id', async () => {
    const t = await boot({ senderProfile: SENDER });
    await t.click('scrape-btn');
    assert.strictEqual(t.scrapes[0].tabId, 42);
    assert.strictEqual(t.w.document.querySelectorAll('.draft-tab').length, 3);
    assert.match(t.$('char-count').textContent, /^\d+ \/ 200$/);
    assert.strictEqual(t.w.document.querySelectorAll('#draft-checklist li').length, 5);
    assert.ok(t.calls[0].overlaps.some(o => o.kind === 'school'));
    assert.ok(t.w.document.querySelector('.draft-note.tip'), 'warm-first tip when they have posts');
    assert.deepStrictEqual(t.errors, []);
  });

  test('popup: edits survive tab switches; over-limit is flagged and announced once', async () => {
    const t = await boot({ senderProfile: SENDER });
    await t.click('scrape-btn');
    const ta = t.$('generated-message');
    ta.value = 'x'.repeat(230); ta.dispatchEvent(new t.w.Event('input'));
    assert.ok(t.$('char-count').classList.contains('over'));
    assert.match(t.$('count-live').textContent, /Over the limit by 30/);
    t.$('draft-tab-1').click(); t.$('draft-tab-0').click();
    assert.strictEqual(t.$('generated-message').value.length, 230);
    t.$('draft-tab-0').dispatchEvent(new t.w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    assert.strictEqual(t.$('draft-tab-1').getAttribute('aria-selected'), 'true');
  });

  test('popup: format switch regenerates instantly in Free Mode (same seed); New drafts bumps the seed; prefs persist', async () => {
    const t = await boot({ senderProfile: SENDER });
    await t.click('scrape-btn');
    const n = t.calls.length;
    t.w.document.querySelector('.format-btn[data-format="message"]').click(); await tick(100);
    assert.strictEqual(t.calls.length, n + 1);
    assert.strictEqual(t.calls.at(-1).format, 'message');
    assert.strictEqual(t.calls.at(-1).seed, 0);
    assert.match(t.$('char-count').textContent, /\/ 500$/);
    assert.strictEqual(t.store.prefs.format, 'message');
    await t.click('regenerate-btn');
    assert.strictEqual(t.calls.at(-1).seed, 3);
  });

  test('popup: Copy stores what you actually copied (edited) in Recent; Mark as sent survives', async () => {
    const t = await boot({ senderProfile: SENDER });
    await t.click('scrape-btn');
    t.$('generated-message').value = 'My edited draft'; t.$('generated-message').dispatchEvent(new t.w.Event('input'));
    await t.click('copy-btn', 60);
    assert.strictEqual(t.store.recentContacts[0].message, 'My edited draft');
    t.w.document.querySelector('.tab-btn[data-tab="recent"]').click(); await tick(60);
    t.w.document.querySelector('[id^="sent-"]').click(); await tick(60);
    assert.strictEqual(t.store.recentContacts[0].sent, true);
    t.w.document.querySelector('.tab-btn[data-tab="current"]').click();
    await t.click('copy-btn', 60);                                   // re-copy must not un-send
    assert.strictEqual(t.store.recentContacts[0].sent, true);
  });

  test('popup: Free Mode never shows the consent dialog; AI Mode asks once and respects each choice', async () => {
    const free = await boot({ senderProfile: SENDER });
    await free.click('scrape-btn');
    assert.ok(!free.$('consent-dialog').hasAttribute('open'));
    assert.match(free.$('privacy-text').textContent, /everything stays on this device/);

    const ai = await boot({ userApiKey: 'sk-ant-x', senderProfile: SENDER });
    assert.match(ai.$('privacy-text').textContent, /Anthropic/);
    await ai.click('scrape-btn');
    assert.ok(ai.$('consent-dialog').hasAttribute('open'));
    assert.match(ai.$('consent-payload').textContent, /recipient_profile/);
    assert.strictEqual(ai.calls.length, 0, 'nothing is sent before the user decides');
    await ai.click('consent-free');
    assert.strictEqual(ai.calls[0].forceFree, true);
    assert.ok(!ai.store.aiConsent, 'choosing a free draft must not store consent');
    await ai.click('scrape-btn'); await ai.click('consent-send');
    assert.strictEqual(ai.store.aiConsent.version, 1);
    assert.strictEqual(ai.calls[1].forceFree, undefined);
    await ai.click('scrape-btn');
    assert.ok(!ai.$('consent-dialog').hasAttribute('open'), 'asked only once');

    const cancel = await boot({ userApiKey: 'k', senderProfile: SENDER });
    await cancel.click('scrape-btn'); await cancel.click('consent-cancel');
    assert.strictEqual(cancel.calls.length, 0);
    assert.match(cancel.$('status-message').textContent, /Nothing was sent/);
    assert.ok(cancel.$('message-section').classList.contains('hidden'));
  });

  test('popup: AI Mode does not spend a request on chip/format toggles (asks you to press New drafts)', async () => {
    const t = await boot({ userApiKey: 'k', aiConsent: { version: 1, ackAt: 1 }, senderProfile: SENDER });
    await t.click('scrape-btn');
    const n = t.calls.length;
    t.w.document.querySelector('#overlap-chips .chip').click(); await tick(100);
    assert.strictEqual(t.calls.length, n);
    assert.match(t.$('status-message').textContent, /Press Regenerate/);
  });

  test('popup: moving to another person clears the draft; hash / overlay URLs do NOT', async () => {
    const t = await boot({ senderProfile: SENDER });
    await t.click('scrape-btn');
    for (const u of ['https://www.linkedin.com/in/priya/#top', 'https://www.linkedin.com/in/priya/overlay/contact-info/?x=1', 'https://www.linkedin.com/in/Priya/']) {
      t.setUrl(u); t.listeners[0](); await tick(260);
      assert.ok(!t.$('message-section').classList.contains('hidden'), 'draft must survive ' + u);
    }
    t.setUrl('https://www.linkedin.com/in/someone-else/'); t.listeners[0](); await tick(260);
    assert.ok(t.$('message-section').classList.contains('hidden'));
    assert.ok(t.$('profile-section').classList.contains('hidden'));
    t.setUrl('https://www.google.com/'); t.listeners[0](); await tick(260);
    assert.strictEqual(t.$('scrape-btn').disabled, true);
    assert.ok(t.$('paste-card'), 'paste fallback still available off-LinkedIn');
  });

  test('popup: résumé paste → editable card, contact info dropped, then remove wipes it; legacy PDF blob is deleted', async () => {
    const t = await boot({});
    t.$('resume-paste').value = fs.readFileSync(path.join(__dirname, 'fixtures/resume_sample.txt'), 'utf8');
    await t.click('resume-paste-btn');
    assert.match(t.$('me-schools').value, /Indian Institute of Technology Madras/);
    assert.match(t.$('me-employers').value, /Initech/);
    assert.ok(t.store.resumeText && !/@|98765/.test(t.store.resumeText));
    assert.ok(!('resumeBase64' in t.store));
    t.$('me-skills').value = 'Python, Rust'; t.$('me-skills').dispatchEvent(new t.w.Event('change')); await tick(40);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(t.store.senderProfile.skills)), ['Python', 'Rust']);
    await t.click('resume-remove-btn', 60);
    assert.ok(!t.store.resumeText && !t.store.senderProfile);

    const legacy = await boot({ resumeBase64: 'bm90IGEgcGRm', resumeFileName: 'old.pdf' });
    await tick(300);
    assert.ok(!('resumeBase64' in legacy.store));
    assert.deepStrictEqual(legacy.errors, []);
  });

  test('popup: first-run résumé tip shows once, dismisses for good, and hides after a résumé is added', async () => {
    let t = await boot({});
    assert.ok(!t.$('resume-tip').classList.contains('hidden'));
    await t.click('resume-tip-dismiss', 60);
    assert.ok(t.$('resume-tip').classList.contains('hidden'));
    assert.strictEqual(t.store.resumeTipDismissed, true);
    t = await boot({ senderProfile: SENDER });
    assert.ok(t.$('resume-tip').classList.contains('hidden'));
  });

  test('popup: a draft that quotes their post warns you to check it is their own', async () => {
    const t = await boot({});
    const orig = t.w.chrome.runtime.sendMessage;
    t.w.chrome.runtime.sendMessage = (m, cb) => (m.action === 'generateMessage'
      ? cb({ success: true, generatedMessage: 'x', warnings: [], injection: [], variants: [
          { text: 'Hi Priya, I enjoyed your recent post: “Shipped a model…” Open to a chat?', source: 'template', hookKind: 'post' },
          { text: 'Hi Priya, we both went to IIT Madras. Open to a chat?', source: 'template', hookKind: 'school' }] })
      : orig(m, cb));
    await t.click('scrape-btn');
    assert.ok(!t.$('post-note').classList.contains('hidden'));
    t.$('draft-tab-1').click();
    assert.ok(t.$('post-note').classList.contains('hidden'));
  });

  test('popup: an empty/unreadable page offers paste instead of a nonsense draft', async () => {
    const t = await boot({});
    t.w.chrome.runtime.sendMessage = (m, cb) => cb(m.action === 'scrapeProfile' ? { success: true, data: PP.buildProfile({}) } : {});
    await t.click('scrape-btn');
    assert.match(t.$('status-message').textContent, /couldn't read anything useful/);
    assert.ok(t.$('paste-card').open);
    assert.ok(t.$('message-section').classList.contains('hidden'));
  });
};
