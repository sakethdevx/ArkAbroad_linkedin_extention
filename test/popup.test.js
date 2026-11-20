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
  const SCRIPTS = ['utils/safety.js', 'utils/ondevice.js', 'utils/translate.js', 'utils/profile_parse.js', 'utils/overlap.js', 'utils/spotlight.js', 'utils/approach.js', 'utils/request.js', 'utils/refine.js', 'utils/compose.js', 'utils/followup.js', 'utils/resume.js', 'utils/person.js', 'utils/cache.js', 'panel/providers.js', 'panel/ondevice_ui.js', 'panel/overlap_ui.js', 'panel/settings.js', 'panel/resume_ui.js', 'panel/consent.js', 'panel/drafts.js', 'panel/followup_ui.js', 'panel/notefill_ui.js', 'panel/refine_ui.js', 'popup.js'];

  const PRIYA = () => PP.buildProfile({
    name: 'Priya Rao', headline: 'Data Scientist at Globex', location: 'Chennai, India',
    experience: [{ title: 'Data Scientist', company: 'Globex', isCurrent: true, dates: '2023 - Present' }],
    education: [{ school: 'Indian Institute of Technology Madras', degree: 'B.Tech', dates: '2016 – 2020' }],
    skills: ['Python'], recentPosts: ['Shipped a forecasting model this week and learned a lot about drift'], profileUrl: 'https://www.linkedin.com/in/priya/'
  });

  async function boot(store = {}, { url = 'https://www.linkedin.com/in/priya/', signals: initialSignals, languageModel, translator, detector } = {}) {
    const html = fs.readFileSync(path.join(root, 'popup.html'), 'utf8').replace(/<script[^>]*src[^>]*><\/script>/g, '');
    const w = new JSDOM(html, { runScripts: 'outside-only', url: 'chrome-extension://x/popup.html' }).window;
    const errors = []; w.addEventListener('error', e => errors.push(e.message));
    const calls = [], scrapes = [], listeners = [], permCalls = [], resumeCalls = []; let resumeReply = null; let degree = ''; const resumeBuilds = []; let about = ''; const copied = []; const opened = []; const composers = []; const armed = []; const refines = []; let refineReply = (m) => ({ success: true, text: 'Hi Priya,\nRevised text. Open to a quick chat?', applied: m.intent && m.intent.applied || [], source: m.data && m.data.forceFree ? 'template' : 'ai' }); let composerReply = { success: true, opened: 'message' }; const builds = [], finishes = []; let finishReply = null; const detects = []; let signals = initialSignals || { lines: [], labels: [] }; let granted = new Set(); let allowRequests = true;
    let tabUrl = url;
    w.chrome = {
      tabs: { create: (o) => { opened.push(o.url); return Promise.resolve({}); }, query: async () => [{ id: 42, url: tabUrl, active: true }], onActivated: { addListener: f => listeners.push(f) }, onUpdated: { addListener: f => listeners.push(f) } },
      storage: { local: {
        get: (k, cb) => cb({ ...store }),
        set: (o, cb) => { Object.assign(store, o); cb && cb(); },
        remove: (k, cb) => { [].concat(k).forEach(x => delete store[x]); cb && cb(); } } },
      permissions: {
        contains: async (q) => q.origins.every(o => granted.has(o)),
        request: async (q) => { permCalls.push(q.origins[0]); if (allowRequests) q.origins.forEach(o => granted.add(o)); return allowRequests; } },
      runtime: { lastError: null, getURL: x => x, sendMessage: (m, cb) => {
        if (m.type === 'TEST_API_KEY') { return cb({ valid: true, provider: m.payload.provider }); }
        if (m.action === 'scrapeProfile') { scrapes.push(m); return cb({ success: true, data: { ...PRIYA(), about, connectionDegree: degree, isConnection: degree === '' ? null : degree === '1st' } }); }
        if (m.type === 'PREVIEW_RESUME') return cb({ success: true, providerName: 'Anthropic', host: 'api.anthropic.com', model: 'claude-haiku-5-5', system: 'RSYS', user: '{"resume_text":"' + m.payload.text.slice(0, 20) + '"}' });
        if (m.type === 'PARSE_RESUME') { resumeCalls.push(m.payload); return cb(resumeReply || { ok: true, provider: 'anthropic', profile: {
          name: 'Asha Menon', intro: 'final-year CS student at IIT Madras', summary: 'CS student who builds data tools.', city: 'Chennai, India',
          education: [{ school: 'IIT Madras', degree: 'B.Tech', field: 'Computer Science', years: '2021 - 2025' }],
          experience: [{ title: 'Software Intern', company: 'Globex', years: '2024', detail: 'Built a forecasting API' }],
          projects: [{ name: 'CampusMap', summary: 'route planner' }], skills: ['Python', 'SQL'], certifications: ['AWS CP'], languages: [],
          schools: ['IIT Madras'], employers: ['Globex'] } }); }
        if (m.action === 'refineDraft') { refines.push(m); return cb(refineReply(m)); }
        if (m.action === 'armNoteFill') { armed.push({ text: m.text, format: m.format, enabled: m.enabled, tabId: m.tabId }); return cb({ success: true }); }
        if (m.action === 'openComposer') { composers.push({ tabId: m.tabId, want: m.want }); return cb(composerReply); }
        if (m.action === 'detectConnection') { detects.push(m.tabId); return cb({ success: true, lines: signals.lines, labels: signals.labels }); }
        if (m.type === 'BUILD_PROMPT') { builds.push(m.payload); return cb({ success: true, system: 'SYS', user: 'USER', schema: { type: 'object' }, limit: 200 }); }
        if (m.type === 'FINISH_DRAFTS') { finishes.push(m.payload); return cb(finishReply || { success: true, polished: 3, warnings: [], source: 'ondevice', injection: [], variants: [{ text: 'Polished A', source: 'ondevice' }, { text: 'Polished B', source: 'ondevice' }, { text: 'Polished C', source: 'ondevice' }], generatedMessage: 'Polished A' }); }
        if (m.type === 'BUILD_RESUME_PROMPT') { resumeBuilds.push(m.payload); return cb({ success: true, system: 'RSYS', user: 'RUSER', schema: { type: 'object' }, resume: m.payload.text }); }
        if (m.type === 'PREVIEW_PAYLOAD') {
          const g = (store.aiProvider === 'groq') || /^gsk_/.test(store.userApiKey || '');
          return cb({ success: true, model: g ? 'llama-3.3-70b-versatile' : 'claude-haiku-5-5', providerName: g ? 'Groq' : 'Anthropic', host: g ? 'api.groq.com' : 'api.anthropic.com', system: 'SYS', user: '{"recipient_profile":{"name":"Priya Rao"}}' });
        }
        if (m.action === 'generateMessage') {
          calls.push(m.data); const n = calls.length;
          return cb({ success: true, generatedMessage: 'x', source: (store.userApiKey && !m.data.forceFree && store.mode !== 'free') ? 'ai' : 'template', warnings: [], injection: [], variants: [
            { text: `Hi Priya, we both went to IIT Madras (${m.data.format} #${n}). Open to a chat?`, source: m.data.forceFree ? 'template' : (store.userApiKey ? 'ai' : 'template'), provider: store.userApiKey ? ((store.aiProvider === 'groq' || /^gsk_/.test(store.userApiKey)) ? 'groq' : 'anthropic') : undefined,
              because: { hook: { kind: (m.data.overlaps[0] || {}).kind || 'role', label: (m.data.overlaps[0] || {}).label || '' }, credential: m.data.spotlight ? { kind: 'spotlight', label: m.data.spotlight.title, matches: m.data.spotlight.matches } : { kind: 'intro', label: 'x', matches: [] } } },
            { text: `Draft B #${n}`, source: 'template' }, { text: `Draft C #${n}`, source: 'template' }] });
        }
        cb({});
      } }
    };
    if (languageModel) w.LanguageModel = languageModel;
    if (translator) w.Translator = translator;
    if (detector) w.LanguageDetector = detector;
    w.navigator.clipboard = { writeText: async (x) => { copied.push(x); } };
    w.eval(SCRIPTS.map(f => fs.readFileSync(path.join(root, f), 'utf8').replace(/^'use strict';/, '')).join('\n;'));
    if (w.document.readyState === 'loading') await new Promise(r => w.document.addEventListener('DOMContentLoaded', () => r()));   // jsdom fires it itself; dispatching again would run init twice
    else w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
    await tick();
    const $ = id => w.document.getElementById(id);
    return { w, $, errors, calls, scrapes, resumeCalls, setResumeReply: r => { resumeReply = r; }, setDegree: d => { degree = d; }, resumeBuilds, setAbout: a => { about = a; }, copied, opened, composers, armed, refines, setRefine: f => { refineReply = f; }, setComposer: r => { composerReply = r; }, builds, finishes, setFinish: f => { finishReply = f; }, setSignals: sg => { signals = sg; }, detects, store, listeners, permCalls, deny: () => { allowRequests = false; }, setUrl: u => { tabUrl = u; }, click: async (id, ms = 100) => { $(id).click(); await tick(ms); } };
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

  test('popup: Recent remembers the person by their LinkedIn handle and a click opens their profile; pasted entries have no link', async () => {
    const t = await boot({ senderProfile: SENDER, recentContacts: [
      { profileUrl: 'https://www.linkedin.com/in/Old-Entry/?utm=x', name: 'Old Entry', message: 'hi', timestamp: 1 },   // saved before handles existed
      { profileUrl: '', name: 'Pasted Person', message: 'hello', timestamp: 2 },
      { profileUrl: 'https://evil.example/in/x', handle: '../x', name: 'Bad', message: 'x', timestamp: 3 }] }, { url: 'https://www.linkedin.com/feed/' });
    t.w.document.querySelector('.tab-btn[data-tab="recent"]').click(); await tick(60);
    const cards = [...t.w.document.querySelectorAll('.contact-card')];
    assert.strictEqual(cards.length, 3);
    cards[0].querySelector('.contact-link').click();
    assert.deepStrictEqual(t.opened, ['https://www.linkedin.com/in/old-entry/']);
    assert.ok(!cards[1].querySelector('.contact-link') && /pasted text/.test(cards[1].textContent));
    assert.ok(!cards[2].querySelector('.contact-link'), 'a stored value that is not a clean handle never becomes a link');
    // saving the same person again (different address form) updates ONE entry and stores the handle
    const t2 = await boot({ senderProfile: SENDER });
    await t2.click('scrape-btn'); await t2.click('copy-btn', 60);
    assert.strictEqual(t2.store.recentContacts[0].handle, 'priya');
    t2.store.recentContacts[0].profileUrl = 'https://www.linkedin.com/in/priya/?trk=a';
    await t2.click('copy-btn', 60);
    assert.strictEqual(t2.store.recentContacts.length, 1);
  });

  test('popup: ONE "Best next move" line sits with the drafts and follows the person (connected → message; recent post → warm up)', async () => {
    const t = await boot({ senderProfile: SENDER });
    await t.click('scrape-btn');
    const moves = () => [...t.w.document.querySelectorAll('#draft-notes .draft-note.move')].map(n => n.textContent);
    assert.strictEqual(moves().length, 1);
    assert.match(moves()[0], /^Best next move: (like or comment|open with)/);
    const c = await boot({ senderProfile: SENDER }); c.setDegree('1st');
    await c.click('scrape-btn');
    assert.match([...c.w.document.querySelectorAll('#draft-notes .draft-note.move')].map(n => n.textContent).join(' '), /already connected/);
  });

  test('popup: Follow-up Coach — marking sent starts the clock; a due entry shows a badge, a banner and a draft you copy yourself; replied/snooze stop it', async () => {
    const DAY = 24 * 3600e3;
    const mk = (over) => ({ profileUrl: 'https://www.linkedin.com/in/priya/', name: 'Priya Rao', message: 'Hi Priya', timestamp: Date.now() - 6 * DAY, sent: true, sentAt: Date.now() - 5 * DAY, ...over });
    const t = await boot({ senderProfile: SENDER, userName: 'SAKETH JANGALA', recentContacts: [mk()] }, { url: 'https://www.linkedin.com/feed/' });
    assert.strictEqual(t.$('recent-badge').textContent, '1');
    assert.ok(!t.$('followup-banner').classList.contains('hidden'));
    assert.match(t.$('followup-banner-text').textContent, /1 follow-up is due/);
    t.w.document.querySelector('.tab-btn[data-tab="recent"]').click(); await tick(60);
    assert.match(t.w.document.querySelector('.followup-note').textContent, /Follow-up 1 of 2 is due.*5 days/);
    await t.click('fu-write-0');
    const text = t.$('fu-text-0').value;
    assert.match(text, /^Hi Priya,\n/); assert.match(text, /\nBest regards,\nSaketh Jangala$/);
    t.$('fu-text-0').value = text + ' (edited)';
    await t.click('fu-copy-0', 1200);
    assert.deepStrictEqual(t.copied, [text + ' (edited)']);
    assert.strictEqual(t.store.recentContacts[0].followUps, 1);
    assert.strictEqual(t.$('recent-badge').classList.contains('hidden'), true, 'the second one is not due until day 10');

    const s = await boot({ senderProfile: SENDER, recentContacts: [mk()] }, { url: 'https://www.linkedin.com/feed/' });
    s.w.document.querySelector('.tab-btn[data-tab="recent"]').click(); await tick(60);
    await s.click('fu-snooze-0');
    assert.ok(s.store.recentContacts[0].snoozeUntil > Date.now() + 2 * DAY);
    assert.strictEqual(s.$('recent-badge').classList.contains('hidden'), true);
    const r = await boot({ senderProfile: SENDER, recentContacts: [mk()] }, { url: 'https://www.linkedin.com/feed/' });
    r.w.document.querySelector('.tab-btn[data-tab="recent"]').click(); await tick(60);
    await r.click('fu-replied-0');
    assert.strictEqual(r.store.recentContacts[0].replied, true);
    assert.match(r.w.document.querySelector('.followup-note').textContent, /They replied/);

    // marking sent starts the clock, un-marking resets everything
    const m = await boot({ senderProfile: SENDER, recentContacts: [mk({ sent: false, sentAt: undefined })] }, { url: 'https://www.linkedin.com/feed/' });
    m.w.document.querySelector('.tab-btn[data-tab="recent"]').click(); await tick(60);
    assert.ok(!m.w.document.querySelector('.followup-box'), 'nothing to follow up until it is sent');
    await m.click('sent-0');
    assert.ok(Math.abs(m.store.recentContacts[0].sentAt - Date.now()) < 5000);
    await m.click('sent-0');
    assert.strictEqual(m.store.recentContacts[0].sentAt, null);
  });

  test('popup: Copy & open copies first, asks the page to OPEN the right box (never sends), and says what to do — including when it cannot', async () => {
    const t = await boot({ senderProfile: SENDER });
    await t.click('scrape-btn');
    t.$('generated-message').value = 'My edited draft'; t.$('generated-message').dispatchEvent(new t.w.Event('input'));
    await t.click('copy-open-btn', 120);
    assert.deepStrictEqual(t.copied, ['My edited draft']);
    assert.deepStrictEqual(t.composers, [{ tabId: 42, want: 'note' }]);
    assert.match(t.$('status-message').textContent, /Copied\..*paste.*press Send yourself/);
    assert.strictEqual(t.store.recentContacts[0].message, 'My edited draft', 'what you copied is kept in Recent');
    t.setComposer({ success: false, reason: 'not-found' });
    await t.click('copy-open-btn', 120);
    assert.match(t.$('status-message').textContent, /Copied\. I couldn’t find the “Connect” button.*click it yourself/);
    t.setComposer({ success: false, reason: 'not-profile' });
    await t.click('copy-open-btn', 120);
    assert.match(t.$('status-message').textContent, /Open the person’s LinkedIn profile/);
    t.setComposer({ success: true, opened: 'connect' });
    await t.click('copy-open-btn', 120);
    assert.match(t.$('status-message').textContent, /Add a note/);
    assert.deepStrictEqual(t.copied.length, 4);
  });

  test('popup: the LinkedIn page helper is handed the CURRENT draft (edits included), cleared for a new person, and switched off by the setting', async () => {
    const t = await boot({ senderProfile: SENDER });
    await t.click('scrape-btn', 700);
    const last = () => t.armed.at(-1);
    assert.ok(last() && last().text.length > 20 && last().format === 'note' && last().enabled === true && last().tabId === 42, JSON.stringify(last()));
    t.$('generated-message').value = 'My edited draft'; t.$('generated-message').dispatchEvent(new t.w.Event('input')); await tick(600);
    assert.strictEqual(last().text, 'My edited draft');
    const n = t.armed.length;
    t.$('generated-message').dispatchEvent(new t.w.Event('input')); t.$('generated-message').dispatchEvent(new t.w.Event('input')); await tick(600);
    assert.strictEqual(t.armed.length, n + 1, 'rapid edits are sent once, not per keystroke');
    t.setUrl('https://www.linkedin.com/in/someone-else/'); t.listeners.forEach(f => f()); await tick(700);
    assert.strictEqual(last().text, '', 'a new person: the page forgets the old draft');
    // setting off: nothing is handed over, and the open page is told to switch the helper off
    const off = await boot({ senderProfile: SENDER, pageMode: 'off' });
    await off.click('scrape-btn', 700);
    assert.ok(off.armed.length === 0 || off.armed.every(a => a.enabled === false && a.text === ''), JSON.stringify(off.armed));
    assert.strictEqual(off.$('pm-off').checked, true);
    assert.strictEqual(off.$('page-chip').textContent, 'Off');
    off.$('pm-smart').checked = true; off.$('pm-smart').dispatchEvent(new off.w.Event('change')); await tick(700);
    assert.strictEqual(off.store.pageMode, 'smart');
    assert.strictEqual(off.$('page-chip').textContent, 'Smart composer');
    assert.ok(off.armed.at(-1).enabled === true && off.armed.at(-1).text.length > 20);
  });

  test('popup: Settings → On the LinkedIn page offers three choices; an older on/off switch maps to them; the choice is saved for the helper to follow', async () => {
    const d = await boot({ senderProfile: SENDER });
    assert.strictEqual(d.$('pm-smart').checked, true, 'Smart composer is the default');
    const old = await boot({ senderProfile: SENDER, noteFill: false });
    assert.strictEqual(old.$('pm-off').checked, true, 'an install that had switched the old option off stays off');
    d.$('pm-button').checked = true; d.$('pm-button').dispatchEvent(new d.w.Event('change')); await tick(100);
    assert.strictEqual(d.store.pageMode, 'button');
    assert.strictEqual(d.$('page-chip').textContent, 'Fill button only');
  });

  test('popup: "Want a change?" — free quick options rewrite the selected draft, Undo restores it exactly, and wording free mode cannot follow is refused without a request', async () => {
    const t = await boot({ senderProfile: SENDER });
    await t.click('scrape-btn');
    assert.deepStrictEqual([...t.w.document.querySelectorAll('#refine-chips .refine-chip')].map(b => b.textContent), ['Shorter', 'Warmer', 'More formal', 'Mention a project']);
    assert.match(t.$('refine-engine').textContent, /Free mode understands/);
    const before = t.$('generated-message').value;
    [...t.w.document.querySelectorAll('.refine-chip')].find(b => b.textContent === 'Shorter').click(); await tick(150);
    assert.strictEqual(t.refines.length, 1);
    assert.strictEqual(t.refines[0].comment, 'Make it shorter');
    assert.strictEqual(t.refines[0].data.forceFree, true, 'Free Mode: nothing goes to an AI');
    assert.strictEqual(t.refines[0].draft, before);
    assert.strictEqual(t.$('generated-message').value, 'Hi Priya,\nRevised text. Open to a quick chat?');
    assert.match(t.$('refine-status').textContent, /Revised: shorter/);
    assert.ok(!t.$('refine-undo-row').classList.contains('hidden'));
    assert.strictEqual(t.store.recentContacts[0].message, 'Hi Priya,\nRevised text. Open to a quick chat?', 'the revised draft is what Recent keeps');
    await t.click('refine-undo');
    assert.strictEqual(t.$('generated-message').value, before);
    assert.ok(t.$('refine-undo-row').classList.contains('hidden'));
    t.$('refine-input').value = 'sound like Shakespeare'; await t.click('refine-go');
    assert.match(t.$('refine-status').textContent, /Free mode can.t follow that wording/);
    assert.strictEqual(t.refines.length, 1, 'wording the free rules cannot follow is refused locally, with no request');
    assert.strictEqual(t.$('generated-message').value, before);
    t.$('refine-input').value = 'make it warmer and more casual';
    t.$('refine-input').dispatchEvent(new t.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await tick(150);
    assert.strictEqual(t.refines.length, 2, 'Enter submits');
    assert.strictEqual(t.refines[1].data.tone, 'Casual');
  });

  test('popup: "Want a change?" in AI Mode asks your AI directly, offers the extra AI-only quick options, and a failure leaves the draft alone', async () => {
    const t = await boot({ userApiKey: 'k', mode: 'ai', aiConsent: { version: 2, ackAt: 1, provider: 'anthropic' }, senderProfile: SENDER });
    await t.click('scrape-btn');
    const chips = () => [...t.w.document.querySelectorAll('.refine-chip')].map(b => b.textContent);
    assert.deepStrictEqual(chips(), ['Shorter', 'Warmer', 'More formal', 'Mention a project', 'Add a question', 'Less salesy']);
    assert.match(t.$('refine-engine').textContent, /Your AI rewrites it/);
    const before = t.$('generated-message').value;
    t.$('refine-input').value = 'mention that I am looking for summer internships'; await t.click('refine-go');
    assert.ok(!t.refines[0].data.forceFree, 'AI Mode asks the AI');
    assert.strictEqual(t.refines[0].comment, 'mention that I am looking for summer internships');
    assert.match(t.$('generated-message').value, /Revised text/);
    t.setRefine(() => ({ success: false, error: 'Anthropic is busy.' }));
    const now = t.$('generated-message').value;
    t.$('refine-input').value = 'shorter'; await t.click('refine-go');
    assert.match(t.$('refine-status').textContent, /Anthropic is busy/);
    assert.strictEqual(t.$('generated-message').value, now, 'a failed rewrite never touches the draft');
    assert.notStrictEqual(before, now);
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

  test('popup: Settings cards fold: "About you" is open until name + resume exist, then shows a one-line summary', async () => {
    const fresh = await boot({});
    assert.strictEqual(fresh.$('about-card').open, true);
    assert.strictEqual(fresh.$('ai-setup').open, true);
    assert.match(fresh.$('about-summary').textContent, /add your name and resume/);
    fresh.$('user-name').value = 'Asha'; fresh.$('user-name').dispatchEvent(new fresh.w.Event('input'));
    assert.match(fresh.$('about-summary').textContent, /^Asha/);

    const done = await boot({ userName: 'Asha Menon', resumeFileName: 'r.pdf', senderProfile: SENDER, userApiKey: 'sk-ant-x', mode: 'ai', aiConsent: { version: 2, ackAt: 1, provider: 'anthropic' } });
    await tick(60);
    assert.strictEqual(done.$('about-card').open, false);
    assert.strictEqual(done.$('ai-setup').open, false);
    assert.match(done.$('about-summary').textContent, /Asha Menon · resume added/);
    assert.match(done.$('ai-setup-status').textContent, /On · Anthropic/);
    // the "add resume" tip opens the folded card so the upload box is reachable
    await done.click('resume-tip-go', 40);
    assert.strictEqual(done.$('about-card').open, true);
    assert.deepStrictEqual(done.errors, []);
  });

  test('popup: the two formats are labelled by who you are writing to; the page decides which to use, says why, and respects a manual choice', async () => {
    const t = await boot({ senderProfile: SENDER });
    const labels = [...t.w.document.querySelectorAll('.format-btn')].map(b => b.textContent.replace(/\s+/g, ' ').trim());
    assert.deepStrictEqual(labels, ['New connection note · 200', 'Already connected message']);
    t.setDegree('1st');
    await t.click('scrape-btn');
    assert.strictEqual(t.calls.at(-1).format, 'message');
    assert.match(t.$('format-tip').textContent, /already connected, so I chose “Already connected”/);
    assert.match(t.$('char-count').textContent, /\/ 500$/);
    assert.strictEqual(t.$('generated-message').rows, 10);
    // you pick a format yourself → we stop choosing
    t.w.document.querySelector('.format-btn[data-format="note"]').click(); await tick(100);
    assert.strictEqual(t.calls.at(-1).format, 'note');
    await t.click('scrape-btn');
    assert.strictEqual(t.calls.at(-1).format, 'note', 'manual choice is respected');
    assert.ok(!/so I chose/.test(t.$('format-tip').textContent));

    const n = await boot({ senderProfile: SENDER, prefs: { format: 'message' } });   // saved preference is overridden by what the page says
    n.setDegree('2nd'); await n.click('scrape-btn');
    assert.strictEqual(n.calls.at(-1).format, 'note');
    assert.match(n.$('format-tip').textContent, /not connected yet \(2nd degree\), so I chose “New connection”/);

    const u = await boot({ senderProfile: SENDER });   // can't tell → keeps the current choice and says so
    await u.click('scrape-btn');
    assert.strictEqual(u.calls.at(-1).format, 'note');
    assert.match(u.$('format-tip').textContent, /couldn’t tell if you are connected/);
    assert.deepStrictEqual(t.errors.concat(n.errors, u.errors), []);
  });

  test('popup: connected or not is detected as soon as the profile is open (no click needed), and again when you move to someone else', async () => {
    const t = await boot({ senderProfile: SENDER }, { signals: { lines: ['Srinivas Thammana', 'He/Him · 1st'], labels: ['Message', 'Save', 'More'] } });
    await tick(120);
    assert.strictEqual(t.scrapes.length, 0, 'nothing was read from the page beyond the badge');
    assert.ok(t.detects.length >= 1 && t.detects.every(id => id === 42));
    const on = (f) => t.w.document.querySelector(`.format-btn[data-format="${f}"]`).getAttribute('aria-checked');
    assert.strictEqual(on('message'), 'true');
    assert.match(t.$('format-tip').textContent, /already connected, so I chose “Already connected”/);
    // a later scrape that cannot tell must not undo the earlier clear reading
    await t.click('scrape-btn');
    assert.strictEqual(t.calls.at(-1).format, 'message');

    // someone else, not connected
    t.setSignals({ lines: ['· 2nd'], labels: ['Invite Zed Roe to connect'] });
    t.setDegree('');
    t.setUrl('https://www.linkedin.com/in/zed-roe/'); t.listeners[0](); await tick(400);
    assert.strictEqual(on('note'), 'true');
    assert.match(t.$('format-tip').textContent, /not connected yet \(2nd degree\)/);
    assert.deepStrictEqual(t.errors, []);
  });

  test('popup: if you already chose a format, background detection leaves it alone', async () => {
    const t = await boot({ senderProfile: SENDER }, { signals: { lines: [], labels: [] } });
    t.w.document.querySelector('.format-btn[data-format="note"]').click(); await tick(60);
    t.setSignals({ lines: ['· 1st'], labels: [] });
    t.setUrl('https://www.linkedin.com/in/other/'); t.listeners[0](); await tick(400);
    assert.strictEqual(t.w.document.querySelector('.format-btn[data-format="note"]').getAttribute('aria-checked'), 'true');
    assert.ok(!/so I chose/.test(t.$('format-tip').textContent));
  });

  test('popup: a resume name written in capitals is filled in properly cased (device read and AI read)', async () => {
    const shouty = 'JANGALA SAKETH\nChennai, India\n\nEDUCATION\nVELLORE INSTITUTE OF TECHNOLOGY CHENNAI\nB.Tech Computer Science 2022 - 2026\n\nEXPERIENCE\nSoftware Intern, Globex, Jun 2024 - Aug 2024\n\nSKILLS\nPython, SQL, Docker, Git';
    const t = await boot({});
    t.$('resume-paste').value = shouty;
    await t.click('resume-paste-btn', 150);
    assert.strictEqual(t.$('user-name').value, 'Jangala Saketh');
    assert.ok(!/VELLORE INSTITUTE/.test(t.$('me-schools').value) || /Vellore Institute/.test(t.$('me-schools').value));
    assert.deepStrictEqual(t.errors, []);
  });

  test('popup: the profile card shows their photo when one was read (LinkedIn images only), and keeps the initial if it cannot load', async () => {
    const t = await boot({ senderProfile: SENDER });
    const av = () => t.$('profile-avatar');
    // drive the card directly with a photo url
    t.w.renderProfileCard({ name: 'Priya Rao', headline: 'x', currentCompany: 'y', photoUrl: 'https://media.licdn.com/dms/image/v2/a/profile-displayphoto-shrink_200_200/0/1' });
    const img = av().querySelector('img');
    assert.ok(img && /licdn\.com/.test(img.src) && img.referrerPolicy === 'no-referrer');
    assert.strictEqual(av().textContent, 'P', 'the initial shows until the picture loads');
    img.dispatchEvent(new t.w.Event('load'));
    assert.ok(av().classList.contains('has-photo'));
    // foreign host is never loaded
    t.w.renderProfileCard({ name: 'Priya Rao', photoUrl: 'https://evil.example/p.png' });
    assert.ok(!av().querySelector('img'));
    assert.strictEqual(av().textContent, 'P');
  });

  const WORKER = { ...SENDER, goal: '', projects: [{ name: 'Forecast Studio', summary: 'A Python dashboard for demand forecasting' }, { name: 'CampusMap', summary: 'A route planner for campus' }], experience: [] };

  test('popup: "Why you two" shows the spotlight with evidence; it is sent to the drafter; toggling it removes it; the draft says what it is built on', async () => {
    const t = await boot({ senderProfile: WORKER });
    await t.click('scrape-btn');
    assert.ok(!t.$('spot-row').classList.contains('hidden'), 'spotlight row visible');
    assert.strictEqual(t.$('spot-label').textContent, 'Forecast Studio');
    assert.match(t.$('spot-evidence').textContent, /matches their .*Python/i);
    assert.strictEqual(t.calls.at(-1).spotlight.title, 'Forecast Studio');
    assert.ok(!JSON.stringify(t.calls.at(-1)).includes('CampusMap'), 'the other project never leaves the panel');
    assert.deepStrictEqual(Object.keys(t.calls.at(-1).sender).sort(), ['city', 'employers', 'intro', 'schools', 'skills']);
    assert.match(t.$('draft-because').textContent, /^Built on: shared school IIT Madras · your work “Forecast Studio” \(Python/);
    // leave it out → next draft is built without it
    const before = t.calls.length;
    t.$('spot-chip').click(); await tick(120);
    assert.strictEqual(t.$('spot-chip').getAttribute('aria-pressed'), 'false');
    assert.strictEqual(t.calls.length, before + 1);
    assert.strictEqual(t.calls.at(-1).spotlight, null);
    assert.match(t.$('draft-because').textContent, /your intro/);
    assert.deepStrictEqual(t.errors, []);
  });

  test('popup: no spotlight row when nothing in the resume is relevant; AI drafts say what they were GIVEN', async () => {
    const t = await boot({ senderProfile: { ...WORKER, projects: [{ name: 'Bake Sale Poster', summary: 'Designed posters' }] } });
    await t.click('scrape-btn');
    assert.ok(t.$('spot-row').classList.contains('hidden'));
    assert.match(t.$('spot-none').textContent, /none of your projects or roles clearly matches/);
    assert.strictEqual(t.calls.at(-1).spotlight, null);
    const ai = await boot({ userApiKey: 'sk-ant-x', mode: 'ai', aiConsent: { version: 2, ackAt: 1, provider: 'anthropic' }, senderProfile: WORKER });
    await ai.click('scrape-btn');
    assert.match(ai.$('draft-because').textContent, /^Given to the AI: shared school IIT Madras.* · your work “Forecast Studio”/);
    // even with nothing shared and nothing relevant, the line still says what the AI was given
    const bare = await boot({ userApiKey: 'sk-ant-x', mode: 'ai', aiConsent: { version: 2, ackAt: 1, provider: 'anthropic' }, senderProfile: { intro: 'CS student', skills: ['Cobol'], projects: [{ name: 'Bake Sale Poster', summary: 'Designed posters' }] } });
    await bare.click('scrape-btn');
    assert.match(bare.$('draft-because').textContent, /^Given to the AI: their role and headline · your intro/);
  });

  test('popup: the goal field is saved with your profile, sent to the drafter, and Referral/Job hints appear as suggestions', async () => {
    const t = await boot({ senderProfile: { ...WORKER, schools: [], skills: [] } });
    t.$('me-card').classList.remove('hidden');
    t.$('me-goal').value = 'AI/ML internships'; t.$('me-goal').dispatchEvent(new t.w.Event('change')); await tick(60);
    assert.strictEqual(t.store.senderProfile.goal, 'AI/ML internships');
    t.$('message-type').value = 'Referral';
    await t.click('scrape-btn');
    assert.strictEqual(t.calls.at(-1).sender.goal, 'AI/ML internships');
    const notes = [...t.w.document.querySelectorAll('#draft-notes .draft-note')].map(n => n.textContent);
    assert.ok(notes.some(n => /^Best next move: ask for advice first/.test(n)), notes.join(' | '));
    const nogoal = await boot({ senderProfile: { ...WORKER, schools: [], skills: [] } });
    nogoal.$('message-type').value = 'Job';
    await nogoal.click('scrape-btn');
    assert.ok([...nogoal.w.document.querySelectorAll('#draft-notes .draft-note')].some(n => /add what you are looking for/.test(n.textContent)));
  });

  const fakeLM = (avail, over = {}) => { const log = { created: 0 }; const lm = { availability: async () => (typeof avail === 'function' ? avail() : avail), create: async (o) => { log.created++; if (o && o.monitor) { const l = {}; o.monitor({ addEventListener: (n, f) => { l[n] = f; } }); l.downloadprogress && l.downloadprogress({ loaded: 0.5 }); } if (over.createError) throw over.createError; return { prompt: async () => JSON.stringify({ variants: [] }), destroy: () => {} }; }, ...over.extra }; return { lm, log }; };

  test('popup: the On-device AI card appears only where Chrome has the API, and says plainly when the computer does not qualify', async () => {
    const none = await boot({});
    await tick(60);
    assert.ok(none.$('ondevice-card').classList.contains('hidden'), 'no LanguageModel API → no card');
    const { lm } = fakeLM('unavailable');
    const t = await boot({}, { languageModel: lm });
    await tick(80);
    assert.ok(!t.$('ondevice-card').classList.contains('hidden'));
    assert.strictEqual(t.$('ondevice-status').textContent, 'Not available here');
    assert.match(t.$('od-hint').textContent, /doesn’t meet Chrome’s requirements/);
    assert.ok(t.$('od-enable').classList.contains('hidden') && t.$('od-disable').classList.contains('hidden'));
    assert.deepStrictEqual(t.errors, []);
  });

  test('popup: Turn on starts the download from the click with progress, saves the choice, and Turn off reverts it', async () => {
    let state = 'downloadable';
    const { lm, log } = fakeLM(() => state, { });
    const orig = lm.create;
    lm.create = async (o) => { const r = await orig(o); state = 'available'; return r; };
    const t = await boot({}, { languageModel: lm });
    await tick(80);
    assert.strictEqual(t.$('ondevice-status').textContent, 'Ready to set up');
    assert.match(t.$('od-enable').textContent, /one-time download/);
    await t.click('od-enable', 150);
    assert.strictEqual(log.created, 1);
    assert.strictEqual(t.store.onDevice, true);
    assert.strictEqual(t.$('ondevice-status').textContent, 'On');
    assert.ok(t.$('od-enable').classList.contains('hidden') && !t.$('od-disable').classList.contains('hidden'));
    await t.click('od-disable', 100);
    assert.strictEqual(t.store.onDevice, false);
    assert.strictEqual(t.$('ondevice-status').textContent, 'Off');
    assert.match(t.$('od-hint').textContent, /ready on this computer/);
  });

  test('popup: a refused or failed setup is explained and leaves the free drafts untouched', async () => {
    const e = new Error('x'); e.name = 'NotAllowedError';
    const { lm } = fakeLM('downloadable', { createError: e });
    const t = await boot({}, { languageModel: lm });
    await tick(80);
    await t.click('od-enable', 150);
    assert.notStrictEqual(t.store.onDevice, true);
    assert.match(t.$('od-hint').textContent, /Press Turn on again/);
    assert.strictEqual(t.$('od-enable').disabled, false);
  });

  const readyLM = (reply, log = {}) => ({ availability: async () => 'available', create: async () => ({ prompt: async (u, o) => { log.prompts = (log.prompts || 0) + 1; log.last = { u, o }; return typeof reply === 'function' ? reply() : reply; }, destroy: () => { log.destroyed = (log.destroyed || 0) + 1; } }) });
  const MODEL_JSON = JSON.stringify({ variants: ['raw 1', 'raw 2', 'raw 3'] });

  test('popup: Free+ shows the template drafts instantly, then on-device AI replaces them in place (source badge, "Polished on your device from")', async () => {
    const log = {};
    let release; const gate = new Promise(r => { release = r; });
    const t = await boot({ senderProfile: SENDER, onDevice: true }, { languageModel: readyLM(async () => { await gate; return MODEL_JSON; }, log) });
    await tick(80);
    await t.click('scrape-btn', 60);
    assert.match(t.$('generated-message').value, /^Hi Priya, we both went to IIT Madras/, 'template draft is on screen first');
    assert.match(t.$('source-badge').textContent, /polishing on your device/);
    release(); await tick(250);
    assert.strictEqual(t.$('generated-message').value, 'Polished A');
    assert.match(t.$('source-badge').textContent, /Written on your device/);
    assert.match(t.$('draft-because').textContent, /^Polished on your device from: shared school IIT Madras/);
    assert.strictEqual(t.w.document.querySelectorAll('.draft-tab').length, 3);
    assert.strictEqual(t.builds.length, 1);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(t.finishes[0].raw)), ['raw 1', 'raw 2', 'raw 3']);
    assert.strictEqual(log.last.u, 'USER');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(log.last.o.responseConstraint)), { type: 'object' });
    assert.strictEqual(log.destroyed, 1);
    assert.deepStrictEqual(t.errors, []);
  });

  test('popup: Free+ never runs when it should not: toggle off, AI mode, or model not ready', async () => {
    for (const [store, lm, label] of [[{ senderProfile: SENDER, onDevice: false }, readyLM(MODEL_JSON), 'switched off'],
      [{ senderProfile: SENDER, onDevice: true, userApiKey: 'sk-ant-x', mode: 'ai', aiConsent: { version: 2, ackAt: 1, provider: 'anthropic' } }, readyLM(MODEL_JSON), 'AI mode'],
      [{ senderProfile: SENDER, onDevice: true }, { availability: async () => 'downloadable', create: async () => { throw new Error('no'); } }, 'not downloaded']]) {
      const t = await boot(store, { languageModel: lm });
      await tick(80); await t.click('scrape-btn', 200);
      assert.strictEqual(t.builds.length, 0, label);
      assert.doesNotMatch(t.$('source-badge').textContent, /polishing|Written on your device/, label);
    }
  });

  test('popup: Free+ failures leave the template drafts alone and say so calmly (bad JSON, nothing usable, thrown error)', async () => {
    const cases = [['not json at all', null], [MODEL_JSON, { success: true, polished: 0, warnings: ['x'], variants: [], source: 'template' }], [() => { throw new Error('quota'); }, null]];
    for (const [reply, finish] of cases) {
      const t = await boot({ senderProfile: SENDER, onDevice: true }, { languageModel: readyLM(reply) });
      await tick(80);
      if (finish) t.setFinish(finish);
      await t.click('scrape-btn', 300);
      assert.match(t.$('generated-message').value, /^Hi Priya, we both went to IIT Madras/);
      assert.match(t.$('source-badge').textContent, /^Free draft · made on your device$/);
      assert.match(t.w.document.getElementById('draft-notes').textContent, /couldn’t improve these drafts this time/);
      assert.deepStrictEqual(t.errors, []);
    }
  });

  test('popup: a draft you already edited is never overwritten by the polish; moving to another person discards it', async () => {
    let release; const gate = new Promise(r => { release = r; });
    const t = await boot({ senderProfile: SENDER, onDevice: true }, { languageModel: readyLM(async () => { await gate; return MODEL_JSON; }) });
    await tick(80);
    await t.click('scrape-btn', 60);                         // templates are showing, model is "thinking"
    const ta = t.$('generated-message');
    ta.value = 'My own words.'; ta.dispatchEvent(new t.w.Event('input'));
    release(); await tick(250);
    assert.strictEqual(t.$('generated-message').value, 'My own words.', 'edited draft kept');
    t.$('draft-tab-1').click(); await tick(20);
    assert.strictEqual(t.$('generated-message').value, 'Polished B', 'the other drafts were upgraded');

    let release2; const gate2 = new Promise(r => { release2 = r; });
    const u = await boot({ senderProfile: SENDER, onDevice: true }, { languageModel: readyLM(async () => { await gate2; return MODEL_JSON; }) });
    await tick(80);
    await u.click('scrape-btn', 60);
    u.setUrl('https://www.linkedin.com/in/someone-else/'); u.listeners[0](); await tick(260);
    release2(); await tick(250);
    assert.strictEqual(u.finishes.length, 0, 'stale polish is dropped before it is finished');
    assert.ok(u.$('message-section').classList.contains('hidden'));
  });

  const trStub = (log = {}, opts = {}) => ({ availability: async (o) => { log.avail = (log.avail || []).concat([`${o.sourceLanguage}>${o.targetLanguage}`]); return opts.unavailable && opts.unavailable(o) ? 'unavailable' : 'available'; },
    create: async (o) => { if (o.sourceLanguage !== 'en' && opts.refuseBack && !log.allowBack) { const e = new Error('x'); e.name = 'NotAllowedError'; throw e; }
      if (o.monitor) { const l = {}; o.monitor({ addEventListener: (n, f) => { l[n] = f; } }); l.downloadprogress && l.downloadprogress({ loaded: 0.5 }); }
      return { translate: async (x) => (o.sourceLanguage === 'en' ? `[${o.targetLanguage}] ${x}` : `English check of: ${x.replace(/^\[\w+\] /, '')}`), destroy: () => {} }; } });
  const detStub = (lang, conf = 0.95) => ({ availability: async () => 'available', create: async () => ({ detect: async () => [{ detectedLanguage: lang, confidence: conf }], destroy: () => {} }) });
  const GERMAN_ABOUT = 'Ich leite ein Team für Datenplattformen und schreibe gern über Softwarearchitektur und Cloud.';

  test('popup: "Write in another language" appears only where Chrome has the Translator, and detects a non-English profile on its own', async () => {
    const none = await boot({ senderProfile: SENDER });
    none.setAbout(GERMAN_ABOUT); await none.click('scrape-btn', 120);
    assert.ok(none.$('translate-card').classList.contains('hidden'));

    const t = await boot({ senderProfile: SENDER }, { translator: trStub(), detector: detStub('de') });
    t.setAbout(GERMAN_ABOUT);
    await t.click('scrape-btn', 200);
    assert.ok(!t.$('translate-card').classList.contains('hidden'));
    assert.ok(t.$('tr-lang').options.length >= 15);
    assert.strictEqual(t.$('tr-lang').value, 'de');
    assert.strictEqual(t.$('tr-hint').textContent, 'Their profile looks German');
    assert.strictEqual(t.$('translate-card').open, true);
    // English profile: stays quiet, card still available for manual use
    const en = await boot({ senderProfile: SENDER }, { translator: trStub(), detector: detStub('en') });
    en.setAbout('I lead a data platform team and write about software architecture and cloud systems.');
    await en.click('scrape-btn', 200);
    assert.strictEqual(en.$('tr-hint').textContent, '');
    assert.strictEqual(en.$('translate-card').open, false);
    assert.deepStrictEqual(t.errors.concat(en.errors, none.errors), []);
  });

  test('popup: Translate gives the translation AND an English back-translation, warns when a note gets too long, and copies the edited text', async () => {
    const log = {};
    const t = await boot({ senderProfile: SENDER }, { translator: trStub(log), detector: detStub('de') });
    t.setAbout(GERMAN_ABOUT);
    await t.click('scrape-btn', 200);
    const english = t.$('generated-message').value;
    await t.click('tr-go', 250);
    assert.ok(!t.$('tr-result').classList.contains('hidden'));
    assert.strictEqual(t.$('tr-out').value, `[de] ${english}`);
    assert.match(t.$('tr-back').textContent, /^English check of: Hi Priya/);
    assert.deepStrictEqual(log.avail, ['en>de', 'de>en']);
    assert.strictEqual(t.$('generated-message').value, english, 'the English draft is untouched');
    assert.match(t.$('tr-count').textContent, /characters \(LinkedIn notes allow 200\)/);
    assert.ok(t.$('tr-count').classList.contains('over') === (t.$('tr-out').value.length > 200));
    t.$('tr-out').value = 'Hallo Priya, bearbeitet.'; t.$('tr-out').dispatchEvent(new t.w.Event('input'));
    await t.click('tr-copy', 60);
    assert.deepStrictEqual(t.copied, ['Hallo Priya, bearbeitet.']);
    assert.deepStrictEqual(t.errors, []);
  });

  test('popup: translation problems are explained: unavailable pair, refused back-check (retry works), empty draft; moving away clears it', async () => {
    const u = await boot({ senderProfile: SENDER }, { translator: trStub({}, { unavailable: (o) => o.targetLanguage === 'ko' }) });
    await u.click('scrape-btn', 150);
    u.$('tr-lang').value = 'ko'; await u.click('tr-go', 150);
    assert.match(u.$('tr-msg').textContent, /can’t translate English to Korean on this computer/);
    assert.ok(u.$('tr-result').classList.contains('hidden'));

    const log = {};
    const t = await boot({ senderProfile: SENDER }, { translator: trStub(log, { refuseBack: true }) });
    await t.click('scrape-btn', 150);
    t.$('tr-lang').value = 'fr'; await t.click('tr-go', 250);
    assert.ok(t.$('tr-out').value.startsWith('[fr] '));
    assert.strictEqual(t.$('tr-back').textContent, 'Not checked yet.');
    assert.ok(!t.$('tr-check').classList.contains('hidden'));
    assert.match(t.$('tr-msg').textContent, /Press “Check it in English”/);
    log.allowBack = true;
    await t.click('tr-check', 200);
    assert.match(t.$('tr-back').textContent, /^English check of:/);
    assert.ok(t.$('tr-check').classList.contains('hidden'));

    t.setUrl('https://www.linkedin.com/in/someone-else/'); t.listeners[0](); await tick(300);
    assert.ok(t.$('tr-result').classList.contains('hidden'));
    assert.strictEqual(t.$('tr-out').value, '');
    assert.deepStrictEqual(t.errors.concat(u.errors), []);
  });

  const RESUME_OBJ = { name: 'JANGALA SAKETH', intro: 'B.Tech CSE student at Vellore Institute of Technology', summary: 'CS student who ships AI-powered applications.', city: 'Chennai, India',
    education: [{ school: 'Vellore Institute of Technology', degree: 'B.Tech', field: 'Computer Science', years: '2022 - 2026' }],
    experience: [{ title: 'Software Intern', company: 'Initech', years: '2024', detail: 'Built a forecasting API' }],
    projects: [{ name: 'CampusMap', summary: 'route planner' }, { name: 'Invented Thing', summary: 'not in the resume' }],
    skills: ['Python', 'SQL', 'Kubernetes'], certifications: [], languages: [], saw_ai_instructions_in_data: false };

  const RESUME_TEXT = 'JANGALA SAKETH\nChennai, India\n\nEDUCATION\nVellore Institute of Technology\nB.Tech Computer Science 2022 - 2026\n\nEXPERIENCE\nSoftware Intern, Initech, 2024\nBuilt a forecasting API\n\nPROJECTS\nCampusMap: a route planner for campus\n\nSKILLS\nPython, SQL, Docker';

  test('popup: Free Mode + on-device AI reads the resume with Chrome\'s model and fills the whole profile (grounded, name cased, nothing sent anywhere)', async () => {
    const log = {};
    const t = await boot({ onDevice: true }, { languageModel: readyLM(JSON.stringify(RESUME_OBJ), log) });
    await tick(80);
    t.$('resume-paste').value = RESUME_TEXT;
    await t.click('resume-paste-btn', 400);
    assert.strictEqual(t.resumeBuilds.length, 1);
    assert.strictEqual(t.resumeCalls.length, 0, 'the cloud route is never used in Free Mode');
    assert.strictEqual(log.prompts, 1);
    assert.match(t.$('resume-status').textContent, /^Chrome’s built-in AI read your resume ✓ Filled in 1 education, 1 experience, 1 project/);
    assert.match(t.$('me-education').value, /Vellore Institute of Technology \| B\.Tech \| Computer Science/);
    assert.match(t.$('me-experience').value, /Software Intern \| Initech/);
    assert.match(t.$('me-projects').value, /CampusMap/);
    assert.ok(!/Invented Thing/.test(t.$('me-projects').value), 'a project that is not in the resume text is dropped');
    assert.ok(!/Kubernetes/.test(t.$('me-skills').value), 'an invented skill is dropped');
    assert.match(t.$('me-intro').value, /Vellore Institute of Technology/);
    assert.strictEqual(t.$('user-name').value, 'Jangala Saketh', 'ALL CAPS name is cased properly');
    const sp = JSON.parse(JSON.stringify(t.store.senderProfile));
    assert.strictEqual(sp.source, 'ondevice');
    assert.strictEqual(sp.experience[0].company, 'Initech');
    assert.deepStrictEqual(t.errors, []);
  });

  test('popup: an unreadable on-device answer keeps the on-device heuristic result and says so; Free Mode without the switch never calls the model', async () => {
    const bad = await boot({ onDevice: true }, { languageModel: readyLM('this is not json') });
    await tick(80);
    bad.$('resume-paste').value = fs.readFileSync(path.join(__dirname, 'fixtures/resume_sample.txt'), 'utf8');
    await bad.click('resume-paste-btn', 400);
    assert.match(bad.$('resume-status').textContent, /couldn’t read this resume well, so I’m using what was read on this device/);
    assert.match(bad.$('me-schools').value, /Indian Institute of Technology Madras/);
    const log = {};
    const off = await boot({ onDevice: false }, { languageModel: readyLM(JSON.stringify(RESUME_OBJ), log) });
    await tick(80);
    off.$('resume-paste').value = fs.readFileSync(path.join(__dirname, 'fixtures/resume_sample.txt'), 'utf8');
    await off.click('resume-paste-btn', 300);
    assert.strictEqual(off.resumeBuilds.length, 0);
    assert.ok(!log.prompts);
    assert.ok(off.$('resume-ai-btn').classList.contains('hidden'));
  });

  test('popup: turning on-device AI on reads an already-uploaded resume by itself, and "Re-read" works with it', async () => {
    let state = 'downloadable'; const log = {};
    const lm = { availability: async () => state, create: async (o) => { if (o && o.monitor) { /* download */ } state = 'available'; return { prompt: async () => { log.prompts = (log.prompts || 0) + 1; return JSON.stringify(RESUME_OBJ); }, destroy: () => {} }; } };
    const resumeText = fs.readFileSync(path.join(__dirname, 'fixtures/resume_sample.txt'), 'utf8');
    const t = await boot({ resumeText, resumeFileName: 'r.pdf', senderProfile: SENDER }, { languageModel: lm });
    await tick(80);
    assert.strictEqual(t.resumeBuilds.length, 0);
    await t.click('od-enable', 500);
    assert.strictEqual(t.resumeBuilds.length, 1, 'read automatically after turning it on');
    assert.strictEqual(JSON.parse(JSON.stringify(t.store.senderProfile)).source, 'ondevice');
    assert.ok(!t.$('resume-ai-btn').classList.contains('hidden'));
    assert.strictEqual(t.$('resume-ai-btn').textContent, 'Re-read my resume with on-device AI');
    await t.click('resume-ai-btn', 400);
    assert.strictEqual(t.resumeBuilds.length, 2);
  });
};
