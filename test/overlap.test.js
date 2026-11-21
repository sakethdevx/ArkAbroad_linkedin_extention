'use strict';
const assert = require('assert');

module.exports = (test, load) => {
  const O = load('utils/overlap.js');

  const recipient = (over = {}) => ({
    headline: 'Data Scientist at Globex', currentTitle: 'Data Scientist', currentCompany: 'Globex',
    pastCompanies: ['Initech'], location: 'Chennai, Tamil Nadu, India',
    educationEntries: [{ school: 'Indian Institute of Technology Madras', degree: 'B.Tech', dates: '2016 – 2020' }],
    skills: ['Python', 'Tableau'], experienceEntries: [], about: '', ...over
  });

  test('overlap: school aliases (IIT Madras ↔ full name) match', () => {
    const r = O.findOverlaps({ schools: ['IIT Madras'] }, recipient());
    assert.strictEqual(r[0].kind, 'school');
    assert.match(r[0].line, /studied at/);
  });

  test('overlap: look-alike schools do NOT match', () => {
    assert.strictEqual(O.schoolsMatch('IIT Madras', 'University of Madras'), false);
    assert.strictEqual(O.schoolsMatch('IIT Madras', 'IIT Bombay'), false);
    assert.strictEqual(O.schoolsMatch('National University of Singapore', 'Singapore Management University'), false);
    assert.strictEqual(O.schoolsMatch('Anna University', 'Anna University, Chennai'), true);
    assert.strictEqual(O.schoolsMatch('Universidad de Chile', 'Universidad de Chile'), true);
    assert.strictEqual(O.schoolsMatch('Universidad de Chile', 'Universidad Católica'), false);
  });

  test('overlap: companies ignore suffixes; different companies with a shared word do not match', () => {
    assert.ok(O.companiesMatch('Globex Corporation', 'Globex'));
    assert.ok(O.companiesMatch('Amazon', 'Amazon Web Services'));
    assert.ok(O.companiesMatch('Tata Consultancy Services', 'Tata Consultancy'));
    assert.strictEqual(O.companiesMatch('Tata Consultancy Services', 'Tata Motors'), false);
    assert.strictEqual(O.companiesMatch('Apple', 'Pineapple Labs'), false);
  });

  test('overlap: shared current employer ranks above school; past employer works', () => {
    const r = O.findOverlaps({ employers: ['Globex Corporation', 'Initech'], schools: ['IIT Madras'] }, recipient());
    assert.deepStrictEqual(r.map(x => x.kind), ['employer', 'school', 'employer']);
    assert.match(r[0].line, /you're at Globex/i);
    assert.match(r[2].detail, /both worked at Initech/);
  });

  test('overlap: skills aliasing and text corpus, capped at 3, aggregated into one item', () => {
    const r = O.findOverlaps({ skills: ['py', 'Python', 'Tableau', 'Machine Learning', 'ML', 'SQL', 'Rust'] },
      recipient({ skills: ['Python', 'Tableau', 'SQL'], headline: 'Machine learning engineer', about: '' }));
    const s = r.find(x => x.kind === 'skills');
    assert.ok(s);
    assert.ok(/Python/.test(s.label) && s.label.split(/,| and /).length <= 3);
    assert.ok(!/Rust/.test(s.label));
    assert.strictEqual(O.skillKey('JS'), 'javascript');
    assert.strictEqual(O.skillKey('Node.js'), 'node');
    assert.strictEqual(O.skillKey('C++'), 'c++');
  });

  test('overlap: ambiguous one-letter skills are not matched from free text', () => {
    const r = O.findOverlaps({ skills: ['R', 'Go', 'C'] }, recipient({ skills: [], headline: 'Go to market lead, R&D, C-suite advisor' }));
    assert.strictEqual(r.find(x => x.kind === 'skills'), undefined);
  });

  test('overlap: city matches on city, not on shared country', () => {
    assert.ok(O.findOverlaps({ city: 'Chennai, India' }, recipient()).some(x => x.kind === 'city'));
    assert.ok(!O.findOverlaps({ city: 'Mumbai, India' }, recipient()).some(x => x.kind === 'city'));
  });

  test('overlap: non-Latin / accented names and missing data never throw', () => {
    assert.doesNotThrow(() => O.findOverlaps({ schools: ['東京大学'], employers: ['Société Générale'], skills: ['データ分析'] },
      recipient({ educationEntries: ['東京大学'], currentCompany: 'Société Generale' })));
    const r = O.findOverlaps({ schools: ['東京大学'], employers: ['Société Générale'] }, recipient({ educationEntries: ['東京大学'], currentCompany: 'Societe Generale' }));
    assert.deepStrictEqual(r.map(x => x.kind).sort(), ['employer', 'school']);
    assert.deepStrictEqual(O.findOverlaps(null, null), []);
    assert.deepStrictEqual(O.findOverlaps({}, {}), []);
    assert.deepStrictEqual(O.findOverlaps({ schools: ['X'] }, { educationEntries: null, skills: null }), []);
  });

  test('overlap: no resume → no evidence', () => {
    assert.deepStrictEqual(O.findOverlaps({ schools: [], employers: [], skills: [], city: '' }, recipient()), []);
  });
};
