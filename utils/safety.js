'use strict';

// safety.js — treat profile text, pasted text and résumé text as UNTRUSTED input.
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

  function sanitizeSenderForPrompt(s) {
    if (!s) return null;
    const arr = (a, n, m) => (Array.isArray(a) ? a : []).slice(0, n).map(x => sanitizeText(x, m)).filter(Boolean);
    return { intro: sanitizeText(s.intro, 120), schools: arr(s.schools, 2, 100), employers: arr(s.employers, 3, 80), skills: arr(s.skills, 8, 40), city: sanitizeText(s.city, 60) };
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

  return { sanitizeText, sanitizeProfileForPrompt, sanitizeSenderForPrompt, detectInjection, validateOutput, hadInvisible, INVISIBLE };
});
