'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

module.exports = (test, load) => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\/\/.*$/gm, '');
  const WATCH = read('utils/jobwatch.js'), CARD = read('utils/jobcard.js'), SCRAPE = read('utils/jobscrape.js');

  test('jobwatch: it may only ask the background for two things, never clicks, types or touches the network', () => {
    const actions = [...WATCH.matchAll(/action:\s*'([A-Za-z_]+)'/g)].map(m => m[1]);
    assert.deepStrictEqual([...new Set(actions)].sort(), ['analyzeJob', 'openPanel']);
    [WATCH, CARD, SCRAPE].forEach(src => {
      assert.ok(!/\.click\(|\.submit\(|requestSubmit|dispatchEvent|execCommand|\.value\s*=/.test(src), 'it never clicks or types into LinkedIn');
      assert.ok(!/\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket/.test(src), 'no network of its own');
      assert.ok(!/userApiKey|resumeText|senderProfile/.test(src), 'it never reads your key, resume or profile: the background does');
    });
  });

  let JSDOM; try { ({ JSDOM } = require('jsdom')); } catch (_) { /* jsdom missing: behaviour tests skipped like the popup tests */ }
  if (!JSDOM) return;
  const JS = load('utils/jobscrape.js'), JC = load('utils/jobcard.js'), JW = load('utils/jobwatch.js');
  const PAGE = fs.readFileSync(path.join(__dirname, 'fixtures/linkedin_job_page.html'), 'utf8');
  const tick = (ms = 30) => new Promise(r => setTimeout(r, ms));
  const mk = (html, url = 'https://www.linkedin.com/jobs/view/4012345678/') => new JSDOM(`<!doctype html><html><head><title>Data Analyst Intern | Initech | LinkedIn</title></head><body>${html}</body></html>`, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const bare = (html) => html.replace(/\sclass="[^"]*"/g, '').replace(/\sid="job-details"/g, '');

  test('jobscrape: reads title, company, place, chips, and the description with line breaks, without clicking anything', () => {
    const dom = mk(PAGE); const clicks = [];
    dom.window.document.querySelectorAll('button').forEach(b => b.addEventListener('click', () => clicks.push(1)));
    const s = JS.scrape(dom.window.document, dom.window.location);
    assert.strictEqual(s.ok, true); assert.strictEqual(s.key, '4012345678');
    assert.strictEqual(s.job.title, 'Data Analyst Intern'); assert.strictEqual(s.job.company, 'Initech');
    assert.strictEqual(s.job.location, 'Chennai, Tamil Nadu, India');
    assert.match(s.job.rawText, /Hybrid/); assert.match(s.job.rawText, /Over 100 applicants/); assert.match(s.job.rawText, /2 days ago/);
    assert.match(s.job.description, /Requirements\nPursuing B\.Tech/); assert.ok(!/Show less|Easy Apply/.test(s.job.description));
    assert.ok(!/Meet the hiring team/.test(s.job.description), 'only the description, not the rest of the pane');
    assert.deepStrictEqual(clicks, [], 'reading never clicks');
  });

  test('jobscrape: with LinkedIn\'s class names removed it still finds the posting by its "About the job" heading', () => {
    const dom = mk(bare(PAGE));
    const s = JS.scrape(dom.window.document, dom.window.location);
    assert.strictEqual(s.ok, true);
    assert.strictEqual(s.job.title, 'Data Analyst Intern'); assert.strictEqual(s.job.company, 'Initech');
    assert.match(s.job.description, /Python, SQL and Excel/);
  });

  test('jobscrape: the search layout (currentJobId in the address) gives the job id; an empty page fails calmly', () => {
    const dom = mk(PAGE, 'https://www.linkedin.com/jobs/search/?currentJobId=999&keywords=x');
    assert.strictEqual(JS.scrape(dom.window.document, dom.window.location).key, '999');
    const none = mk('<main><p>Search results</p></main>', 'https://www.linkedin.com/jobs/search/');
    const r = JS.scrape(none.window.document, none.window.location);
    assert.strictEqual(r.ok, false); assert.strictEqual(r.key, '');
    assert.doesNotThrow(() => JS.scrape(null, null)); assert.strictEqual(JS.scrape(null, null).ok, false);
  });

  test('jobcard: draws a verdict, meters, eligibility rows with quotes, skills; a scam gets a red banner; nothing in it can act on LinkedIn', () => {
    const dom = mk('<div id="x"></div>');
    const JF = load('utils/jobfit.js'), JP = load('utils/job_parse.js');
    const me = { senderProfile: { intro: 'final-year student', city: 'Chennai', skills: ['Python', 'SQL'], education: [{ degree: 'B.Tech', years: '2022 – 2026' }], experience: [], projects: [] }, resumeText: 'CGPA 8.4 Python SQL' };
    const job = { title: 'Data Analyst Intern', company: 'Initech', location: 'Chennai, India', chips: ['Hybrid', 'Internship'], description: 'Requirements\n2026 batch graduates only\nMinimum 7.0 CGPA\nPython, SQL, Excel\nNice to have\nTableau' };
    const ui = JC.create(dom.window, {});
    dom.window.document.getElementById('x').appendChild(ui.host);
    ui.render({ phase: 'result', data: { result: JF.analyze(JP.parse(job), me, { now: new Date('2026-03-01') }), job } });
    const root = ui.host.shadowRoot;
    assert.match(root.querySelector('.pill').textContent, /fit|applying/i);
    assert.strictEqual(root.querySelectorAll('.meter').length, 3);
    assert.ok(root.textContent.includes('Eligibility check') && /2026 graduates/.test(root.textContent) && root.querySelector('.q'));
    assert.ok(root.querySelector('.chip.have') && root.querySelector('.chip.need'));
    assert.ok(/never clicks Apply/.test(root.textContent));
    assert.ok(!root.querySelector('a'), 'the card has no links');
    const scam = { title: 'Data entry', company: '', description: 'Pay a registration fee of Rs 999 to start. Earn ₹5000 per day. WhatsApp +91 98765 43210.' };
    ui.render({ phase: 'result', data: { result: JF.analyze(JP.parse(scam), me), job: scam } });
    assert.ok(root.querySelector('.banner[role="alert"]') && /Be careful/.test(root.querySelector('.pill').textContent));
    ui.render({ phase: 'unreadable' }); assert.match(root.textContent, /could not read this job/);
    ui.render({ phase: 'stale' }); assert.match(root.textContent, /Refresh this LinkedIn page/);
    ui.render({ phase: 'result', data: { result: JF.analyze(JP.parse(job), null), job } });
    assert.match(root.textContent, /Add your resume/);
  });

  function setup({ html = PAGE, url, reply, mode = 'card' } = {}) {
    const dom = mk(html, url);
    const w = dom.window, sent = [];
    w.chrome = { runtime: { lastError: null, sendMessage: (m, cb) => { sent.push(m); setTimeout(() => cb(reply ? reply(m) : { success: true, job: { title: 'Data Analyst Intern' }, result: JF.analyze(JP.parse(m.job), null) }), 5); } },
      storage: { local: { get: (k, cb) => cb({ jobMode: mode }) }, onChanged: { addListener() {} } } };
    const JF = load('utils/jobfit.js'), JP = load('utils/job_parse.js');
    w.JobScrape = JS; w.JobCard = JC;
    const ctl = JW.create(w, { chrome: w.chrome, JobScrape: JS, JobCard: JC });
    return { w, d: w.document, ctl, sent, host: () => w.document.querySelector('[data-outreach-jobfit]') };
  }
  const JF2 = load('utils/jobfit.js'), JP2 = load('utils/job_parse.js');

  test('jobwatch: on a job page it puts the card above "About the job", asks the background once, and shows the answer', async () => {
    const t = setup();
    t.ctl.tick(); await tick(40);
    assert.ok(t.host(), 'card present');
    assert.strictEqual(t.host().nextElementSibling.tagName, 'SECTION', 'it sits right above the description section');
    assert.deepStrictEqual(t.sent.map(m => m.action), ['analyzeJob']);
    assert.ok(t.sent[0].job.description.includes('Python, SQL and Excel'));
    assert.match(t.host().shadowRoot.textContent, /Add your resume|fit|applying/i);
    t.ctl.tick(); await tick(20);
    assert.strictEqual(t.sent.length, 1, 'the same job is not analysed twice');
    t.ctl.destroy();
  });

  test('jobwatch: a different job replaces the card; a page that redraws without it gets it back; leaving /jobs removes it', async () => {
    const t = setup();
    t.ctl.tick(); await tick(30);
    t.host().remove(); t.ctl.tick(); await tick(10);
    assert.ok(t.host(), 'put back when LinkedIn redrew the page');
    assert.strictEqual(t.sent.length, 1);
    t.d.querySelector('#job-details').insertAdjacentHTML('beforeend', '<p>' + 'More about the role and team. '.repeat(40) + '</p>');
    t.ctl.tick(); await tick(30);
    assert.strictEqual(t.sent.length, 2, 'new content = new analysis');
    assert.strictEqual(t.d.querySelectorAll('[data-outreach-jobfit]').length, 1, 'never two cards');
    t.w.history.pushState({}, '', '/feed/'); t.ctl.tick();
    assert.strictEqual(t.host(), null);
    t.ctl.destroy();
  });

  test('jobwatch: setting off shows nothing; a search page with no job picked says nothing; an unreadable job says so after a few tries', async () => {
    const off = setup({ mode: 'off' }); off.ctl.setMode('off'); off.ctl.tick();
    assert.strictEqual(off.host(), null); assert.strictEqual(off.sent.length, 0);
    const none = setup({ html: '<main><p>Search results</p></main>', url: 'https://www.linkedin.com/jobs/search/' });
    none.ctl.tick(); none.ctl.tick(); none.ctl.tick(); none.ctl.tick();
    assert.strictEqual(none.host(), null);
    const bad = setup({ html: '<main><p>Loading…</p></main>', url: 'https://www.linkedin.com/jobs/view/123/' });
    bad.ctl.tick(); bad.ctl.tick(); assert.strictEqual(bad.host(), null, 'not yet: the page may still be loading');
    bad.ctl.tick(); assert.ok(bad.host()); assert.match(bad.host().shadowRoot.textContent, /could not read this job/);
    assert.strictEqual(bad.sent.length, 0);
  });

  test('jobwatch: a reloaded extension shows "Refresh this LinkedIn page"; a failed check says nothing was changed', async () => {
    const stale = setup();
    stale.w.chrome.runtime.sendMessage = (m, cb) => { stale.w.chrome.runtime.lastError = { message: 'Extension context invalidated.' }; setTimeout(() => cb(undefined), 2); };
    stale.ctl.tick(); await tick(30);
    assert.match(stale.host().shadowRoot.textContent, /Refresh this LinkedIn page/);
    const failed = setup({ reply: () => ({ success: false, error: 'I could not check this job. Nothing was changed.' }) });
    failed.ctl.tick(); await tick(30);
    assert.match(failed.host().shadowRoot.textContent, /Nothing was changed/);
  });

  test('jobwatch: the Panel button asks the background to open the panel and nothing else', async () => {
    const t = setup(); t.ctl.tick(); await tick(30);
    const btn = [...t.host().shadowRoot.querySelectorAll('button')].find(b => /Panel/.test(b.textContent));
    btn.click(); await tick(10);
    assert.deepStrictEqual(t.sent.map(m => m.action), ['analyzeJob', 'openPanel']);
  });
};
