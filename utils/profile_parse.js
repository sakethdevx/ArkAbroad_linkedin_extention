'use strict';

// profile_parse.js — pure, DOM-free parsing helpers.
// Used by the content script (scraped lines), the popup (pasted text) and node tests.
// Everything here must be defensive: bad/missing input returns empty values, never throws.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ProfileParse = api;
})(typeof self !== 'undefined' ? self : this, function () {

  // ── Patterns ────────────────────────────────────────────────────────────────
  // A "date line" is recognised by a 4-digit year in a range ("Jan 2021 - Present",
  // "2018 – 2022") — NOT by month substrings, which is what broke titles such as
  // "Marketing Manager" or "Junior Developer" in the base version.
  const MONTH   = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|ene|abr|ago|dic|janv|févr|avr|juil|déc|mär|mai|okt|dez)[a-zéûä]*\\.?';
  const YEAR    = '(?:19|20)\\d{2}';
  const PRESENT = '(?:present|current|currently|now|actualidad|actualmente|actuel|actuellement|aujourd.hui|heute|aktuell|atualmente|presente|oggi|現在|至今)';
  const SEP     = '(?:\\s*[-–—~〜]\\s*|\\s+(?:to|a|à|bis|al|até|au)\\s+)';

  const DATE_RANGE  = new RegExp(`(?<!\\d)${YEAR}(?!\\d).{0,12}?${SEP}(?:(?:${MONTH}\\s+)?${YEAR}(?!\\d)|${PRESENT})`, 'iu');
  const SINGLE_DATE = new RegExp(`^(?:${MONTH}\\s+)?${YEAR}(?!\\d)(?:\\s*[·•].*)?$`, 'iu');
  const PRESENT_RE  = new RegExp(PRESENT, 'iu');
  const YEAR_RE     = new RegExp(`(?<!\\d)${YEAR}(?!\\d)`, 'u');
  const DURATION_ONLY = /^(?:\d+\s*(?:yrs?|years?|mos?|months?|años?|meses|ans|mois|jahre?n?|monate?n?|anos|mesi|anni)\s*){1,2}$/iu;
  const EMP_TYPE = /^(?:full[- ]?time|part[- ]?time|self[- ]employed|freelance|contract|internship|apprenticeship|seasonal|temporary|volunteer|trainee|jornada completa|temps plein|vollzeit|teilzeit)$/iu;
  const NOISE = /^(?:show all|see all|show more|see more|see less|…\s*(?:see )?more|\.\.\.\s*(?:see )?more|skills?\s*:|compétences\s*:|habilidades\s*:|\d+\s+(?:more\s+)?(?:endorsements?|connections?|followers?)|endorsed by)/iu;

  const SECTION_ALIASES = {
    about:      ['about', 'acerca de', 'à propos', 'info', 'über', 'sobre', 'informazioni', 'over', '概要'],
    experience: ['experience', 'experiencia', 'expérience', 'berufserfahrung', 'erfahrung', 'experiência', 'esperienza', 'ervaring', '経歴'],
    education:  ['education', 'educación', 'formation', 'ausbildung', 'educação', 'formazione', 'opleiding', '学歴'],
    skills:     ['skills', 'aptitudes', 'compétences', 'kenntnisse', 'competências', 'competenze', 'vaardigheden', 'スキル'],
    activity:   ['activity', 'actividad', 'activité', 'aktivitäten', 'atividade', 'attività', 'activiteit', 'アクティビティ']
  };

  const SKILL_HEADINGS = /^(?:industry knowledge|tools?\s*&\s*technologies|interpersonal skills|other skills|languages?)$/i;

  // ── Small helpers ───────────────────────────────────────────────────────────
  const clean = (s) => String(s == null ? '' : s).replace(/[​-‍﻿]/g, '').replace(/\s+/g, ' ').trim();

  function cleanLines(arr) {
    const out = [];
    for (const raw of Array.isArray(arr) ? arr : []) {
      const l = clean(raw);
      if (l.length < 2 || /^[·•\s]+$/.test(l) || NOISE.test(l)) continue;
      if (out.length && out[out.length - 1] === l) continue; // LinkedIn repeats text in visually-hidden spans
      out.push(l);
    }
    return out;
  }

  const isDateLine     = (s) => !!s && s.length <= 100 && (DATE_RANGE.test(s) || SINGLE_DATE.test(s));
  const isYearish      = (s) => !!s && s.length <= 45 && YEAR_RE.test(s);
  const isDurationOnly = (s) => !!s && DURATION_ONLY.test(s);
  const isEmpType      = (s) => !!s && EMP_TYPE.test(s);
  const isPresent      = (s) => !!s && PRESENT_RE.test(s);
  const firstPart      = (s) => clean(String(s || '').split(/[·•]/)[0]);
  const looksLikeSentence = (s) => /[.!?]$/.test(s) || s.length > 70;
  // Only treat a line after the dates as a location when it really looks like one;
  // otherwise it is probably the next role's title.
  const looksLikeLocation = (s) => !!s && !isDateLine(s) && !isDurationOnly(s) && !looksLikeSentence(s) &&
    (/,/.test(s) || /\b(?:remote|hybrid|on-?site)\b/i.test(s));

  // ── One experience role from its text lines ─────────────────────────────────
  function parseRoleLines(rawLines) {
    const lines = cleanLines(rawLines);
    const k = lines.findIndex(isDateLine);
    let title = '', companyLine = '', dates = '', location = '', employmentType = '';

    if (k === -1) {
      title = lines[0] || '';
      companyLine = lines[1] && !isDurationOnly(lines[1]) ? lines[1] : '';
    } else {
      const before = lines.slice(0, k);
      employmentType = before.find(isEmpType) || '';
      const typed = before.filter(l => !isEmpType(l));
      if (typed.length >= 2) { title = typed[typed.length - 2]; companyLine = typed[typed.length - 1]; }
      else if (typed.length === 1) { title = typed[0]; }
      dates = lines[k];
      const next = lines[k + 1];
      if (looksLikeLocation(next)) location = next;
    }

    const parts = companyLine.split(/[·•]/).map(clean);
    if (!employmentType && parts[1]) employmentType = parts[1];
    return {
      title: clean(title),
      company: parts[0] || '',
      employmentType,
      dates,
      duration: dates,
      location,
      isCurrent: isPresent(dates)
    };
  }

  // ── Experience from DOM-derived blocks ──────────────────────────────────────
  // block = { lines: [...], children: [ {lines:[...]} ] }
  // A block with child roles is a "company group" (several roles at one employer):
  // its own first line is the company, each child is a role.
  function parseExperienceBlocks(blocks) {
    const out = [];
    for (const b of Array.isArray(blocks) ? blocks : []) {
      const kids = (b.children || []).filter(c => cleanLines(c.lines).some(isDateLine));
      if (kids.length) {
        const company = firstPart(cleanLines(b.lines)[0] || '');
        for (const kid of kids) {
          const r = parseRoleLines(kid.lines);
          if (company) r.company = company;
          if (r.title || r.company) out.push(r);
        }
      } else {
        const r = parseRoleLines(b.lines);
        if (r.title || r.company) out.push(r);
      }
    }
    return out;
  }

  // ── Experience from a flat list of lines (fallback + pasted text) ───────────
  function parseExperienceLines(rawLines) {
    const lines = cleanLines(rawLines);
    const blocks = [];
    let group = null;
    let consumed = 0;

    for (let k = 0; k < lines.length; k++) {
      if (!isDateLine(lines[k])) continue;

      let before = [];
      for (let j = k - 1; j >= consumed && before.length < 4; j--) {
        const l = lines[j];
        if (isDateLine(l) || (looksLikeSentence(l) && !isDurationOnly(l))) break;
        before.unshift(l);
      }

      // "Company" + "5 yrs 3 mos" right before the roles → start a company group
      const d = before.findIndex(isDurationOnly);
      if (d > 0) {
        group = { lines: [before[d - 1], before[d]], children: [] };
        blocks.push(group);
        before = before.slice(d + 1);
      }

      const typed = before.filter(l => !isEmpType(l));
      const next = lines[k + 1];
      const hasLoc = looksLikeLocation(next);
      const unit = { lines: before.concat([lines[k]], hasLoc ? [next] : []), children: [] };
      consumed = k + 1 + (hasLoc ? 1 : 0);

      if (group && typed.length === 1) group.children.push(unit);
      else { group = null; blocks.push(unit); }
    }
    return parseExperienceBlocks(blocks);
  }

  // ── Education ───────────────────────────────────────────────────────────────
  function eduFromLines(rawLines) {
    const lines = cleanLines(rawLines);
    if (!lines.length) return null;
    return {
      school: lines[0],
      degree: lines[1] && !isYearish(lines[1]) ? lines[1] : '',
      dates:  lines.find(isYearish) || ''
    };
  }

  function parseEducationBlocks(blocks) {
    return (Array.isArray(blocks) ? blocks : []).map(b => eduFromLines(b.lines)).filter(Boolean);
  }

  function parseEducationLines(rawLines) {
    const lines = cleanLines(rawLines).filter(l => l.length <= 100 && !/^(?:grade|activities|description|nota|note)\b/i.test(l));
    const out = [];
    let cur = [];
    let closed = false;
    for (const l of lines) {
      if (closed) { const e = eduFromLines(cur); if (e) out.push(e); cur = []; closed = false; }
      cur.push(l);
      if (isYearish(l)) closed = true;
    }
    const e = eduFromLines(cur);
    if (e) out.push(e);
    return out;
  }

  // ── Skills ──────────────────────────────────────────────────────────────────
  function parseSkills(rawLines) {
    const seen = new Set();
    const out = [];
    for (const l of cleanLines(rawLines)) {
      if (l.length < 2 || l.length > 50) continue;
      if (SKILL_HEADINGS.test(l) || /\d{4}|follower|connection|endorse|dialog|window|escape/i.test(l)) continue;
      if (/^skills$/i.test(l)) continue;
      const key = l.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(l);
      if (out.length >= 12) break;
    }
    return out;
  }

  // ── Headline helpers ────────────────────────────────────────────────────────
  // Only an explicit "<title> at/@ <company>" counts. Base version also treated
  // "Python | SQL | ML" as title=Python, company=SQL, which produced nonsense hooks.
  function titleCompanyFromHeadline(headline) {
    const segs = String(headline || '').split(/\s*[|•·]\s*/);
    for (const seg of segs) {
      const m = seg.match(/^(.+?)\s+(?:at|@|en|chez|bei|na)\s+(.+)$/iu);
      if (m) return { title: clean(m[1]), company: clean(m[2]) };
    }
    return null;
  }

  function nameFromPageTitle(title) {
    let t = clean(title).replace(/^\(\d+\)\s*/, '').replace(/\s*[|]\s*LinkedIn.*$/i, '');
    t = clean(t.split(/\s[-–—]\s/)[0]);
    return /^(?:linkedin|feed|home|messaging|notifications|jobs)$/i.test(t) ? '' : t;
  }

  function nameFromUrl(url) {
    const m = String(url || '').match(/linkedin\.com\/in\/([^/?#]+)/i);
    if (!m) return '';
    let slug = decodeURIComponent(m[1]).replace(/-[0-9a-f]{6,}$/i, '').replace(/-\d+$/, '');
    return slug.split('-').filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  // ── Build the normalised profile + quality report ───────────────────────────
  function buildProfile(parts = {}) {
    const experience = Array.isArray(parts.experience) ? parts.experience : [];
    const fromHeadline = titleCompanyFromHeadline(parts.headline);
    const explicitCurrent = experience.find(e => e.isCurrent);
    const cur = explicitCurrent || null;

    let currentTitle = '', currentCompany = '';
    if (cur) { currentTitle = cur.title; currentCompany = cur.company; }
    else if (fromHeadline) { currentTitle = fromHeadline.title; currentCompany = fromHeadline.company; }
    else if (experience[0]) { currentTitle = experience[0].title; currentCompany = experience[0].company; }

    const seen = new Set([currentCompany.toLowerCase()]);
    const pastCompanies = [];
    for (const e of experience) {
      const c = clean(e.company);
      if (!c || seen.has(c.toLowerCase())) continue;
      seen.add(c.toLowerCase());
      pastCompanies.push(c);
    }

    const profile = {
      name:              clean(parts.name),
      headline:          clean(parts.headline),
      currentTitle,
      currentCompany,
      location:          clean(parts.location),
      about:             clean(parts.about),
      recentPosts:       (parts.recentPosts || []).slice(0, 3),
      experienceEntries: experience.slice(0, 6),
      pastCompanies:     pastCompanies.slice(0, 4),
      educationEntries:  (parts.education || []).slice(0, 3),
      skills:            (parts.skills || []).slice(0, 10),
      profileUrl:        parts.profileUrl || '',
      source:            parts.source || 'page'
    };
    profile.quality = assessQuality(profile, { currentInferred: !cur && !fromHeadline && !!experience[0], extraWarnings: parts.warnings });
    return profile;
  }

  function assessQuality(p, opts = {}) {
    const checks = [
      ['name',       !!p.name],
      ['role',       !!(p.headline || p.currentTitle)],
      ['company',    !!p.currentCompany],
      ['about',      !!p.about],
      ['experience', (p.experienceEntries || []).length > 0],
      ['education',  (p.educationEntries || []).length > 0],
      ['skills',     (p.skills || []).length > 0]
    ];
    const found   = checks.filter(c => c[1]).map(c => c[0]);
    const missing = checks.filter(c => !c[1]).map(c => c[0]);
    const score   = found.length;

    let confidence = 'high';
    if (score === 0 || (!p.name && score <= 1)) confidence = 'none';
    else if (score <= 2) confidence = 'low';
    else if (score <= 4) confidence = 'medium';

    const warnings = [...(opts.extraWarnings || [])];
    if (opts.currentInferred) warnings.push("Couldn't tell which job is current, so the most recent entry was used.");
    if (confidence === 'none') warnings.push('Nothing readable was found on this page.');
    else if (!found.includes('experience') && !found.includes('about')) {
      warnings.push('No experience or About text found; the profile may not have fully loaded or may be private.');
    }
    return { found, missing, confidence, warnings };
  }

  // ── Pasted text → profile ───────────────────────────────────────────────────
  function headingKey(line) {
    const l = clean(line).toLowerCase().replace(/[:\s]+$/, '');
    for (const key of Object.keys(SECTION_ALIASES)) if (SECTION_ALIASES[key].includes(l)) return key;
    return null;
  }

  const PASTE_NOISE = /^(?:skip to|home$|my network|jobs$|messaging|notifications|me$|for business|try premium|contact info|connect$|message$|follow$|more$|pending|open to|\d+(?:st|nd|rd|th)$|·|\d+\+?\s+(?:followers|connections)|\(\d+\))/i;

  function parseProfileText(text) {
    const lines = cleanLines(String(text || '').split(/\r?\n/)).slice(0, 800);
    const marks = [];
    lines.forEach((l, i) => {
      const key = headingKey(l);
      if (key && !marks.some(m => m.key === key)) marks.push({ key, i });
    });
    marks.sort((a, b) => a.i - b.i);
    const sections = {};
    marks.forEach((m, idx) => { sections[m.key] = lines.slice(m.i + 1, idx + 1 < marks.length ? marks[idx + 1].i : lines.length); });

    const top = lines.slice(0, marks.length ? marks[0].i : Math.min(lines.length, 14)).filter(l => !PASTE_NOISE.test(l));
    const name = top.find(l => l.length <= 60 && /\p{L}/u.test(l)) || '';
    const headline = top.find(l => l !== name && l.length > 3) || '';
    const location = top.find(l => l !== name && l !== headline && l.includes(',') && l.length < 60) || '';

    const aboutLines = (sections.about || []).filter(l => l.length > 40);
    const about = aboutLines.sort((a, b) => b.length - a.length)[0] || '';

    return buildProfile({
      name, headline, location, about,
      experience: parseExperienceLines(sections.experience || []),
      education:  parseEducationLines(sections.education || []),
      skills:     parseSkills(sections.skills || []),
      source: 'pasted'
    });
  }

  return {
    SECTION_ALIASES,
    clean, cleanLines,
    isDateLine, isDurationOnly, isEmpType, isPresent, isYearish,
    parseRoleLines, parseExperienceBlocks, parseExperienceLines,
    parseEducationBlocks, parseEducationLines, parseSkills,
    titleCompanyFromHeadline, nameFromPageTitle, nameFromUrl,
    buildProfile, assessQuality, parseProfileText, headingKey
  };
});
