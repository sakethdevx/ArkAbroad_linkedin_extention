'use strict';

// overlap.js — "what do you two have in common?"  Pure functions, no DOM, no network.
// findOverlaps(sender, recipient) → ranked evidence the user can toggle and the drafter can use.
//   sender    = { schools[], employers[], skills[], city }            (from the user's edited résumé profile)
//   recipient = normalised scraped profile (educationEntries, currentCompany, pastCompanies, skills, headline…)
// Matching is conservative on purpose: a wrong "you both studied at…" is worse than none.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Overlap = api;
})(typeof self !== 'undefined' ? self : this, function () {

  // ── Normalisation (Unicode-aware; no English-only assumptions) ──────────────
  const norm = (s) => String(s == null ? '' : s)
    .normalize('NFKD').replace(/\p{M}+/gu, '')
    .toLowerCase().replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');

  const ORG_ALIASES = {
    iit: 'indian institute of technology', iiit: 'indian institute of information technology',
    nit: 'national institute of technology', iim: 'indian institute of management',
    bits: 'birla institute of technology and science', mit: 'massachusetts institute of technology',
    nus: 'national university of singapore', ntu: 'nanyang technological university',
    ucla: 'university of california los angeles', usc: 'university of southern california',
    nyu: 'new york university', cmu: 'carnegie mellon university', lse: 'london school of economics',
    ucl: 'university college london', eth: 'eth zurich'
  };
  const SCHOOL_GENERIC = new Set(['university', 'college', 'institute', 'institution', 'school', 'academy', 'of', 'the', 'and', 'in', 'at', 'for',
    'universidad', 'universite', 'universitat', 'universita', 'universidade', 'de', 'la', 'del', 'du', 'des', 'di', 'da', 'der', 'von']);
  const COMPANY_GENERIC = new Set(['inc', 'llc', 'ltd', 'limited', 'pvt', 'private', 'corp', 'corporation', 'co', 'company', 'gmbh', 'ag', 'plc', 'sa',
    'technologies', 'solutions', 'systems', 'labs', 'group', 'india', 'global', 'services', 'the']);

  function expandAlias(tokens) {
    const out = [];
    tokens.forEach((t, i) => { if (i === 0 && ORG_ALIASES[t]) out.push(...ORG_ALIASES[t].split(' ')); else out.push(t); });
    return out;
  }

  // An org name has two comparable forms: the full string and the part before the first comma
  // ("Indian Institute of Technology Madras, Chennai" → "…Madras").
  function orgVariants(name, generic, withAlias) {
    const forms = [name, String(name || '').split(',')[0]];
    const sets = [];
    for (const f of forms) {
      let toks = norm(f).split(' ').filter(Boolean);
      if (withAlias) toks = expandAlias(toks);
      toks = toks.filter(t => !generic.has(t));
      if (toks.length) sets.push(new Set(toks));
    }
    return sets;
  }

  const sameSet = (a, b) => a.size === b.size && [...a].every(x => b.has(x));
  const jaccard = (a, b) => { const i = [...a].filter(x => b.has(x)).length; return i / (a.size + b.size - i); };
  const subset = (a, b) => [...a].every(x => b.has(x));

  function schoolsMatch(a, b) {
    for (const x of orgVariants(a, SCHOOL_GENERIC, true)) for (const y of orgVariants(b, SCHOOL_GENERIC, true)) {
      if (sameSet(x, y)) return true;
      if (x.size >= 2 && y.size >= 2 && jaccard(x, y) >= 0.8) return true;
    }
    return false;
  }

  function companiesMatch(a, b) {
    for (const x of orgVariants(a, COMPANY_GENERIC, false)) for (const y of orgVariants(b, COMPANY_GENERIC, false)) {
      if (sameSet(x, y)) return true;
      const [s, l] = x.size <= y.size ? [x, y] : [y, x];
      if (subset(s, l) && [...s].join('').length >= 4) return true;   // "Amazon" ⊂ "Amazon Web Services"
    }
    return false;
  }

  // ── Skills ──────────────────────────────────────────────────────────────────
  const SKILL_ALIAS = {
    js: 'javascript', 'java script': 'javascript', ts: 'typescript', ml: 'machine learning', ai: 'artificial intelligence',
    nlp: 'natural language processing', 'node js': 'node', nodejs: 'node', 'react js': 'react', reactjs: 'react',
    postgres: 'postgresql', 'postgre sql': 'postgresql', 'ms excel': 'excel', 'microsoft excel': 'excel', powerbi: 'power bi',
    golang: 'go', 'amazon web services': 'aws', 'google cloud': 'gcp', 'google cloud platform': 'gcp', sklearn: 'scikit learn',
    'data viz': 'data visualization', ux: 'ui ux', 'ui ux': 'ui ux', 'k8s': 'kubernetes', 'tensor flow': 'tensorflow'
  };
  const skillKey = (s) => {
    const t = String(s || '').toLowerCase().trim();
    if (t === 'c++' || t === 'c#') return t;
    const n = norm(s);
    return SKILL_ALIAS[n] || n;
  };
  const NO_CORPUS_SCAN = new Set(['go', 'r', 'c', 'ai', 'ml', 'ui ux', 'excel']);

  function listJoin(items) {
    if (items.length <= 1) return items.join('');
    return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
  }

  // ── City ────────────────────────────────────────────────────────────────────
  const segs = (s) => String(s || '').split(',').map(norm).filter(Boolean);
  function citiesMatch(a, b) {
    const A = segs(a), B = segs(b);
    if (!A.length || !B.length) return false;
    const inner = (arr) => (arr.length > 1 ? arr.slice(0, -1) : arr);   // ignore the trailing country
    return inner(B).includes(A[0]) || inner(A).includes(B[0]);
  }

  // ── Main ────────────────────────────────────────────────────────────────────
  const schoolName = (e) => (typeof e === 'string' ? e : (e && (e.school || e.name || e.title)) || '');
  const shortest = (a, b) => ((String(a).split(',')[0].length <= String(b).split(',')[0].length) ? a : b);
  const head = (s) => String(s || '').split(',')[0].trim();

  function findOverlaps(sender, recipient) {
    const out = [];
    if (!sender || !recipient) return out;

    // Schools
    const rSchools = (recipient.educationEntries || []).map(schoolName).filter(Boolean);
    for (const mine of sender.schools || []) {
      const theirs = rSchools.find(r => schoolsMatch(mine, r));
      if (theirs) {
        const label = head(shortest(mine, theirs));
        out.push({ kind: 'school', id: 'school:' + norm(label), label, strength: 5,
          detail: `You both studied at ${label}`, line: `I noticed we both studied at ${label}.` });
        break;
      }
    }

    // Employers (current beats past)
    const rCurrent = recipient.currentCompany || '';
    const rPast = [...(recipient.pastCompanies || []), ...(recipient.experienceEntries || []).map(e => e && e.company)].filter(Boolean);
    const seenEmp = new Set();
    for (const mine of sender.employers || []) {
      const isCurrent = rCurrent && companiesMatch(mine, rCurrent);
      const past = !isCurrent && rPast.find(r => companiesMatch(mine, r));
      if (!isCurrent && !past) continue;
      const label = isCurrent ? rCurrent : past;
      const key = norm(label);
      if (seenEmp.has(key)) continue;
      seenEmp.add(key);
      out.push({ kind: 'employer', id: 'employer:' + key, label, strength: isCurrent ? 6 : 5,
        detail: isCurrent ? `They work at ${label}, where you've worked` : `You've both worked at ${label}`,
        line: isCurrent ? `I see you're at ${label}, where I've also worked.` : `I noticed we've both worked at ${label}.` });
    }

    // Skills
    const listed = new Set((recipient.skills || []).map(skillKey).filter(Boolean));
    const corpus = ' ' + norm([recipient.headline, recipient.about, recipient.currentTitle,
      ...(recipient.experienceEntries || []).map(e => e && e.title)].filter(Boolean).join(' ')) + ' ';
    const hits = [];
    const seenSkill = new Set();
    for (const s of sender.skills || []) {
      const k = skillKey(s);
      if (!k || seenSkill.has(k)) continue;
      seenSkill.add(k);
      const inList = listed.has(k);
      const inText = !inList && !NO_CORPUS_SCAN.has(k) && k.length >= 3 && corpus.includes(' ' + k + ' ');
      if (inList || inText) hits.push({ s, k, inList });
    }
    if (hits.length) {
      hits.sort((a, b) => Number(b.inList) - Number(a.inList));
      const top = hits.slice(0, 3);
      const label = listJoin(top.map(h => h.s));
      out.push({ kind: 'skills', id: 'skills:' + top.map(h => h.k).join(','), label, strength: 2 + Math.min(top.length, 3) * 0.4,
        detail: `You both work with ${label}`, line: `I noticed we both work with ${label}.` });
    }

    // City
    if (sender.city && recipient.location && citiesMatch(sender.city, recipient.location)) {
      const label = head(shortest(sender.city, recipient.location));
      out.push({ kind: 'city', id: 'city:' + norm(label), label, strength: 2,
        detail: `You're both in ${label}`, line: `I noticed we're both based in ${label}.` });
    }

    return out.sort((a, b) => b.strength - a.strength);
  }

  // Compact, contact-free summary of the sender for prompts.
  function senderSummary(sender) {
    if (!sender) return null;
    const pick = (a, n) => (Array.isArray(a) ? a.slice(0, n) : []);
    return { intro: sender.intro || '', schools: pick(sender.schools, 2), employers: pick(sender.employers, 3), skills: pick(sender.skills, 8), city: sender.city || '' };
  }

  return { findOverlaps, senderSummary, norm, skillKey, schoolsMatch, companiesMatch, citiesMatch };
});
