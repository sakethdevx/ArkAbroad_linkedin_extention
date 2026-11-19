'use strict';

// resume.js — resume text → structured "sender profile". Runs entirely on the device.
//   • extractPdfText(): pdf.js (vendored in lib/) with page / time / size caps (PDFs are untrusted input)
//   • parseResume():    pure heuristics → { name, city, schools, degrees, employers, titles, skills, … }
//   • redactContact():  drops emails / phones / URLs before anything is stored
// The parsed result is only a *suggestion*: the user edits it in Settings and that edited copy is what's used.

(function (root, factory) {
  const PP = (typeof module === 'object' && module.exports) ? require('./profile_parse.js') : root.ProfileParse;
  const api = factory(PP);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Resume = api;
})(typeof self !== 'undefined' ? self : this, function (PP) {

  const MAX_CHARS = 30000;

  // ── Privacy: strip contact details before storing / sending anything ────────
  function redactContact(text) {
    return String(text || '')
      .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '')
      .replace(/(?:https?:\/\/|www\.)\S+/gi, '')
      .replace(/\b(?:linkedin|github|gitlab|behance|dribbble|medium)\.com\/\S*/gi, '')
      // phone numbers: digit blocks separated by single spaces/dots/dashes; year ranges ("2019 - 2023") never match
      .replace(/(?<![\d/])(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{2,5}\)?[\s.-]?){1,4}\d{2,5}(?![\d/])/g, (m) => {
        const digits = m.replace(/\D/g, '').length;
        return digits >= 8 && !/^(?:19|20)\d{2}\D+(?:19|20)\d{2}$/.test(m.trim()) ? '' : m;
      })
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .slice(0, MAX_CHARS);
  }

  // ── Vocabulary ──────────────────────────────────────────────────────────────
  const SKILL_VOCAB = [
    'Python', 'Java', 'JavaScript', 'TypeScript', 'C++', 'C#', 'C', 'Go', 'Rust', 'Kotlin', 'Swift', 'PHP', 'Ruby', 'R', 'MATLAB', 'Scala',
    'SQL', 'MySQL', 'PostgreSQL', 'MongoDB', 'Redis', 'Firebase', 'NoSQL', 'Snowflake', 'BigQuery',
    'React', 'Next.js', 'Angular', 'Vue', 'Node.js', 'Express', 'Django', 'Flask', 'FastAPI', 'Spring', 'Flutter', 'Android', 'iOS',
    'HTML', 'CSS', 'Tailwind', 'REST', 'GraphQL',
    'AWS', 'Azure', 'GCP', 'Docker', 'Kubernetes', 'Git', 'Linux', 'CI/CD', 'Terraform', 'Jenkins',
    'Machine Learning', 'Deep Learning', 'NLP', 'Computer Vision', 'TensorFlow', 'PyTorch', 'scikit-learn', 'Pandas', 'NumPy', 'Spark', 'Hadoop',
    'Data Analysis', 'Data Science', 'Data Visualization', 'Statistics', 'A/B Testing', 'ETL',
    'Tableau', 'Power BI', 'Excel', 'Looker', 'Google Analytics',
    'Figma', 'Photoshop', 'Illustrator', 'Canva', 'UI/UX', 'User Research', 'Prototyping',
    'SEO', 'SEM', 'Content Marketing', 'Social Media', 'Copywriting', 'Email Marketing', 'Digital Marketing', 'Brand Strategy', 'Market Research',
    'Product Management', 'Agile', 'Scrum', 'Jira', 'Roadmapping',
    'Financial Modeling', 'Accounting', 'Valuation', 'Bloomberg', 'Salesforce', 'CRM',
    'Project Management', 'Operations', 'Supply Chain', 'Consulting', 'Public Speaking', 'Research', 'Teaching',
    'Embedded Systems', 'Arduino', 'CAD', 'SolidWorks', 'AutoCAD', 'IoT', 'VLSI', 'Verilog'
  ];
  const SKILL_CANON = new Map(SKILL_VOCAB.map(s => [s.toLowerCase(), s]));
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const SKILL_RE = SKILL_VOCAB
    .slice().sort((a, b) => b.length - a.length)
    .map(s => ({ s, re: new RegExp(`(?<![A-Za-z0-9+#.])${escRe(s)}(?![A-Za-z0-9+#])`, s.length <= 2 ? 'u' : 'iu') }));

  const HEADINGS = {
    education:  ['education', 'academics', 'academic background', 'educational qualifications', 'educación', 'formation', 'ausbildung', 'educação', 'formazione', '学歴'],
    experience: ['experience', 'work experience', 'professional experience', 'employment', 'employment history', 'work history', 'internships', 'internship experience', 'experiencia', 'expérience', 'berufserfahrung', 'experiência', 'esperienza', '職歴', '経歴'],
    skills:     ['skills', 'technical skills', 'key skills', 'core competencies', 'skills & tools', 'skills and tools', 'tools', 'technologies', 'competencias', 'habilidades', 'compétences', 'kenntnisse', 'competências', 'competenze', 'スキル'],
    projects:   ['projects', 'personal projects', 'academic projects', 'proyectos', 'projets', 'projekte'],
    summary:    ['summary', 'profile', 'objective', 'about me', 'professional summary', 'career objective', 'resumen', 'résumé', 'profil'],
    other:      ['certifications', 'certificates', 'awards', 'achievements', 'honors', 'activities', 'leadership', 'extracurricular', 'extracurriculars', 'publications', 'languages', 'interests', 'volunteering', 'volunteer experience', 'references', 'positions of responsibility']
  };
  const SCHOOL_RE = /\b(?:university|college|institute|school|academy|polytechnic|universidad|universit[éäe]t?|université|école|ecole|iit|iiit|nit|bits|iim|isb)\b/iu;
  const DEGREE_RE = /\b(?:b\.?\s?tech|b\.?\s?e\.?|b\.?\s?sc|bachelors?|m\.?\s?tech|m\.?\s?sc|masters?|mba|ph\.?\s?d|b\.?\s?com|bba|b\.?\s?a\.?|m\.?\s?a\.?|diploma)\b/iu;
  const ROLE_RE = /\b(?:engineer|developer|intern|internship|analyst|manager|designer|consultant|associate|assistant|scientist|researcher|lead|director|founder|co-founder|specialist|coordinator|executive|officer|architect|trainee|fellow|volunteer|sde|swe|head|president|captain|member)\b/iu;
  const DATE_STRIP = /(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+)?(?:19|20)\d{2}\s*(?:[-–—~]|to)\s*(?:(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+)?(?:19|20)\d{2}|present|current|now|ongoing)|(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+)?(?:19|20)\d{2}/giu;

  function headingOf(line) {
    const l = PP.clean(line).replace(/[:|\-–—•\s]+$/, '').toLowerCase();
    if (!l || l.length > 40) return null;
    for (const key of Object.keys(HEADINGS)) if (HEADINGS[key].includes(l)) return key;
    return null;
  }

  const stripBullet = (l) => PP.clean(l.replace(/^[\s•·▪●○◦*>\-–—]+\s*/, ''));
  const isBullet = (l) => /^\s*[•·▪●○◦*\-–—>]\s+/.test(l);
  const stripDates = (l) => PP.clean(l.replace(DATE_STRIP, ' ').replace(/\(\s*\)/g, ''));
  const splitPieces = (l) => l.split(/\s{2,}|\t|\s[|•·–—-]\s|\s+at\s+|\s@\s|,\s(?=[A-Z])/).map(s => PP.clean(s).replace(/^[,;:\-–—|]+|[,;:\-–—|]+$/g, '')).filter(Boolean);

  function uniq(arr, max) {
    const seen = new Set(); const out = [];
    for (const x of arr) { const k = x.toLowerCase(); if (!x || seen.has(k)) continue; seen.add(k); out.push(x); if (out.length >= max) break; }
    return out;
  }

  // ── Main parser ─────────────────────────────────────────────────────────────
  function parseResume(rawText) {
    const text = redactContact(rawText);
    const lines = text.split(/\r?\n/).map(l => l.replace(/[​-‍﻿]/g, '').replace(/[ \t]+/g, ' ').trim()).filter(Boolean).slice(0, 400);

    // sections
    const marks = [];
    lines.forEach((l, i) => { const k = headingOf(l); if (k) marks.push({ key: k, i }); });
    const sec = {};
    marks.forEach((m, idx) => {
      const body = lines.slice(m.i + 1, idx + 1 < marks.length ? marks[idx + 1].i : lines.length);
      sec[m.key] = (sec[m.key] || []).concat(body);
    });
    const headerEnd = marks.length ? marks[0].i : Math.min(lines.length, 6);
    const header = lines.slice(0, headerEnd);

    // name = first plausible short line of the header
    const name = header.find(l => l.length <= 50 && /\p{L}/u.test(l) && !/[@\d]/.test(l) && !headingOf(l) && l.split(' ').length <= 5) || '';

    // city = "City, Region" in the header (contact line often has "City, State | …")
    let city = '';
    for (const l of header) {
      for (const piece of l.split(/\s[|•·]\s|\s{2,}/)) {
        const p = PP.clean(piece);
        if (p !== name && /^[A-Z\p{Lu}][\p{L}.' -]+,\s*[A-Z\p{Lu}][\p{L}.' -]+(?:,\s*[A-Z\p{Lu}][\p{L}.' -]+)?$/u.test(p) && p.length <= 50 && !SCHOOL_RE.test(p)) { city = p; break; }
      }
      if (city) break;
    }

    // education
    const schools = []; const degrees = [];
    for (const raw of sec.education || []) {
      const l = stripBullet(raw);
      if (l.length > 120) continue;
      const pieces = splitPieces(stripDates(l));
      const school = pieces.find(p => SCHOOL_RE.test(p) && p.length <= 80);
      if (school) schools.push(school);
      if (DEGREE_RE.test(l)) {
        const deg = pieces.find(p => DEGREE_RE.test(p) && !SCHOOL_RE.test(p));
        if (deg) degrees.push(deg);
      }
    }
    // some resumes list the school with the dates in the header block instead of under "Education"
    if (!schools.length) for (const l of lines.slice(0, 40)) { if (SCHOOL_RE.test(l) && l.length <= 90) { schools.push(PP.clean(stripDates(l))); break; } }

    // experience
    const employers = []; const titles = [];
    const exp = sec.experience || [];
    exp.forEach((raw, i) => {
      if (isBullet(raw)) return;
      const l = PP.clean(raw);
      if (l.length > 110) return;
      const hasDate = new RegExp(DATE_STRIP.source, 'iu').test(l);
      const near = hasDate || [exp[i - 1], exp[i + 1]].some(x => x && new RegExp(DATE_STRIP.source, 'iu').test(x));
      if (!near) return;
      for (const piece of splitPieces(stripDates(l))) {
        if (piece.length < 2 || piece.length > 60) continue;
        if (ROLE_RE.test(piece)) titles.push(piece);
        else if (/^[A-Z\p{Lu}0-9]/u.test(piece) && !/^(?:present|current|remote|hybrid|onsite)$/i.test(piece) && !/^[A-Za-z .'-]+,\s*[A-Za-z .'-]+$/.test(piece) && piece.split(' ').length <= 6) employers.push(piece);
      }
    });

    // skills: section tokens first, then a vocabulary sweep over the whole text
    const skillTokens = [];
    for (const raw of sec.skills || []) {
      const l = stripBullet(raw).replace(/^[\p{L} &/]{2,25}:\s*/u, '');
      for (const t of l.split(/[,;|•·]/)) {
        const s = PP.clean(t);
        if (s.length >= 2 && s.length <= 30 && s.split(' ').length <= 3 && !/^\d+$/.test(s) && !/^(?:and|etc\.?|others?)$/i.test(s)) skillTokens.push(SKILL_CANON.get(s.toLowerCase()) || s);
      }
    }
    const vocabHits = SKILL_RE.filter(({ re }) => re.test(text)).map(x => x.s);

    return {
      name,
      city,
      schools:   uniq(schools, 3),
      degrees:   uniq(degrees, 2),
      employers: uniq(employers, 6),
      titles:    uniq(titles, 4),
      skills:    uniq([...skillTokens, ...vocabHits], 30),
      sectionsFound: [...new Set(marks.map(m => m.key))],
      redactedText: text
    };
  }

  // ── PDF → text (browser) ────────────────────────────────────────────────────
  function itemsToLines(items) {
    const lines = []; let cur = ''; let lastY = null;
    for (const it of items || []) {
      if (typeof it.str !== 'string') continue;
      const y = it.transform ? it.transform[5] : null;
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 3 && cur) { lines.push(cur); cur = ''; }
      cur += it.str;
      if (y !== null) lastY = y;
      if (it.hasEOL) { lines.push(cur); cur = ''; }
    }
    if (cur) lines.push(cur);
    return lines.map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  }

  async function loadPdfjs() {
    const lib = await import(chrome.runtime.getURL('lib/pdf.min.mjs'));
    lib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.mjs');
    return lib;
  }

  function withTimeout(promise, ms, onTimeout) {
    let t;
    const timer = new Promise((_, rej) => { t = setTimeout(() => { try { onTimeout && onTimeout(); } catch (_) {} rej(Object.assign(new Error('timeout'), { code: 'timeout' })); }, ms); });
    return Promise.race([promise, timer]).finally(() => clearTimeout(t));
  }

  function explainPdfError(err) {
    const n = (err && (err.name || err.code)) || '';
    if (/password/i.test(n)) return 'This PDF is password-protected. Remove the password and try again, or paste your resume text.';
    if (n === 'timeout') return 'That PDF took too long to read. Try a simpler export, or paste your resume text.';
    if (/invalid|missing|format/i.test(n)) return "That doesn't look like a valid PDF. Try exporting it again, or paste your resume text.";
    return "Couldn't read that PDF. You can paste your resume text instead.";
  }

  // data: ArrayBuffer | Uint8Array.  Treats the PDF as untrusted: page cap, time cap, image cap, no eval.
  async function extractPdfText(data, opts = {}) {
    const { pdfjs, maxPages = 5, timeoutMs = 20000 } = opts;
    const lib = pdfjs || await loadPdfjs();
    const task = lib.getDocument({ data: new Uint8Array(data), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, maxImageSize: 16 * 1024 * 1024 });
    const doc = await withTimeout(task.promise, timeoutMs, () => task.destroy && task.destroy());
    try {
      const pages = Math.min(doc.numPages, maxPages);
      const out = [];
      for (let p = 1; p <= pages; p++) {
        const page = await withTimeout(doc.getPage(p), timeoutMs);
        const tc = await withTimeout(page.getTextContent(), timeoutMs);
        out.push(...itemsToLines(tc.items));
      }
      return { text: out.join('\n').slice(0, MAX_CHARS), pages: doc.numPages, truncated: doc.numPages > maxPages };
    } finally {
      try { doc.destroy(); } catch (_) {}
    }
  }

  return { parseResume, redactContact, extractPdfText, itemsToLines, explainPdfError, SKILL_VOCAB, MAX_CHARS };
});
