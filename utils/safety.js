'use strict';

// safety.js — treat profile text, pasted text and resume text as UNTRUSTED input.
//   sanitizeText / sanitizeProfileForPrompt : strip invisible + control characters, cap lengths, whitelist fields
//   detectInjection                          : flag text that tries to instruct an AI (we tell the user; we never obey it)
//   validateOutput                           : check a model's draft before the user ever sees it
// Defence in depth: this does not make injection impossible. It shrinks what reaches the model, the model is told the data is
// untrusted (see background.js system prompt), it has no tools, and a human reads every draft before anything is sent.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Safety = api;
})(typeof self !== 'undefined' ? self : this, function () {

  // control chars, zero-width, bidi overrides/isolates, and the Unicode "tag" block (used for invisible prompt-injection text)
  const INVISIBLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁠-⁤⁦-⁩﻿]|[\u{E0000}-\u{E007F}]/gu;

  const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

  function sanitizeText(s, max = 300) {
    return clip(String(s == null ? '' : s).replace(INVISIBLE, '').replace(/\s+/g, ' ').trim(), max);
  }

  const hadInvisible = (s) => { INVISIBLE.lastIndex = 0; return INVISIBLE.test(String(s || '')); };

  const INJECTION = [
    /ignore\s+(?:all\s+|any\s+|the\s+|your\s+)?(?:previous|prior|above|earlier|preceding)\s+(?:instructions?|prompts?|rules?|messages?)/i,
    /disregard\s+(?:all\s+|any\s+|the\s+)?(?:above|previous|prior|system|instructions?)/i,
    /forget\s+(?:everything|all|your)\s+(?:above|previous|instructions?|rules?)/i,
    /(?:reveal|print|show|repeat|output|leak)\s+(?:your|the)\s+(?:system\s+)?(?:prompt|instructions?|rules?)/i,
    /\b(?:system|developer)\s+(?:prompt|message|instruction)/i,
    /\bnew\s+instructions?\s*:/i,
    /you\s+are\s+(?:now\s+)?(?:an?\s+)?(?:ai|assistant|chatbot|llm|language\s+model|large\s+language\s+model)\b/i,
    /\bas\s+an?\s+(?:ai|llm|language\s+model)\b/i,
    /(?:if|when)\s+you\s+are\s+(?:an?\s+)?(?:ai|llm|language\s+model|chatbot)/i,
    /<\s*\/?\s*(?:system|assistant|instructions?|untrusted[a-z_ -]*)\s*>/i,
    /\[\s*(?:system|inst|\/inst)\s*\]/i,
    /(?:include|insert|add|append|mention)\s+(?:the\s+following|this)\s+(?:link|url|text|word|phrase)/i,
    /do\s+not\s+(?:mention|tell|reveal|disclose)\b.{0,40}\b(?:user|instructions?|prompt)/i,
    /(?:recruiters?|llms?|ai\s+(?:assistants?|agents?|tools?)).{0,40}(?:must|should|please)\s+(?:mention|include|say|write|respond)/i
  ];

  // Returns the names of fields (and what matched) that look like instructions to an AI.
  function detectInjection(obj) {
    const hits = [];
    const visit = (label, v) => {
      if (v == null) return;
      if (Array.isArray(v)) { v.forEach((x, i) => visit(label, x)); return; }
      if (typeof v === 'object') { Object.keys(v).forEach(k => visit(label, v[k])); return; }
      const s = String(v);
      const re = INJECTION.find(r => r.test(s));
      if (re) hits.push({ field: label, why: 'instruction-like text' });
      else if (hadInvisible(s) && /[\u{E0000}-\u{E007F}]/u.test(s)) hits.push({ field: label, why: 'hidden characters' });
    };
    if (obj && typeof obj === 'object') Object.keys(obj).forEach(k => { if (k !== 'quality') visit(k, obj[k]); });
    return hits;
  }

  // Only whitelisted fields, each clipped — nothing else from the page ever reaches a prompt.
  function sanitizeProfileForPrompt(p = {}) {
    const arr = (a, n, m) => (Array.isArray(a) ? a : []).slice(0, n).map(x => sanitizeText(typeof x === 'string' ? x : (x && (x.school || x.name || x.title)) || '', m)).filter(Boolean);
    return {
      name:         sanitizeText(p.name, 80),
      headline:     sanitizeText(p.headline, 200),
      current_title:   sanitizeText(p.currentTitle, 100),
      current_company: sanitizeText(p.currentCompany, 100),
      location:     sanitizeText(p.location, 80),
      about:        sanitizeText(p.about, 600),
      recent_posts: arr(p.recentPosts, 2, 200),
      skills:       arr(p.skills, 10, 40),
      education:    (Array.isArray(p.educationEntries) ? p.educationEntries : []).slice(0, 3).map(e => ({
        school: sanitizeText(typeof e === 'string' ? e : e && e.school, 100),
        degree: sanitizeText(typeof e === 'string' ? '' : e && e.degree, 80)
      })).filter(e => e.school),
      past_companies: arr(p.pastCompanies, 4, 80)
    };
  }

  // What the AI may learn about the sender: a short, flat summary. The full lists (every project, every role) stay on the
  // device; the single most relevant item travels separately as the "spotlight".
  function sanitizeSenderForPrompt(s) {
    if (!s) return null;
    const arr = (a, n, m) => (Array.isArray(a) ? a : []).slice(0, n).map(x => sanitizeText(x, m)).filter(Boolean);
    const out = { intro: sanitizeText(s.intro, 120), schools: arr(s.schools, 2, 100), employers: arr(s.employers, 3, 80), skills: arr(s.skills, 8, 40), city: sanitizeText(s.city, 60) };
    if (s.summary) out.summary = sanitizeText(s.summary, 200);
    const goal = sanitizeText(s.goal, 100);
    if (goal) out.goal = goal;
    return out;
  }

  // The one item chosen by spotlight.js. It came from the user's own profile, but it is still capped and screened.
  function sanitizeSpotlight(sp) {
    if (!sp || typeof sp !== 'object') return null;
    const text = sanitizeText(sp.text, 260);
    if (!text || looksInjected(text)) return null;
    return {
      type: sp.type === 'experience' ? 'experience' : 'project',
      title: sanitizeText(sp.title, 80),
      text,
      matches: (Array.isArray(sp.matches) ? sp.matches : []).slice(0, 4).map(m => sanitizeText(m, 40)).filter(m => m && !looksInjected(m))
    };
  }

  // ── Case clean-up: resumes often shout (JANGALA SAKETH) ──────────────────────
  const SMALL = new Set(['of', 'and', 'the', 'for', 'in', 'at', 'de', 'la', 'van', 'von', 'der', 'da', 'di', 'du', 'bin', 'al', 'el']);
  const lettersOf = (s) => String(s).replace(/[^\p{L}]/gu, '');
  const isShouty = (s) => { const l = lettersOf(s); return l.length >= 3 && l === l.toUpperCase() && l !== l.toLowerCase(); };
  const isLowerOnly = (s) => { const l = lettersOf(s); return l.length >= 3 && l === l.toLowerCase() && l !== l.toUpperCase(); };
  const titleWord = (w) => w.split(/([-'’.])/).map(p => (/^\p{L}/u.test(p) ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : p)).join('');

  // A person's name: ALL CAPS or all lower-case becomes Title Case; a name already in mixed case is left exactly as written.
  function normalizeName(name) {
    const t = sanitizeText(name, 80);
    if (!t || !(isShouty(t) || isLowerOnly(t))) return t;
    return t.split(/\s+/).map(titleWord).join(' ');
  }

  // A school / employer / job title: only fixed when the whole thing is shouting AND every real word is long enough that it
  // cannot be an acronym (so "VELLORE INSTITUTE OF TECHNOLOGY" is fixed but "IIT MADRAS" or "SRI CHAITANYA COLLEGE" are left alone).
  function normalizeLabel(label) {
    const t = sanitizeText(label, 160);
    const words = t.split(/\s+/);
    if (words.length < 2 || !isShouty(t)) return t;
    if (words.some(w => !SMALL.has(w.toLowerCase()) && lettersOf(w).length < 5)) return t;
    return words.map((w, i) => (i > 0 && SMALL.has(w.toLowerCase()) ? w.toLowerCase() : titleWord(w))).join(' ');
  }

  // ── Resume → structured sender profile (model output is untrusted too) ───────
  // Keeps line breaks (a resume is line-structured) but strips invisible characters and caps total size.
  function sanitizeMultiline(s, max = 12000) {
    const t = String(s == null ? '' : s).replace(INVISIBLE, '').replace(/\r/g, '').split('\n')
      .map(l => l.replace(/[ \t]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return clip(t, max);
  }

  const looksInjected = (s) => INJECTION.some(r => r.test(String(s || '')));
  const alnum = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

  // True when an item the model returned really appears in the resume (guards against invented schools/employers/skills).
  function groundedIn(item, text) {
    const hay = ' ' + alnum(text) + ' ';
    const needle = alnum(item);
    if (!needle) return false;
    if (hay.includes(' ' + needle + ' ')) return true;
    const words = needle.split(' ').filter(w => w.length >= 3);
    return words.length > 0 && words.every(w => hay.includes(' ' + w));
  }

  // raw = whatever JSON the model returned; sourceText = the resume text it was given. Returns a whitelisted, capped,
  // grounded profile in the same shape the Settings card edits. Instruction-like or contact-like strings are dropped.
  function sanitizeSenderProfile(raw, sourceText) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const clean = (v, n) => {
      const t = sanitizeText(typeof v === 'string' || typeof v === 'number' ? v : '', n);
      return t && !looksInjected(t) && !EMAIL_RE.test(t) ? t : '';
    };
    const list = (a, n, m, ground) => [...new Set((Array.isArray(a) ? a : []).map(x => clean(x, m)).filter(Boolean)
      .filter(x => !ground || !sourceText || groundedIn(x, sourceText)))].slice(0, n);
    const objs = (a, n, shape, key, ground) => (Array.isArray(a) ? a : []).slice(0, n * 2).map(o => {
      const out = {};
      Object.keys(shape).forEach(k => { out[k] = clean(o && o[k], shape[k]); });
      return out;
    }).filter(o => o[key] && (!ground || !sourceText || groundedIn(o[key], sourceText))).slice(0, n);

    const education  = objs(r.education, 4, { school: 100, degree: 80, field: 80, years: 24 }, 'school', true);
    const experience = objs(r.experience, 6, { title: 80, company: 80, years: 24, detail: 160 }, 'company', true)
      .map(e => ({ ...e }));
    const projects   = objs(r.projects, 4, { name: 80, summary: 160 }, 'name', true);
    const skills     = list(r.skills, 20, 40, true);

    const L = normalizeLabel;
    education.forEach(e => { e.school = L(e.school); });
    experience.forEach(e => { e.company = L(e.company); e.title = L(e.title); });
    projects.forEach(e => { e.name = L(e.name); });
    return {
      name: normalizeName(clean(r.name, 80)),
      intro: clean(r.intro, 120),
      summary: clean(r.summary, 300),
      city: clean(r.city, 60),
      education, experience, projects, skills,
      certifications: list(r.certifications, 6, 80, true),
      languages: list(r.languages, 6, 30, false),
      schools: [...new Set(education.map(e => e.school))].slice(0, 4),
      employers: [...new Set(experience.map(e => e.company))].slice(0, 6)
    };
  }

  // ── Output validation ───────────────────────────────────────────────────────
  const URL_RE   = /(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|io|net|org|ai|co|in|dev|app|me|ly|xyz)\b(?:\/\S*)?/i;
  const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
  const PHONE_RE = /(?<![\d/])(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{2,5}\)?[\s.-]?){2,4}\d{2,5}(?![\d/])/;
  const LEAK_RE  = /sk-ant-|x-api-key|untrusted[_ ]content|system prompt|as an ai\b|json schema|<\/?(?:system|assistant|instructions?)>/i;

  // allowed = strings the *user* supplied (their own intro/bio) — a link there is theirs to include
  function validateOutput(text, { maxChars = 500, allowedText = '' } = {}) {
    let t = String(text == null ? '' : text).replace(INVISIBLE, '').trim();
    t = t.replace(/^["“”]+|["“”]+$/g, '').trim();
    const problems = [];
    const allowed = String(allowedText).toLowerCase();
    const grab = (re) => { const m = t.match(re); return m && !allowed.includes(m[0].toLowerCase()) ? m[0] : null; };

    if (!t) problems.push('empty');
    if (t.length > maxChars) problems.push(`too long (${t.length}/${maxChars})`);
    if (grab(EMAIL_RE)) problems.push('contains an email address');
    if (grab(URL_RE))   problems.push('contains a link');
    if (grab(PHONE_RE) && /\d{8,}/.test(t.replace(/\D/g, ''))) problems.push('contains a phone number');
    if (LEAK_RE.test(t)) problems.push('mentions instructions or credentials');
    return { ok: problems.length === 0, text: t, problems };
  }

  return { sanitizeSpotlight, normalizeName, normalizeLabel, sanitizeText, sanitizeMultiline, sanitizeSenderProfile, groundedIn, sanitizeProfileForPrompt, sanitizeSenderForPrompt, detectInjection, validateOutput, hadInvisible, INVISIBLE };
});
