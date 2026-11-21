'use strict';
const assert = require('assert');

module.exports = (test, load) => {
  const { spotlight } = load('utils/spotlight.js');

  const SENDER = {
    skills: ['Python', 'PyTorch', 'YOLO', 'FastAPI', 'SQL', 'REST APIs', 'React'],
    projects: [
      { name: 'CampusMap', summary: 'A route planner for campus built with React' },
      { name: 'Safety Monitor', summary: 'Real-time object detection with YOLO and PyTorch for construction sites' },
      { name: 'Inventory API', summary: 'FastAPI backend with SQL storage and REST APIs' }
    ],
    experience: [
      { title: 'ML Intern', company: 'Globex', years: '2024', detail: 'Trained a YOLO detection model' },
      { title: 'Web Developer', company: 'Initech', years: '2023', detail: 'Maintained React dashboards' }
    ]
  };
  const ML = { headline: 'Senior ML Engineer | Computer Vision | PyTorch', about: 'I build object detection systems for robotics.', skills: ['PyTorch', 'Computer Vision'], currentTitle: 'Senior ML Engineer', recentPosts: [] };
  const BACKEND = { headline: 'Engineering Manager, backend platforms', about: 'We run REST APIs on SQL-heavy services.', skills: ['FastAPI', 'SQL', 'REST APIs'], currentTitle: 'Engineering Manager', recentPosts: [] };
  const HR = { headline: 'Talent Acquisition Partner', about: 'I love people and culture.', skills: ['Recruiting', 'Onboarding'], currentTitle: 'Recruiter', recentPosts: [] };
  const j = (x) => JSON.parse(JSON.stringify(x));

  test('spotlight: the same resume gives a different, evidence-backed pick for different people', () => {
    const ml = j(spotlight(SENDER, ML));
    assert.strictEqual(ml.title, 'Safety Monitor');
    assert.strictEqual(ml.type, 'project');
    assert.ok(ml.matches.some(m => /pytorch|yolo/i.test(m)), ml.matches.join());
    assert.match(ml.text, /^I built Safety Monitor, real-time object detection/);
    const be = j(spotlight(SENDER, BACKEND));
    assert.strictEqual(be.title, 'Inventory API');
    assert.ok(be.matches.some(m => /fastapi|sql|rest/i.test(m)));
  });

  test('spotlight: unrelated people get null (never a forced weak link); null-safe on empty input', () => {
    assert.strictEqual(spotlight(SENDER, HR), null);
    assert.strictEqual(spotlight(null, ML), null);
    assert.strictEqual(spotlight(SENDER, null), null);
    assert.strictEqual(spotlight({}, ML), null);
    assert.strictEqual(spotlight({ projects: [{ name: 'X', summary: '' }] }, {}), null);
  });

  test('spotlight: never invents: the output text is built only from words already in the resume item', () => {
    for (const r of [ML, BACKEND]) {
      const s = j(spotlight(SENDER, r));
      const src = JSON.stringify(SENDER).toLowerCase();
      s.text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !['built', 'worked'].includes(w))
        .forEach(w => assert.ok(src.includes(w), `"${w}" is not in the resume`));
      s.matches.forEach(m => assert.ok(src.includes(m.toLowerCase().split(' ')[0].slice(0, 4)), m));
    }
  });

  test('spotlight: alias-aware (ML ≈ machine learning, JS ≈ JavaScript) and ignores generic words', () => {
    const sender = { skills: ['Machine Learning', 'JavaScript'], projects: [{ name: 'Churn Model', summary: 'Machine Learning model that predicts churn' }, { name: 'Portfolio', summary: 'A web app project' }] };
    assert.strictEqual(j(spotlight(sender, { headline: 'ML Engineer', skills: ['ML'], about: '' })).title, 'Churn Model');
    // "web app project built using" are stop-words, so they cannot create a match on their own
    assert.strictEqual(spotlight(sender, { headline: 'Building web app projects', about: 'I built a project using a web app', skills: [] }), null);
  });

  test('spotlight: an employer already used as the hook is not repeated as the credential; projects win ties over roles', () => {
    const sender = { skills: ['YOLO'], experience: [{ title: 'ML Intern', company: 'Globex', detail: 'Trained a YOLO detection model' }] };
    const r = { headline: 'YOLO detection engineer', skills: ['YOLO'], about: 'detection models' };
    assert.strictEqual(j(spotlight(sender, r)).type, 'experience');
    assert.strictEqual(spotlight(sender, r, { excludeCompanies: ['Globex'] }), null);
    const both = { skills: ['YOLO'], projects: [{ name: 'Det', summary: 'YOLO detection' }], experience: sender.experience };
    assert.strictEqual(j(spotlight(both, r)).type, 'project');
  });

  test('spotlight: deterministic, bounded and never throws on odd data', () => {
    assert.deepStrictEqual(j(spotlight(SENDER, ML)), j(spotlight(SENDER, ML)));
    const weird = { skills: [null, 5, 'Python'], projects: [null, { name: 'x'.repeat(500), summary: 'y'.repeat(900) + ' Python' }, { name: 3 }], experience: [null, {}, { title: 'Dev' }] };
    const out = spotlight(weird, { headline: 'Python', skills: ['Python'], about: 'Python', recentPosts: [null, 7] });
    if (out) { assert.ok(out.title.length <= 80 && out.text.length < 400); }
  });
};
