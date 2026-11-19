'use strict';
const assert = require('assert');

module.exports = (test, load) => {
  const C = load('utils/compose.js');

  const base = (over = {}) => ({
    profile: { firstName: 'Jane', currentTitle: 'Data Scientist', currentCompany: 'Globex', recentPosts: [], educationEntries: [], skills: ['Python'] },
    sender: { intro: 'final-year CS student at IIT Madras', schools: ['IIT Madras'], skills: ['Python'] },
    overlaps: [{ kind: 'school', label: 'IIT Madras', detail: 'You both studied at IIT Madras', line: 'x' }],
    messageType: 'Networking', tone: 'Neutral', format: 'note', senderName: 'Saketh', bio: '', ...over
  });

  test('compose: always 3 distinct variants; seed changes them', () => {
    const a = C.compose(base(), { seed: 0 }).variants.map(v => v.text);
    const b = C.compose(base(), { seed: 3 }).variants.map(v => v.text);
    assert.strictEqual(a.length, 3);
    assert.strictEqual(new Set(a).size, 3);
    assert.notDeepStrictEqual(a, b);
  });

  test('compose: FUZZ — a note never exceeds 200 chars, a message never exceeds 500', () => {
    const longCo = 'International Business Machines Corporation Global Technology Services Division';
    const longTitle = 'Senior Principal Staff Machine Learning Research Engineer and Technical Program Lead';
    const post = 'Excited to announce that after eighteen months of work our team has finally shipped the new platform to customers';
    const overlapSets = [[], [{ kind: 'school', label: 'Indian Institute of Technology Madras', detail: 'You both studied at X', line: '' }],
      [{ kind: 'employer', label: longCo, detail: "You've both worked at", line: '' }, { kind: 'skills', label: 'Python, SQL and Machine Learning', detail: '', line: '' }, { kind: 'city', label: 'Chennai', detail: '', line: '' }]];
    let n = 0;
    for (const messageType of ['Networking', 'Job', 'Referral', 'Collaboration'])
      for (const tone of ['Formal', 'Neutral', 'Casual'])
        for (const overlaps of overlapSets)
          for (const long of [false, true])
            for (const withPost of [false, true])
              for (const format of ['note', 'message'])
                for (const seed of [0, 1, 2, 7]) {
                  const ctx = base({ messageType, tone, overlaps, format,
                    profile: { firstName: long ? 'Maximilian-Alexander' : 'Jane', currentTitle: long ? longTitle : 'Analyst', currentCompany: long ? longCo : 'Globex', recentPosts: withPost ? [post] : [] },
                    sender: { intro: long ? 'final-year computer science and engineering student at the Indian Institute of Technology Madras' : '' },
                    senderName: long ? 'Saketh Venkata Subramanian Jangala' : 'Saketh' });
                  for (const v of C.compose(ctx, { seed }).variants) {
                    n++;
                    assert.ok(v.text.length <= C.LIMITS[format], `${format}/${messageType}/${tone}/${long} → ${v.text.length}: ${v.text}`);
                    assert.ok(v.text.length > 20);
                  }
                }
    assert.ok(n > 2000, 'fuzz covered ' + n);
  });

  test('compose: hook order — shared background → post → role → generic', () => {
    assert.match(C.compose(base()).variants[0].text, /IIT Madras/);
    const noOverlap = base({ overlaps: [], profile: { firstName: 'Jane', currentTitle: 'Analyst', currentCompany: 'Globex', recentPosts: ['A short post about data'] } });
    assert.match(C.compose(noOverlap).variants[0].text, /post/i);
    assert.match(C.compose(base({ overlaps: [] })).variants[0].text, /Data Scientist|Globex/);
    const v = C.compose(base({ overlaps: [], profile: { firstName: '' } })).variants[0];
    assert.strictEqual(v.specific, false);
    assert.match(v.text, /Hi there,/);
  });

  test('compose: Formal expands contractions; Casual keeps them', () => {
    const f = C.compose(base({ tone: 'Formal', format: 'message', overlaps: [{ kind: 'employer', label: 'Globex', detail: "They work at Globex, where you've worked", line: '' }] })).variants.map(v => v.text).join('\n');
    assert.ok(!/\b(I'm|I've|you're|don't)\b/.test(f), f);
    assert.match(f, /Dear Jane,/);
    assert.match(C.compose(base({ tone: 'Casual' })).variants[0].text, /^Hey Jane,/);
  });

  test('compose: message format has an easy out + sign-off with name; note has neither', () => {
    const m = C.compose(base({ format: 'message' })).variants[0].text;
    assert.match(m, /Best,\nSaketh$/);
    assert.match(m, /No worries|Totally fine/);
    const n = C.compose(base()).variants[0].text;
    assert.ok(!/Best,|Saketh/.test(n));
    assert.ok(!/Best,/.test(C.compose(base({ format: 'message', senderName: '' })).variants[0].text));
  });

  test('compose: a cold 200-char Referral note asks for advice, not a referral', () => {
    C.compose(base({ messageType: 'Referral' }), { seed: 0 }).variants.forEach(v => assert.ok(!/referral/i.test(v.text), v.text));
    assert.ok(C.compose(base({ messageType: 'Referral', format: 'message' })).variants.some(v => /referral/i.test(v.text)));
  });

  test('compose: a paragraph in title/company is never spliced into a sentence', () => {
    const junk = 'This essay was originally published here. The keys my employee had just thrown at me ricocheted off of my left shoulder…';
    for (const type of ['Networking', 'Job', 'Referral', 'Collaboration']) for (const format of ['note', 'message']) {
      const v = C.compose(base({ overlaps: [], messageType: type, format, profile: { firstName: 'Justin', currentTitle: junk, currentCompany: junk, recentPosts: [] } })).variants;
      v.forEach(x => assert.ok(!/essay|ricocheted|originally published/.test(x.text), x.text));
      assert.ok(v.every(x => x.text.length <= C.LIMITS[format]));
    }
    assert.match(C.compose(base({ overlaps: [], profile: { firstName: 'Justin', currentTitle: junk, currentCompany: '' } })).variants[0].text, /came across your profile/);
  });

  test('compose: a headline-looking "post" is never quoted', () => {
    const v = C.compose(base({ overlaps: [], profile: { firstName: 'Saketh', currentTitle: '', currentCompany: '', recentPosts: ['Amazon ML Summer School ’26 Mentee | AI/ML Intern | Google…'] } })).variants[0].text;
    assert.ok(!/recent post|Mentee/.test(v), v);
  });

  test('compose: survives empty / hostile profile fields', () => {
    assert.doesNotThrow(() => C.compose({ profile: {}, overlaps: [], messageType: 'Nope', tone: 'Nope', format: 'zzz' }));
    assert.doesNotThrow(() => C.compose({ profile: { firstName: '東京', currentTitle: '<script>', recentPosts: [null, 5] }, sender: null, overlaps: null, messageType: 'Job', tone: 'Casual', format: 'note' }));
  });

  test('checklist: specific / ask / length / cliché / name', () => {
    const ctx = { format: 'note', firstName: 'Jane', mentions: ['IIT Madras', 'Globex'] };
    const good = C.checklist('Hi Jane, I noticed we both went to IIT Madras. Would you be open to a quick chat?', ctx);
    assert.ok(good.every(i => i.ok), JSON.stringify(good.filter(i => !i.ok)));
    const bad = C.checklist('Hope this finds you well. ' + 'x'.repeat(200) + ' Can we talk? Or call? Which?', ctx);
    const by = Object.fromEntries(bad.map(i => [i.id, i.ok]));
    assert.deepStrictEqual(by, { specific: false, ask: false, length: false, cliche: false, named: false });
    assert.strictEqual(Object.fromEntries(C.checklist('x'.repeat(250), { format: 'message', firstName: 'A' }).map(i => [i.id, i.ok])).length, true);
  });

  test('checklist: mentionsFor collects labels, company, school, skills', () => {
    const m = C.mentionsFor({ currentCompany: 'Globex', currentTitle: 'Analyst', educationEntries: [{ school: 'IIT Madras' }], skills: ['Python', 'SQL'] },
      [{ label: 'Python and SQL' }]);
    ['Globex', 'Analyst', 'IIT Madras', 'Python', 'SQL'].forEach(x => assert.ok(m.includes(x), x));
  });
};
