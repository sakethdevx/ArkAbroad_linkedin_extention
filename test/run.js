'use strict';
// Minimal dependency-free test runner for the pure modules.  Run: node test/run.js
const assert = require('assert');
const path = require('path');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const load = (rel) => require(path.join(__dirname, '..', rel));

// Modules register themselves below as slices land; each file may export tests.
const PP = load('utils/profile_parse.js');

// ── Slice 1: profile parsing ─────────────────────────────────────────────────
test('regression: titles containing month substrings are NOT dates', () => {
  ['Marketing Manager', 'Junior Developer', 'Decision Scientist', 'Separation Analyst', 'Mayor Intern', 'Software Engineer']
    .forEach(t => assert.strictEqual(PP.isDateLine(t), false, t));
});

test('date lines: ranges, present, non-English, education years', () => {
  ['Jan 2023 - Present · 1 yr 2 mos', '2018 – 2022', 'Sep 2019 - Jun 2023 · 3 yrs 10 mos',
   'ene 2021 - actualidad · 2 años', 'Aug 2021', 'oct 2020 bis heute', '2021年1月 - 現在']
    .forEach(t => assert.ok(PP.isDateLine(t), t));
  assert.strictEqual(PP.isDateLine('Class of 2020 Coordinator'), false);
});

test('connection badge: reads 1st/2nd/3rd from the top card, ignores look-alikes', () => {
  assert.strictEqual(PP.parseConnectionDegree(['Priya Rao', '· 1st', 'Data Scientist']), '1st');
  assert.strictEqual(PP.parseConnectionDegree(['Priya Rao · 2nd']), '2nd');
  assert.strictEqual(PP.parseConnectionDegree(['3rd+']), '3rd+');
  assert.strictEqual(PP.parseConnectionDegree(['I finished 1st in my class and love it so much that I wrote a very long sentence about it here']), '');
  assert.strictEqual(PP.parseConnectionDegree(['Data Scientist', 'Chennai']), '');
  assert.strictEqual(PP.parseConnectionDegree(null), '');
});

test('detectConnection: badge, hidden label, Connect/Pending buttons; never guesses', () => {
  const d = (o) => JSON.parse(JSON.stringify(PP.detectConnection(o)));
  assert.deepStrictEqual(d({ lines: ['Priya', '· 1st', 'Data Scientist'] }), { connected: true, degree: '1st', signal: 'badge' });
  assert.strictEqual(d({ lines: ['1st degree connection'] }).connected, true);
  assert.strictEqual(d({ labels: ['2nd degree connection'] }).connected, false);
  assert.strictEqual(d({ lines: ['Priya · 3rd+'] }).connected, false);
  assert.deepStrictEqual(d({ labels: ['Invite Priya Rao to connect', 'Follow', 'Save in Sales Navigator'] }), { connected: false, degree: '', signal: 'connect-button' });
  assert.strictEqual(d({ labels: ['Pending'] }).connected, false);
  assert.strictEqual(d({ labels: ['Remove connection'] }).connected, true);
  // a lone Message button proves nothing (Premium / open profiles can message anyone)
  assert.strictEqual(d({ labels: ['Message', 'More actions'] }).connected, null);
  assert.strictEqual(d({}).connected, null);
  assert.strictEqual(d({ lines: ['I finished 1st in my class and wrote a very long sentence about it here today'] }).connected, null);
  const p = PP.buildProfile({ name: 'Priya', isConnection: true, connectionDegree: '1st', connectionSignal: 'badge' });
  assert.strictEqual(p.isConnection, true);
  assert.strictEqual(PP.buildProfile({ name: 'Priya' }).isConnection, null);
});

test('profile photo: picks the member\'s own picture from LinkedIn\'s CDN, skips banners, logos, tiny faces and foreign hosts', () => {
  const photo = 'https://media.licdn.com/dms/image/v2/D4D03AQabc/profile-displayphoto-shrink_200_200/0/1700000000000?e=1&t=x';
  const pick = (c, n) => PP.pickProfilePhoto(c, n || 'Srinivas Thammana');
  const banner = { src: 'https://media.licdn.com/dms/image/v2/D5616AQx/profile-displaybackgroundimage-shrink_350_1400/0/1', alt: '', width: 1400, height: 350 };
  const logo = { src: 'https://media.licdn.com/dms/image/v2/C4D0BAQy/company-logo_100_100/0/1', alt: 'PayPal', width: 100, height: 100 };
  const mutual = { src: 'https://media.licdn.com/dms/image/v2/Z/profile-displayphoto-shrink_100_100/0/2', alt: 'Abhienaya', width: 24, height: 24 };
  assert.strictEqual(pick([banner, logo, mutual, { src: photo, alt: 'Srinivas Thammana', width: 160, height: 160 }]), photo);
  assert.strictEqual(pick([{ src: photo, alt: '', cls: 'pv-top-card-profile-picture__image', width: 0, height: 0 }]), photo, 'unknown size is accepted when the URL says it is a profile photo');
  assert.strictEqual(pick([banner, logo, mutual]), '');
  assert.strictEqual(pick([{ src: 'https://evil.example/profile-displayphoto.png', alt: 'Srinivas Thammana', width: 200, height: 200 }]), '', 'only LinkedIn image hosts');
  assert.strictEqual(pick([{ src: 'http://media.licdn.com/x/profile-displayphoto.png', alt: 'Srinivas Thammana', width: 200, height: 200 }]), '', 'https only');
  assert.strictEqual(pick(null), '');
  assert.strictEqual(PP.buildProfile({ name: 'A', photoUrl: photo }).photoUrl, photo);
  assert.strictEqual(PP.buildProfile({ name: 'A', photoUrl: 'https://evil.example/x.png' }).photoUrl, '');
});

test('single role: Marketing Intern keeps its title', () => {
  const r = PP.parseRoleLines(['Marketing Intern', 'Acme Corp · Internship', 'Jun 2024 - Aug 2024 · 3 mos', 'Chennai, India']);
  assert.strictEqual(r.title, 'Marketing Intern');
  assert.strictEqual(r.company, 'Acme Corp');
  assert.strictEqual(r.employmentType, 'Internship');
  assert.strictEqual(r.location, 'Chennai, India');
  assert.strictEqual(r.isCurrent, false);
});

test('single role without employment type, with current job', () => {
  const r = PP.parseRoleLines(['Junior Developer', 'Globex', 'Jan 2023 - Present · 1 yr 10 mos']);
  assert.deepStrictEqual([r.title, r.company, r.isCurrent], ['Junior Developer', 'Globex', true]);
});

test('multiple roles at one company (DOM blocks)', () => {
  const blocks = [{
    lines: ['Globex', 'Full-time · 4 yrs 2 mos'],
    children: [
      { lines: ['Senior Engineer', 'Jan 2024 - Present · 10 mos', 'Remote'] },
      { lines: ['Software Engineer', 'Full-time', 'Sep 2020 - Dec 2023 · 3 yrs 4 mos'] }
    ]
  }, { lines: ['Data Analyst', 'Initech · Full-time', 'Jun 2018 - Aug 2020 · 2 yrs 3 mos'] }];
  const e = PP.parseExperienceBlocks(blocks);
  assert.strictEqual(e.length, 3);
  assert.deepStrictEqual(e.map(x => [x.title, x.company]),
    [['Senior Engineer', 'Globex'], ['Software Engineer', 'Globex'], ['Data Analyst', 'Initech']]);
  assert.strictEqual(e[0].isCurrent, true);
});

test('multiple roles at one company (flat-line fallback)', () => {
  const lines = ['Globex', '4 yrs 2 mos', 'Senior Engineer', 'Full-time', 'Jan 2024 - Present · 10 mos',
    'Software Engineer', 'Full-time', 'Sep 2020 - Dec 2023 · 3 yrs 4 mos',
    'Marketing Analyst', 'Initech · Full-time', 'Jun 2018 - Aug 2020 · 2 yrs 3 mos'];
  const e = PP.parseExperienceLines(lines);
  assert.deepStrictEqual(e.map(x => [x.title, x.company]),
    [['Senior Engineer', 'Globex'], ['Software Engineer', 'Globex'], ['Marketing Analyst', 'Initech']]);
});

test('duplicate visually-hidden lines are collapsed', () => {
  assert.deepStrictEqual(PP.cleanLines(['Engineer', 'Engineer', 'Acme', ' ', '·', 'Show all 5 experiences']), ['Engineer', 'Acme']);
});

test('education blocks and lines', () => {
  const b = PP.parseEducationBlocks([{ lines: ['IIT Madras', 'B.Tech, Computer Science', '2018 – 2022'] }, { lines: ['Some School'] }]);
  assert.deepStrictEqual(b[0], { school: 'IIT Madras', degree: 'B.Tech, Computer Science', dates: '2018 – 2022' });
  assert.deepStrictEqual(b[1], { school: 'Some School', degree: '', dates: '' });
  const l = PP.parseEducationLines(['IIT Madras', 'B.Tech, CS', '2018 – 2022', 'Anna University', 'MS', '2022 – 2024']);
  assert.deepStrictEqual(l.map(e => e.school), ['IIT Madras', 'Anna University']);
});

test('skills: dedupe, drop noise and subheadings', () => {
  const s = PP.parseSkills(['Python', 'python', 'Industry Knowledge', '12 endorsements', 'SQL', 'Show all 20 skills']);
  assert.deepStrictEqual(s, ['Python', 'SQL']);
});

test('headline: only explicit "X at Y" counts', () => {
  assert.deepStrictEqual(PP.titleCompanyFromHeadline('Data Scientist at Acme | ML'), { title: 'Data Scientist', company: 'Acme' });
  assert.strictEqual(PP.titleCompanyFromHeadline('Python | SQL | ML'), null);
  assert.strictEqual(PP.titleCompanyFromHeadline(''), null);
});

test('name fallbacks', () => {
  assert.strictEqual(PP.nameFromPageTitle('(3) Jane Doe - Engineer - Acme | LinkedIn'), 'Jane Doe');
  assert.strictEqual(PP.nameFromUrl('https://www.linkedin.com/in/jane-doe-1a2b3c4d/'), 'Jane Doe');
});

test('buildProfile never throws on empty/garbage and reports confidence none', () => {
  [undefined, {}, { experience: null, skills: 'x' }].forEach(x => {
    const p = PP.buildProfile(x);
    assert.strictEqual(p.quality.confidence, 'none');
    assert.ok(Array.isArray(p.experienceEntries));
  });
});

test('buildProfile: current role precedence + past companies', () => {
  const exp = PP.parseExperienceBlocks([
    { lines: ['Senior Engineer', 'Globex', 'Jan 2024 - Present'] },
    { lines: ['Engineer', 'Initech', 'Jan 2020 - Dec 2023'] }
  ]);
  const p = PP.buildProfile({ name: 'Jane Doe', headline: 'Engineer', experience: exp, skills: ['Python'] });
  assert.deepStrictEqual([p.currentTitle, p.currentCompany, p.pastCompanies], ['Senior Engineer', 'Globex', ['Initech']]);
  assert.strictEqual(p.quality.confidence, 'high'); // name, role, company, experience, skills
});

test('buildProfile: no experience, headline carries role', () => {
  const p = PP.buildProfile({ name: 'Jane', headline: 'Student at IIT Madras | Aspiring SWE', education: [{ school: 'IIT Madras' }] });
  assert.deepStrictEqual([p.currentTitle, p.currentCompany], ['Student', 'IIT Madras']);
});

test('pasted text → profile (English)', () => {
  const text = [
    'Jane Doe', 'Data Analyst at Globex | SQL', 'Chennai, Tamil Nadu, India', 'Contact info',
    'About', 'I enjoy turning messy data into decisions that help teams move faster every single day.',
    'Experience', 'Data Analyst', 'Globex · Full-time', 'Jan 2023 - Present · 1 yr 10 mos', 'Chennai, India',
    'Education', 'IIT Madras', 'B.Tech, Computer Science', '2018 – 2022',
    'Skills', 'SQL', 'Python'
  ].join('\n');
  const p = PP.parseProfileText(text);
  assert.strictEqual(p.name, 'Jane Doe');
  assert.strictEqual(p.currentCompany, 'Globex');
  assert.strictEqual(p.educationEntries[0].school, 'IIT Madras');
  assert.deepStrictEqual(p.skills, ['SQL', 'Python']);
  assert.ok(p.about.startsWith('I enjoy'));
  assert.strictEqual(p.source, 'pasted');
});

test('pasted text → profile (Spanish headings, no crash on junk)', () => {
  const p = PP.parseProfileText('María García\nIngeniera de datos en Acme\nExperiencia\nIngeniera de datos\nAcme · Jornada completa\nene 2022 - actualidad · 2 años\nAptitudes\nPython');
  assert.strictEqual(p.name, 'María García');
  assert.strictEqual(p.currentTitle, 'Ingeniera de datos');
  assert.deepStrictEqual(p.skills, ['Python']);
  assert.doesNotThrow(() => PP.parseProfileText('\u0000\u0001 ¯\\_(ツ)_/¯ '.repeat(500)));
  assert.strictEqual(PP.parseProfileText('').quality.confidence, 'none');
});

// ── Regression: description text must never become a job title (reported on a real profile) ──
const JUNK = 'This essay was originally published here. The keys my employee had just thrown at me ricocheted off of my left shoulder…';

test('regression: a description block in Experience is not a role, title or company', () => {
  const only = PP.buildProfile({ name: 'Justin Welsh', headline: 'Building a profitable one-person business', experience: PP.parseExperienceBlocks([{ lines: [JUNK], children: [] }]) });
  assert.strictEqual(only.currentTitle, '');
  assert.strictEqual(only.currentCompany, '');
  const mixed = PP.buildProfile({ name: 'J', experience: PP.parseExperienceBlocks([
    { lines: [JUNK], children: [] }, { lines: ['Founder', 'Acme · Self-employed', 'Jan 2019 - Present · 5 yrs'], children: [] }] ) });
  assert.deepStrictEqual([mixed.currentTitle, mixed.currentCompany], ['Founder', 'Acme']);
});

test('regression: plausibleLabel accepts real titles/companies, rejects sentences and truncated text', () => {
  ['Marketing Intern', 'Senior Software Engineer', 'Tata Consultancy Services', 'Founder & CEO', 'Dr. Smith Dental Clinic', 'Acme Inc. Group', 'U.S. Bank', 'Sr. Engineer'].forEach(t => assert.ok(PP.plausibleLabel(t), t));
  [JUNK, 'Led a team of five. We shipped the thing', 'x'.repeat(90), 'Something that was cut off…', ''].forEach(t => assert.ok(!PP.plausibleLabel(t), t));
});

test('regression: undated entries survive only if they still look like Title / Company', () => {
  const ok = PP.parseExperienceBlocks([{ lines: ['Barista', 'Local Cafe'], children: [] }]);
  assert.deepStrictEqual(ok.map(e => [e.title, e.company]), [['Barista', 'Local Cafe']]);
  assert.strictEqual(PP.parseExperienceBlocks([{ lines: ['Barista'], children: [] }]).length, 0);
});

// ── Regression: the quoted "post" was the author's headline (reported with screenshots) ──
test('regression: post text excludes author header, headline, time, counts and "…more"', () => {
  const ctx = { name: 'Saketh Jangala', headline: 'Amazon ML Summer School ’26 Mentee | AI/ML Intern | Google Cloud Arcade Facilitator' };
  const card = (body) => ['Saketh Jangala', '• You', 'Amazon ML Summer School ’26 …', '4mo • Edited •', body, '39', '4', '1,383 impressions', 'View analytics'];
  assert.strictEqual(PP.extractPostText(card('🚀 Selected for Amazon ML Summer School 2026!… more'), ctx), 'Selected for Amazon ML Summer School 2026!');
  assert.strictEqual(PP.extractPostText(card('Proud to have contributed as a Volunteer at Microsoft... more'), ctx), 'Proud to have contributed as a Volunteer at Microsoft');
  assert.strictEqual(PP.extractPostText(['Saketh Jangala', 'Amazon ML Summer School ’26 Mentee | AI/ML Intern | Google…'], ctx), '');
  assert.strictEqual(PP.extractPostText(['Saketh Jangala', '2,291 followers', 'Posts', 'Create a post'], ctx), '');
  assert.strictEqual(PP.extractPostText(null, ctx), '');
  assert.strictEqual(PP.extractPostText(card('A | B | C | D headline-like line that must not count'), ctx), '');
});

// ── Runner ───────────────────────────────────────────────────────────────────
// Later slices append test modules; dom.test.js needs jsdom and skips itself without it.
['dom', 'overlap', 'spotlight', 'compose', 'safety', 'draftcheck', 'rules', 'person', 'approach', 'followup', 'composer', 'notefill', 'pagecomposer', 'request', 'refine', 'ondevice', 'translate', 'resume', 'background', 'manifest', 'html', 'popup', 'scroll'].forEach(n => {
  try { require(`./${n}.test.js`)(test, load); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND' || !String(e.message).includes(`${n}.test.js`)) throw e; }
});

(async () => {
  let failed = 0;
  for (const t of tests) {
    try { await t.fn(); console.log('  ok   ' + t.name); }
    catch (e) { failed++; console.log('  FAIL ' + t.name + '\n       ' + (e.message || e).split('\n').join('\n       ')); }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
