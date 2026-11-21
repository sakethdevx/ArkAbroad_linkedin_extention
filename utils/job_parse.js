'use strict';

// job_parse.js — turns what a job page shows (title, company, chips, description text) into one tidy job object. Pure: no DOM, no network.
//   JobParse.parse({ title, company, location, chips[], description, rawText }) → job
//   JobParse.fromPasted(text)                                                   → job (for a description the user pasted)
//   JobParse.sections(description) → [{ kind: 'required'|'nice'|'resp'|'skip'|'other', line }]   each line tagged by the heading above it
// The text comes from a web page, so it is DATA: it is only ever searched, never followed.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JobParse = api;
})(typeof self !== 'undefined' ? self : this, function () {

  const MAX_DESC = 15000;
  const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‏‪-‮⁠﻿]/g;
  const clean = (s) => String(s == null ? '' : s).replace(CONTROL, '').replace(/\r/g, '').replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const oneLine = (s, n) => clean(s).replace(/\s+/g, ' ').slice(0, n);

  const HEAD = {
    required: /^(?:minimum |basic |key |required |mandatory |preferred )?(?:requirements?|qualifications?|skills(?: required| (?:&|and) experience)?|what you(?:'|’)?ll need|what we(?:'|’)?re looking for|who you are|you have|must[- ]haves?|your profile|about you|eligibility|technical skills|education (?:&|and) experience)\s*:?$/i,
    nice: /^(?:nice[- ]to[- ]haves?|good[- ]to[- ]haves?|preferred(?: qualifications| skills| experience)?|bonus(?: points)?|desirable|plus(?:es)?|added advantage)\s*:?$/i,
    resp: /^(?:key )?(?:responsibilities|what you(?:'|’)?ll do|duties|about the role|the role|day[- ]to[- ]day|your role|job description|role overview|what you will do)\s*:?$/i,
    skip: /^(?:benefits|perks|about (?:us|the company|[A-Z][\w&. ]{1,30})|why join us|what we offer|how to apply|equal opportunity.*|compensation)\s*:?$/i
  };
  const NICE_LINE = /\b(?:nice to have|good to have|preferred|bonus|a plus|is a plus|plus point|desirable|added advantage|optional)\b/i;

  function sections(description) {
    const out = [];
    let mode = 'other';
    for (const raw of clean(description).split('\n')) {
      const line = raw.replace(/^[\s•·▪●◦\-*–—]+/, '').trim();
      if (!line) continue;
      if (line.length <= 60) {
        const head = line.replace(/[:\s]+$/, '');
        const k = Object.keys(HEAD).find(key => HEAD[key].test(head));
        if (k) { mode = k; continue; }
      }
      out.push({ kind: NICE_LINE.test(line) && mode !== 'skip' ? 'nice' : mode, line });
    }
    return out;
  }

  function daysAgo(text) {
    const m = String(text || '').match(/(\d+)\s*(second|minute|hour|day|week|month)s?\s+ago/i);
    if (!m) return /\b(?:just now|today)\b/i.test(text || '') ? 0 : null;
    const n = Number(m[1]);
    return { second: 0, minute: 0, hour: 0, day: n, week: n * 7, month: n * 30 }[m[2].toLowerCase()];
  }

  function parse(raw = {}) {
    const chips = (Array.isArray(raw.chips) ? raw.chips : []).map(c => oneLine(c, 80)).filter(Boolean).slice(0, 30);
    const meta = chips.join(' | ') + ' | ' + oneLine(raw.rawText || '', 600);
    const description = clean(raw.description).slice(0, MAX_DESC);
    const wp = meta.match(/\b(remote|hybrid|on[- ]?site|work from home|wfh)\b/i) || description.slice(0, 1500).match(/\b(remote|hybrid|on[- ]?site|work from home)\b/i);
    const et = meta.match(/\b(full[- ]time|part[- ]time|contract|internship|temporary|freelance|apprenticeship)\b/i);
    const sl = chips.join(' | ').match(/\b(internship|entry level|associate|mid-senior level|senior level|director|executive)\b/i);
    const ap = meta.match(/(?:over\s+)?(\d[\d,]*)\s*\+?\s*(?:applicants?|people clicked apply|applications?)/i);
    const workplace = wp ? (/on/i.test(wp[1]) ? 'on-site' : /remote|home|wfh/i.test(wp[1]) ? 'remote' : 'hybrid') : '';
    return {
      title: oneLine(raw.title, 140),
      company: oneLine(raw.company, 100),
      location: oneLine(raw.location, 120),
      workplace,
      employmentType: et ? et[1].toLowerCase().replace(/\s+/g, '-') : '',
      seniorityLabel: sl ? sl[1].toLowerCase() : '',
      postedDaysAgo: daysAgo(meta),
      applicants: ap ? Number(ap[1].replace(/,/g, '')) : null,
      description,
      url: oneLine(raw.url, 300)
    };
  }

  // pasted text: first short line is probably the title; everything is the description
  function fromPasted(text) {
    const t = clean(text).slice(0, MAX_DESC);
    const lines = t.split('\n');
    const first = (lines[0] || '').trim();
    const title = lines.length > 2 && first.length > 0 && first.length <= 100 && !/[.!?]$/.test(first) ? first : '';
    return parse({ title, description: t, rawText: t.slice(0, 600) });
  }

  return { parse, fromPasted, sections, daysAgo, clean, MAX_DESC };
});
