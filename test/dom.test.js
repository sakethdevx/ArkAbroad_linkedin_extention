'use strict';
// Runs the real content_script.js against an HTML fixture. Needs jsdom, which is NOT a project
// dependency (the extension has no build/deps); this test skips itself when jsdom isn't installed.
//   NODE_PATH=/path/to/node_modules node test/run.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');

module.exports = (test) => {
  let JSDOM;
  try { ({ JSDOM } = require('jsdom')); } catch (_) { console.log('  skip DOM tests (jsdom not installed)'); return; }

  const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

  async function scrapeFixture(html, url) {
    const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
    const w = dom.window;
    let listener = null;
    w.scrollTo = () => {};
    w.chrome = { runtime: { onMessage: { addListener: (fn) => { listener = fn; } } } };
    w.eval(read('utils/profile_parse.js'));
    w.eval(read('utils/page_scroll.js'));
    w.eval(read('content_script.js'));
    w.eval(read('content_script.js'));                    // double injection must be harmless
    return new Promise((resolve) => listener({ action: 'scrapeProfile' }, {}, resolve));
  }

  test('DOM: multi-role company group + Marketing/Junior titles + hidden-span dedupe', async () => {
    const html = fs.readFileSync(path.join(__dirname, 'fixtures/profile_multirole.html'), 'utf8');
    const res = await scrapeFixture(html, 'https://www.linkedin.com/in/jane-doe-1a2b3c/');
    assert.ok(res.success, res.error);
    const p = JSON.parse(JSON.stringify(res.data));   // jsdom objects are cross-realm
    assert.strictEqual(p.name, 'Jane Doe');
    assert.strictEqual(p.currentTitle, 'Marketing Analyst');
    assert.strictEqual(p.currentCompany, 'Globex');
    assert.deepStrictEqual(p.experienceEntries.map(e => [e.title, e.company]), [
      ['Marketing Analyst', 'Globex'], ['Junior Developer', 'Globex'], ['Decision Science Intern', 'Initech']
    ]);
    assert.deepStrictEqual(p.pastCompanies, ['Initech']);
    assert.strictEqual(p.educationEntries[0].school, 'IIT Madras');
    assert.deepStrictEqual(p.skills, ['SQL', 'Python', 'Storytelling']);
    assert.ok(p.about.startsWith('I turn messy data'));
    assert.strictEqual(p.about.split('I turn messy').length, 2, 'about text not duplicated');
    assert.strictEqual(p.quality.confidence, 'high');
  });

  test('DOM: Activity reads the post body (inline links joined), not the author header or headline', async () => {
    const card = (body) => `<li><div><span>Saketh Jangala</span> <span>• You</span></div><div><span>Amazon ML Summer School ’26 …</span></div><div><span>4mo • Edited •</span></div>
      <div><span>${body}</span></div><div><span>39</span><span>1,383 impressions</span><a>View analytics</a></div></li>`;
    const html = `<html><body><section><h1>Saketh Jangala</h1><div class="text-body-medium">Amazon ML Summer School ’26 Mentee | AI/ML Intern | Google Cloud</div></section>
      <section><div id="activity"></div><h2>Activity</h2><div>2,291 followers</div><ul>
      ${card('🚀 Selected for <a>Amazon ML Summer School</a> 2026!… <span>more</span>')}${card('🚀 Proud to have contributed behind the scenes as a Volunteer at Microsoft… more')}</ul></section></body></html>`;
    const res = await scrapeFixture(html, 'https://www.linkedin.com/in/saketh/');
    const p = JSON.parse(JSON.stringify(res.data));
    assert.deepStrictEqual(p.recentPosts, ['Selected for Amazon ML Summer School 2026!', 'Proud to have contributed behind the scenes as a Volunteer at Microsoft']);
  });

  test('DOM: empty / non-profile page does not crash and reports "none"', async () => {
    const res = await scrapeFixture('<html><head><title>LinkedIn</title></head><body><div>hi</div></body></html>', 'https://www.linkedin.com/feed/');
    assert.ok(res.success);
    assert.strictEqual(res.data.quality.confidence, 'none');
  });

  test('DOM: page with only a name and headline degrades to "low/medium", never throws', async () => {
    const res = await scrapeFixture('<html><body><section><h1>Sam Lee</h1><div class="text-body-medium">Student at Anna University</div></section></body></html>',
      'https://www.linkedin.com/in/sam-lee/');
    assert.ok(res.success);
    assert.strictEqual(res.data.name, 'Sam Lee');
    assert.strictEqual(res.data.currentCompany, 'Anna University');
    assert.ok(['low', 'medium'].includes(res.data.quality.confidence));
  });
};
