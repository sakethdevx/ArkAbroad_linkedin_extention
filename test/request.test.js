'use strict';
const assert = require('assert');

module.exports = (test, load) => {
  const R = load('utils/request.js');
  const Overlap = load('utils/overlap.js');
  const J = (x) => JSON.parse(JSON.stringify(x));

  const sender = { schools: ['Vellore Institute of Technology'], employers: ['Globex'], skills: ['Python', 'SQL'], city: 'Chennai', intro: 'final-year CS student', goal: 'Internships',
    projects: [{ name: 'CampusMap', summary: 'route planner built with Python' }], experience: [], education: [] };
  const profile = { name: 'Aryan Kalva', firstName: 'Aryan', headline: 'ML engineer working with Python', about: 'I build routing models.', skills: ['Python'], currentCompany: 'Acme',
    educationEntries: [{ school: 'Vellore Institute of Technology', degree: 'B.Tech' }], experienceEntries: [], recentPosts: [], pastCompanies: [] };

  test('request: shared() = the overlaps you keep + a contact-free sender summary + the one spotlight', () => {
    const s = J(R.shared(sender, profile));
    assert.ok(s.overlaps.some(o => o.kind === 'school' && /Vellore/.test(o.label)));
    assert.deepStrictEqual(Object.keys(s.overlaps[0]).sort(), ['detail', 'kind', 'label', 'line']);
    assert.deepStrictEqual(s.sender, J(Overlap.senderSummary(sender)));
    assert.ok(s.spotlight && /CampusMap/.test(s.spotlight.title));
    assert.ok(s.all.every(o => o.id));
  });

  test('request: leaving an overlap or the spotlight out removes it; no resume → nothing, never a crash', () => {
    const all = R.shared(sender, profile).all;
    const school = all.find(o => o.kind === 'school');
    assert.ok(!J(R.shared(sender, profile, { overlapOff: new Set([school.id]) })).overlaps.some(o => o.kind === 'school'));
    assert.ok(!J(R.shared(sender, profile, { overlapOff: [school.id] })).overlaps.some(o => o.kind === 'school'), 'an array works too');
    assert.strictEqual(R.shared(sender, profile, { spotlightOff: true }).spotlight, null);
    assert.deepStrictEqual(J(R.shared(null, profile)), { overlaps: [], all: [], sender: null, spotlight: null });
    assert.deepStrictEqual(J(R.shared({}, null)), { overlaps: [], all: [], sender: null, spotlight: null });
    assert.strictEqual(R.hasResumeInfo({}), false);
    assert.strictEqual(R.hasResumeInfo({ goal: 'x' }), true);
  });

  test('request: generateData() is the exact payload `generateMessage` takes; the key and resume text are never in it; forceFree only when asked', () => {
    const sh = R.shared(sender, profile);
    const d = J(R.generateData({ profile, settings: { userName: 'Saketh Jangala', userBio: 'bio', userApiKey: 'sk-SECRET', resumeText: 'RESUME' }, purpose: 'Job', tone: 'Casual', format: 'message', seed: 3, shared: sh }));
    assert.deepStrictEqual(Object.keys(d).sort(), ['format', 'messageType', 'overlaps', 'profileData', 'seed', 'sender', 'settings', 'spotlight', 'tone']);
    assert.deepStrictEqual(d.settings, { userName: 'Saketh Jangala', userBio: 'bio' });
    assert.ok(!JSON.stringify(d).includes('sk-SECRET') && !JSON.stringify(d).includes('RESUME'));
    assert.strictEqual(d.format, 'message');
    assert.strictEqual(J(R.generateData({ profile, shared: sh, forceFree: true })).forceFree, true);
    assert.strictEqual(J(R.generateData({ profile })).format, 'note');
    assert.strictEqual('forceFree' in J(R.generateData({ profile })), false);
  });
};
