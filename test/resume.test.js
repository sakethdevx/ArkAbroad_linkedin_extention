'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

module.exports = (test, load) => {
  const R = load('utils/resume.js');
  const { pathToFileURL } = require('url');
  async function loadPdfjs() {   // node needs an explicit worker path; the extension sets it via chrome.runtime.getURL
    const lib = await import(pathToFileURL(path.join(__dirname, '../lib/pdf.min.mjs')).href);
    lib.GlobalWorkerOptions.workerSrc = pathToFileURL(path.join(__dirname, '../lib/pdf.worker.min.mjs')).href;
    return lib;
  }
  const sample = fs.readFileSync(path.join(__dirname, 'fixtures/resume_sample.txt'), 'utf8');

  test('resume: redact removes emails, phones, URLs but keeps year ranges', () => {
    const t = R.redactContact('a@b.com +91 98765 43210 (415) 555-0132 https://x.io/me linkedin.com/in/me 2019 - 2023 Jan 2022 - Aug 2022');
    assert.ok(!/@|98765|555|x\.io|linkedin/.test(t), t);
    assert.ok(/2019 - 2023/.test(t) && /Jan 2022 - Aug 2022/.test(t));
  });

  test('resume: parses schools, degrees, employers, titles, skills, city, name', () => {
    const p = R.parseResume(sample);
    assert.strictEqual(p.name, 'Saketh Jangala');
    assert.strictEqual(p.city, 'Chennai, Tamil Nadu');
    assert.ok(p.schools[0].startsWith('Indian Institute of Technology Madras'), p.schools.join('|'));
    assert.ok(p.degrees.some(d => /B\.?Tech/i.test(d)), p.degrees.join('|'));
    assert.ok(p.employers.includes('Globex Corporation') && p.employers.includes('Initech'), p.employers.join('|'));
    assert.ok(p.titles.some(t => /Intern/.test(t)) && p.titles.some(t => /Marketing Analyst/.test(t)), p.titles.join('|'));
    ['Python', 'JavaScript', 'SQL', 'Docker', 'Tableau', 'Excel', 'React', 'PostgreSQL'].forEach(s => assert.ok(p.skills.includes(s), s + ' in ' + p.skills.join(',')));
    assert.ok(!/@|98765/.test(p.redactedText));
  });

  test('resume: no sections / garbage / empty never throw', () => {
    ['', 'hello', '\u0000\u0001\n\n', 'x'.repeat(100000), 'EDUCATION\nEXPERIENCE\nSKILLS\n'].forEach(t => {
      const p = R.parseResume(t);
      assert.ok(Array.isArray(p.schools) && Array.isArray(p.skills));
    });
    assert.strictEqual(R.parseResume('').schools.length, 0);
  });

  test('resume: Spanish headings and non-ASCII names', () => {
    const p = R.parseResume('María García\nMadrid, España\n\nEDUCACIÓN\nUniversidad Politécnica de Madrid\nIngeniería Informática 2017 - 2021\n\nHABILIDADES\nPython, SQL');
    assert.strictEqual(p.name, 'María García');
    assert.ok(p.schools[0].includes('Universidad Politécnica de Madrid'), p.schools.join('|'));
    assert.deepStrictEqual(p.skills.slice(0, 2), ['Python', 'SQL']);
  });

  test('resume: itemsToLines splits on EOL and y-change', () => {
    const lines = R.itemsToLines([
      { str: 'Hello', transform: [1, 0, 0, 1, 0, 700] }, { str: ' world', transform: [1, 0, 0, 1, 40, 700], hasEOL: true },
      { str: 'Next', transform: [1, 0, 0, 1, 0, 680] }, { str: 'Line', transform: [1, 0, 0, 1, 0, 660] }
    ]);
    assert.deepStrictEqual(lines, ['Hello world', 'Next', 'Line']);
  });

  test('resume: real PDF → text → profile using the VENDORED pdf.js', async () => {
    const pdfjs = await loadPdfjs();
    const buf = fs.readFileSync(path.join(__dirname, 'fixtures/resume_sample.pdf'));
    const { text, pages } = await R.extractPdfText(buf, { pdfjs });
    assert.strictEqual(pages, 1);
    assert.ok(/EDUCATION/.test(text) && /Initech/.test(text));
    const p = R.parseResume(text);
    assert.ok(p.schools[0].includes('Indian Institute of Technology Madras'));
    assert.ok(p.skills.includes('Python'));
  });

  test('resume: corrupt / non-PDF bytes → friendly error, not a crash', async () => {
    const pdfjs = await loadPdfjs();
    let err;
    try { await R.extractPdfText(Buffer.from('this is not a pdf at all'), { pdfjs, timeoutMs: 5000 }); } catch (e) { err = e; }
    assert.ok(err, 'should throw');
    assert.ok(R.explainPdfError(err).length > 10);
  });

  test('resume: skills with brackets stay whole ("tool (a, b)"), parentheticals are dropped, and nothing is split inside them', () => {
    const p = R.parseResume('Jane Doe\nChennai, India\n\nSKILLS\nDocker, Git, AI-assisted development (Claude, Antigravity), Python (primary), SQL, LLM applications (Groq, Gemini API)\n\nEDUCATION\nIIT Madras\nB.Tech 2020 - 2024');
    const skills = JSON.parse(JSON.stringify(p.skills));
    assert.ok(skills.includes('Docker') && skills.includes('Python') && skills.includes('SQL'), skills.join('|'));
    assert.ok(skills.some(s => /^AI-assisted development$/.test(s)) || skills.some(s => /^LLM applications$/.test(s)), skills.join('|'));
    ['Antigravity)', 'Claude', 'development (Claude', 'Groq', 'Gemini API)', 'primary)'].forEach(bad => assert.ok(!skills.includes(bad), `fragment "${bad}" leaked: ${skills.join('|')}`));
    assert.ok(skills.every(s => !/[()]/.test(s)), skills.join('|'));
  });
};
