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
    const calls = [], scrapes = [], listeners = [], permCalls = [], resumeCalls = []; let resumeReply = null; let granted = new Set(); let allowRequests = true;
    let tabUrl = url;
    w.chrome = {
      tabs: { query: async () => [{ id: 42, url: tabUrl, active: true }], onActivated: { addListener: f => listeners.push(f) }, onUpdated: { addListener: f => listeners.push(f) } },
      storage: { local: {
        get: (k, cb) => cb({ ...store }),
        set: (o, cb) => { Object.assign(store, o); cb && cb(); },
        remove: (k, cb) => { [].concat(k).forEach(x => delete store[x]); cb && cb(); } } },
      permissions: {
        contains: async (q) => q.origins.every(o => granted.has(o)),
        request: async (q) => { permCalls.push(q.origins[0]); if (allowRequests) q.origins.forEach(o => granted.add(o)); return allowRequests; } },
      runtime: { lastError: null, getURL: x => x, sendMessage: (m, cb) => {
        if (m.type === 'TEST_API_KEY') { return cb({ valid: true, provider: m.payload.provider }); }
        if (m.action === 'scrapeProfile') { scrapes.push(m); return cb({ success: true, data: PRIYA() }); }
        if (m.type === 'PREVIEW_RESUME') return cb({ success: true, providerName: 'Anthropic', host: 'api.anthropic.com', model: 'claude-haiku-5-5', system: 'RSYS', user: '{"resume_text":"' + m.payload.text.slice(0, 20) + '"}' });
        if (m.type === 'PARSE_RESUME') { resumeCalls.push(m.payload); return cb(resumeReply || { ok: true, provider: 'anthropic', profile: {
          name: 'Asha Menon', intro: 'final-year CS student at IIT Madras', summary: 'CS student who builds data tools.', city: 'Chennai, India',
          education: [{ school: 'IIT Madras', degree: 'B.Tech', field: 'Computer Science', years: '2021 - 2025' }],
          experience: [{ title: 'Software Intern', company: 'Globex', years: '2024', detail: 'Built a forecasting API' }],
          projects: [{ name: 'CampusMap', summary: 'route planner' }], skills: ['Python', 'SQL'], certifications: ['AWS CP'], languages: [],
          schools: ['IIT Madras'], employers: ['Globex'] } }); }
        if (m.type === 'RUN_ENRICH') return cb({ status: 'enrich_complete', profileJSON: PRIYA(), enrichmentJSON: { topHooks: ['Shared: You both studied at IIT Madras'] } });
        if (m.type === 'RUN_GENERATE') return cb({ status: 'generate_complete', success: true, warnings: [], injection: [], variants: [{ text: 'Hi Priya, review-mode draft', source: 'template' }], generatedMessage: 'x' });
        if (m.type === 'PREVIEW_PAYLOAD') {
          const g = (store.aiProvider === 'groq') || /^gsk_/.test(store.userApiKey || '');
          return cb({ success: true, model: g ? 'llama-3.3-70b-versatile' : 'claude-haiku-5-5', providerName: g ? 'Groq' : 'Anthropic', host: g ? 'api.groq.com' : 'api.anthropic.com', system: 'SYS', user: '{"recipient_profile":{"name":"Priya Rao"}}' });
        }
        if (m.action === 'generateMessage') {
          calls.push(m.data); const n = calls.length;
          return cb({ success: true, generatedMessage: 'x', warnings: [], injection: [], variants: [
            { text: `Hi Priya, we both went to IIT Madras (${m.data.format} #${n}). Open to a chat?`, source: m.data.forceFree ? 'template' : (store.userApiKey ? 'ai' : 'template'), provider: store.userApiKey ? ((store.aiProvider === 'groq' || /^gsk_/.test(store.userApiKey)) ? 'groq' : 'anthropic') : undefined },
            { text: `Draft B #${n}`, source: 'template' }, { text: `Draft C #${n}`, source: 'template' }] });
        }
        cb({});
      } }
    };
    w.navigator.clipboard = { writeText: async () => {} };
    w.eval(SCRIPTS.map(f => fs.readFileSync(path.join(root, f), 'utf8').replace(/^'use strict';/, '')).join('\n;'));
    if (w.document.readyState === 'loading') await new Promise(r => w.document.addEventListener('DOMContentLoaded', () => r()));   // jsdom fires it itself; dispatching again would run init twice
    else w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
    await tick();
    const $ = id => w.document.getElementById(id);
    return { w, $, errors, calls, scrapes, resumeCalls, setResumeReply: r => { resumeReply = r; }, store, listeners, permCalls, deny: () => { allowRequests = false; }, setUrl: u => { tabUrl = u; }, click: async (id, ms = 100) => { $(id).click(); await tick(ms); } };
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

  test('popup: switching Free ⇄ AI: AI asks once (names provider, host, model), the choice is remembered, and nothing asks per draft', async () => {
    const free = await boot({ senderProfile: SENDER });
    await free.click('scrape-btn');
    assert.ok(!free.$('consent-dialog').hasAttribute('open'));
    assert.match(free.$('privacy-text').textContent, /everything stays on this device/);
    assert.strictEqual(free.$('mode-free').getAttribute('aria-pressed'), 'true');

    // a key is saved but never turned on → still Free, with a clear next step
    const t = await boot({ userApiKey: 'sk-ant-x', senderProfile: SENDER });
    assert.strictEqual(t.$('mode-ai').getAttribute('aria-pressed'), 'false');
    assert.match(t.$('privacy-text').textContent, /Tap AI to use it/);
    await t.click('mode-ai', 150);
    assert.ok(t.$('consent-dialog').hasAttribute('open'));
    assert.match(t.$('consent-title').textContent, /Turn on AI with Anthropic/);
    assert.strictEqual(t.$('consent-host').textContent, 'api.anthropic.com');
    assert.strictEqual(t.store.mode, 'free', 'nothing changes before the yes');
    await t.click('consent-send', 150);
    assert.strictEqual(t.store.mode, 'ai');
    assert.strictEqual(t.store.aiConsent.version, 2);
    assert.strictEqual(t.$('mode-ai').getAttribute('aria-pressed'), 'true');
    assert.match(t.$('privacy-text').textContent, /Anthropic/);
    await t.click('scrape-btn');
    assert.ok(!t.$('consent-dialog').hasAttribute('open'), 'no dialog per draft');
    assert.strictEqual(t.calls[0].forceFree, undefined);

    await t.click('mode-free', 100);
    assert.strictEqual(t.store.mode, 'free');
    assert.strictEqual(t.store.userApiKey, 'sk-ant-x', 'the key stays saved');
    await t.click('mode-ai', 100);
    assert.ok(!t.$('consent-dialog').hasAttribute('open'), 'switching back never asks again');
    assert.strictEqual(t.store.mode, 'ai');

    // "Not now" leaves things as they were
    const n = await boot({ userApiKey: 'sk-ant-x' });
    await n.click('mode-ai', 150); await n.click('consent-cancel', 100);
    assert.notStrictEqual(n.store.mode, 'ai');
    assert.deepStrictEqual(n.errors, []);
  });

  test('popup: tapping AI with no key sends you to Settings with the key field focused', async () => {
    const t = await boot({});
    await t.click('mode-ai', 100);
    assert.strictEqual(t.$('tab-settings').classList.contains('active'), true);
    assert.strictEqual(t.w.document.activeElement.id, 'api-key');
    assert.match(t.$('settings-status').textContent, /Add your API key/);
    assert.notStrictEqual(t.store.mode, 'ai');
  });

  test('popup: AI Mode does not spend a request on chip/format toggles (asks you to press New drafts)', async () => {
    const t = await boot({ userApiKey: 'k', mode: 'ai', aiConsent: { version: 2, ackAt: 1, provider: 'anthropic' }, senderProfile: SENDER });
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

  test('popup: resume paste → editable card, contact info dropped, then remove wipes it; legacy PDF blob is deleted', async () => {
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

  test('popup: first-run resume tip shows once, dismisses for good, and hides after a resume is added', async () => {
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

  // ── Groq as a second provider ──────────────────────────────────────────────
  test('provider: switching updates placeholder/help; pasting a key auto-selects the provider', async () => {
    const t = await boot({});
    assert.strictEqual(t.$('api-key').placeholder, 'sk-ant-…');
    t.w.document.querySelector('.provider-btn[data-provider="groq"]').click();
    assert.strictEqual(t.$('api-key').placeholder, 'gsk_…');
    assert.strictEqual(t.w.document.querySelector('.provider-btn[data-provider="groq"]').getAttribute('aria-checked'), 'true');
    assert.strictEqual(t.w.document.querySelector('.provider-btn[data-provider="anthropic"]').getAttribute('aria-checked'), 'false');
    assert.match(t.$('provider-help').textContent, /free plan/i);
    assert.match(t.$('provider-help').querySelector('a').href, /console\.groq\.com/);
    t.$('api-key').value = 'sk-ant-abc'; t.$('api-key').dispatchEvent(new t.w.Event('input'));
    assert.strictEqual(t.w.document.querySelector('.provider-btn[data-provider="anthropic"]').getAttribute('aria-checked'), 'true');
    t.$('api-key').value = 'gsk_abc'; t.$('api-key').dispatchEvent(new t.w.Event('input'));
    assert.strictEqual(t.w.document.querySelector('.provider-btn[data-provider="groq"]').getAttribute('aria-checked'), 'true');
  });

  test('provider: saving a Groq key asks Chrome for api.groq.com first; Anthropic asks for nothing; the key saves with its provider', async () => {
    const g = await boot({});
    g.$('api-key').value = 'gsk_abc123'; g.$('api-key').dispatchEvent(new g.w.Event('input'));
    await g.click('save-settings-btn', 120);
    assert.ok(g.$('consent-dialog').hasAttribute('open'), 'saving a key asks the one-time yes');
    assert.match(g.$('consent-title').textContent, /Turn on AI with Groq/);
    await g.click('consent-send', 150);
    assert.strictEqual(g.store.mode, 'ai', 'saving a key turns AI on');
    assert.match(g.$('settings-status').textContent, /AI is on \(Groq\)/);
    assert.deepStrictEqual(g.permCalls, ['https://api.groq.com/*']);
    assert.strictEqual(g.store.userApiKey, 'gsk_abc123');
    assert.strictEqual(g.store.aiProvider, 'groq');
    assert.match(g.$('key-status').textContent, /AI Mode · Groq/);
    assert.match(g.$('privacy-text').textContent, /Groq/);

    const a = await boot({});
    a.$('api-key').value = 'sk-ant-abc'; a.$('api-key').dispatchEvent(new a.w.Event('input'));
    await a.click('save-settings-btn', 120); await a.click('consent-send', 150);
    assert.deepStrictEqual(a.permCalls, []);
    assert.strictEqual(a.store.aiProvider, 'anthropic');
    assert.match(a.$('key-status').textContent, /AI Mode · Anthropic/);
  });

  test('provider: if the user denies the permission, the Groq key is NOT saved and they are told what to do', async () => {
    const t = await boot({});
    t.deny();
    t.$('api-key').value = 'gsk_abc123'; t.$('api-key').dispatchEvent(new t.w.Event('input'));
    t.$('user-name').value = 'Saketh';
    await t.click('save-settings-btn', 80);
    assert.ok(!t.store.userApiKey, 'key must not be kept when we cannot use it');
    assert.strictEqual(t.store.userName, 'Saketh', 'other settings still save');
    assert.match(t.$('settings-status').textContent, /needs permission to contact api\.groq\.com/);
    assert.match(t.$('key-status').textContent, /Free Mode/);
  });

  test('provider: a key that clearly belongs to the other provider overrides a wrong selection on save', async () => {
    const t = await boot({});
    t.w.document.querySelector('.provider-btn[data-provider="anthropic"]').click();
    t.$('api-key').value = 'gsk_zzz';            // typed/pasted, then the radio is flipped back by mistake
    t.w.document.querySelector('.provider-btn[data-provider="anthropic"]').click();
    await t.click('save-settings-btn', 80);
    assert.strictEqual(t.store.aiProvider, 'groq');
  });

  test('provider: Test asks for the permission, then tests with the right provider; denied → clear message, no test', async () => {
    const t = await boot({});
    t.$('api-key').value = 'gsk_abc'; t.$('api-key').dispatchEvent(new t.w.Event('input'));
    await t.click('validate-btn', 150);
    assert.deepStrictEqual(t.permCalls, ['https://api.groq.com/*']);
    // a working key goes straight to the one-time yes: no separate Save step
    assert.ok(t.$('consent-dialog').hasAttribute('open'));
    assert.match(t.$('consent-title').textContent, /Turn on AI with Groq/);
    assert.strictEqual(t.store.userApiKey, 'gsk_abc');
    await t.click('consent-send', 150);
    assert.strictEqual(t.store.mode, 'ai');
    assert.match(t.$('key-validation-status').textContent, /Connected\. AI is on \(Groq\)/);
    assert.strictEqual(t.$('validate-btn').textContent, 'Connect');
    assert.match(t.$('privacy-text').textContent, /Groq/);
    // "Not now": key is kept, AI stays off, and the message says how to turn it on
    const n = await boot({});
    n.$('api-key').value = 'gsk_abc'; n.$('api-key').dispatchEvent(new n.w.Event('input'));
    await n.click('validate-btn', 150); await n.click('consent-cancel', 150);
    assert.strictEqual(n.store.userApiKey, 'gsk_abc');
    assert.notStrictEqual(n.store.mode, 'ai');
    assert.match(n.$('key-validation-status').textContent, /saved\. AI is off: tap AI/);
    const d = await boot({}); d.deny();
    d.$('api-key').value = 'gsk_abc'; d.$('api-key').dispatchEvent(new d.w.Event('input'));
    await d.click('validate-btn', 80);
    assert.match(d.$('key-validation-status').textContent, /Allow access to api\.groq\.com/);
    assert.ok(!d.store.userApiKey, 'nothing is saved when access is denied');
  });

  test('provider: consent is per provider (legacy Anthropic consent does not cover Groq); dialog names provider, host, model', async () => {
    const t = await boot({ userApiKey: 'gsk_k', aiProvider: 'groq', aiConsent: { version: 1, ackAt: 1 } });   // legacy record = Anthropic
    assert.strictEqual(t.$('mode-ai').getAttribute('aria-pressed'), 'false', 'not silently switched on for a new provider');
    await t.click('mode-ai', 150);
    assert.match(t.$('consent-title').textContent, /Turn on AI with Groq/);
    assert.strictEqual(t.$('consent-host').textContent, 'api.groq.com');
    assert.strictEqual(t.$('consent-model').textContent, 'llama-3.3-70b-versatile');
    await t.click('consent-send', 150);
    assert.strictEqual(t.store.aiConsent.provider, 'groq');
    await t.click('scrape-btn');
    assert.ok(!t.$('consent-dialog').hasAttribute('open'));
    assert.match(t.$('source-badge').textContent, /Written by Llama via Groq/);

    const legacy = await boot({ userApiKey: 'sk-ant-k', aiConsent: { version: 1, ackAt: 1 }, senderProfile: SENDER });
    assert.strictEqual(legacy.$('mode-ai').getAttribute('aria-pressed'), 'true', 'existing Anthropic users keep AI on');
    await legacy.click('scrape-btn');
    assert.ok(!legacy.$('consent-dialog').hasAttribute('open'));
    assert.match(legacy.$('source-badge').textContent, /Written by Claude/);
  });

  test('provider: saved settings restore the provider selection', async () => {
    const t = await boot({ userApiKey: 'gsk_k', aiProvider: 'groq', mode: 'ai' });
    assert.strictEqual(t.w.document.querySelector('.provider-btn[data-provider="groq"]').getAttribute('aria-checked'), 'true');
    assert.match(t.$('key-status').textContent, /Groq/);
    const bare = await boot({ userApiKey: 'gsk_k', mode: 'ai' });   // no explicit provider stored → detected from the key
    assert.match(bare.$('key-status').textContent, /Groq/);
  });

  const V2 = { version: 2, ackAt: 1, provider: 'anthropic' };
  const RESUME_TXT = () => fs.readFileSync(path.join(__dirname, 'fixtures/resume_sample.txt'), 'utf8');

  test('popup: AI Mode resume upload reads it automatically (no dialog), fills every field and stores the full profile', async () => {
    const t = await boot({ userApiKey: 'sk-ant-abc', mode: 'ai', aiConsent: V2 });
    t.$('resume-paste').value = RESUME_TXT();
    await t.click('resume-paste-btn', 200);
    assert.ok(!t.$('consent-dialog').hasAttribute('open'), 'already said yes when AI was turned on');
    assert.strictEqual(t.resumeCalls.length, 1);
    assert.ok(!/@|98765/.test(t.resumeCalls[0].text), 'contact details never leave the device');
    assert.strictEqual(t.$('user-name').value, 'Asha Menon');
    assert.match(t.$('user-bio').value, /builds data tools/);
    assert.match(t.$('me-education').value, /IIT Madras \| B\.Tech \| Computer Science \| 2021 - 2025/);
    assert.match(t.$('me-experience').value, /Software Intern \| Globex/);
    assert.match(t.$('me-projects').value, /CampusMap/);
    const sp = JSON.parse(JSON.stringify(t.store.senderProfile));
    assert.strictEqual(sp.source, 'ai');
    assert.strictEqual(sp.experience[0].company, 'Globex');
    assert.strictEqual(t.store.userName, 'Asha Menon');
    assert.match(t.$('resume-status').textContent, /Anthropic read your resume/);
    t.$('me-skills').value = 'Python'; t.$('me-skills').dispatchEvent(new t.w.Event('change')); await tick(40);
    const sp2 = JSON.parse(JSON.stringify(t.store.senderProfile));
    assert.strictEqual(sp2.projects[0].name, 'CampusMap', 'a small edit keeps the rest of the profile');
    assert.strictEqual(sp2.summary, 'CS student who builds data tools.');
    await t.click('resume-ai-btn', 200);
    assert.strictEqual(t.resumeCalls.length, 2, 're-read works without any dialog');
    assert.deepStrictEqual(t.errors, []);
  });

  test('popup: turning AI on later reads an already-uploaded resume by itself', async () => {
    const t = await boot({ userApiKey: 'sk-ant-abc', resumeText: RESUME_TXT(), resumeFileName: 'r.pdf', senderProfile: SENDER });
    assert.strictEqual(t.resumeCalls.length, 0);
    await t.click('mode-ai', 150); await t.click('consent-send', 300);
    assert.strictEqual(t.resumeCalls.length, 1);
    assert.strictEqual(JSON.parse(JSON.stringify(t.store.senderProfile)).source, 'ai');
  });

  test('popup: AI resume read — an AI failure falls back with a clear message; a typed name is never overwritten; Free Mode switch stops it', async () => {
    const t = await boot({ userApiKey: 'sk-ant-abc', mode: 'ai', aiConsent: V2, userName: 'Typed Name' });
    t.setResumeReply({ ok: false, userMessage: 'Anthropic rejected the API key.' });
    t.$('resume-paste').value = RESUME_TXT();
    await t.click('resume-paste-btn', 200);
    assert.match(t.$('resume-status').textContent, /rejected the API key\. Using what was read on this device/);
    assert.match(t.$('me-schools').value, /Indian Institute of Technology Madras/);
    t.setResumeReply(null);
    await t.click('resume-ai-btn', 200);
    assert.strictEqual(t.$('user-name').value, 'Typed Name');

    await t.click('mode-free', 100);
    const before = t.resumeCalls.length;
    t.$('resume-paste').value = RESUME_TXT() + ' ';
    await t.click('resume-paste-btn', 200);
    assert.strictEqual(t.resumeCalls.length, before, 'Free Mode never sends the resume');
    assert.ok(t.$('resume-ai-btn').classList.contains('hidden'));
  });

  test('popup: Free Mode resume upload never opens the AI dialog or sends anything', async () => {
    const t = await boot({});
    t.$('resume-paste').value = fs.readFileSync(path.join(__dirname, 'fixtures/resume_sample.txt'), 'utf8');
    await t.click('resume-paste-btn', 150);
    assert.ok(!t.$('consent-dialog').hasAttribute('open'));
    assert.strictEqual(t.resumeCalls.length, 0);
    assert.ok(t.$('resume-ai-btn').classList.contains('hidden'));
  });

  test('popup: Review Mode shows ONE next action at a time (Read → Write), with a plain instruction', async () => {
    const t = await boot({ senderProfile: SENDER });
    await t.click('mode-deep', 60);
    const vis = (id) => !t.$(id).classList.contains('hidden');
    assert.ok(vis('enrich-btn') && !vis('deep-generate-btn') && !vis('reread-btn'));
    assert.match(t.$('deep-step').textContent, /Step 1 of 2/);
    assert.strictEqual(t.$('enrich-label').textContent, 'Read this profile');
    await t.click('enrich-btn', 200);
    assert.ok(!vis('enrich-btn') && vis('deep-generate-btn') && vis('reread-btn'));
    assert.strictEqual(t.$('deep-generate-btn').disabled, false);
    assert.match(t.$('deep-step').textContent, /Step 2 of 2/);
    assert.match(t.$('status-message').textContent, /press “Write my draft”/);
    assert.ok(!/Generate Message/.test(t.w.document.body.textContent));
    assert.ok(vis('hooks-panel'));
    await t.click('deep-generate-btn', 200);
    assert.match(t.$('generated-message').value, /review-mode draft/);
    await t.click('reread-btn', 200);   // read again → back through the same flow
    assert.deepStrictEqual(t.errors, []);
  });
};
