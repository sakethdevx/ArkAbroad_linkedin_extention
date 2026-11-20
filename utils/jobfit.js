'use strict';

// jobfit.js — "is this job for me?", worked out on the device from the posting and the user's own profile. Pure: no DOM, no network, no model.
//   JobFit.analyze(job, me, { now }) → { hasProfile, level, eligibility[], skills, keyword, fit, tailor, watchouts[], meta }
//     job = JobParse.parse(...)    me = { senderProfile, resumeText }
//
// What the numbers mean (shown to the user, never hidden):
//   Keyword match  = share of the job's named skills (required ones count double, nice-to-haves half) that your resume text names.
//                    It is NOT an "ATS score": every ATS is different and nobody outside one can compute it.
//   Level fit      = years of experience / seniority the posting asks for, against your stage (student, fresher, N years of work).
//   Fit (band)     = skills 55% + level 30% + education & eligibility 15%, then capped when something likely rules you out.
// Eligibility rows are "the posting says X": a quote plus ok / check / likely blocker. They never promise an outcome.
// The posting is untrusted text: it is searched with fixed patterns only, so text aimed at an AI cannot change a result.

(function (root, factory) {
  const api = factory(
    typeof module === 'object' && module.exports ? require('./skills.js') : root.Skills,
    typeof module === 'object' && module.exports ? require('./job_parse.js') : root.JobParse,
    typeof module === 'object' && module.exports ? require('./spotlight.js') : root.Spotlight);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JobFit = api;
})(typeof self !== 'undefined' ? self : this, function (Skills, JobParse, Spotlight) {

  const arr = (a) => (Array.isArray(a) ? a : []);
  const str = (s) => String(s == null ? '' : s);
  const flat = (s) => str(s).replace(/\s+/g, ' ').trim();
  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

  // the sentence a match sits in, so the user can see WHERE the posting says it
  function quoteAround(text, index, len) {
    const t = str(text);
    let a = index; while (a > 0 && !/[.!?\n]/.test(t[a - 1]) && index - a < 140) a--;
    let b = index + len; while (b < t.length && !/[.!?\n]/.test(t[b]) && b - index < 160) b++;
    return flat(t.slice(a, b + 1)).slice(0, 200);
  }
  function firstMatch(text, re) { const m = re.exec(str(text)); return m ? { m, quote: quoteAround(text, m.index, m[0].length) } : null; }

  // ── the user: stage, work years, graduation year, degree, city, CGPA ─────────
  function toYear(s, end, now) {   // "Jun 2024" / "2024" / "Present" → decimal year
    const t = str(s).trim().toLowerCase();
    if (/present|current|now|ongoing|today|till date/.test(t)) return now.getFullYear() + now.getMonth() / 12;
    const y = t.match(/(19|20)\d{2}/); if (!y) return null;
    const mo = Object.keys(MONTHS).find(k => t.includes(k));
    return Number(y[0]) + (mo ? MONTHS[mo] / 12 : end ? 0.9 : 0);
  }
  function rangeOf(years, now) {
    const parts = str(years).split(/\s*(?:–|—|-|to)\s*/i);
    const start = toYear(parts[0], false, now);
    const end = parts.length > 1 ? toYear(parts[1], true, now) : null;
    if (start == null) return null;
    return { start, end: end == null ? start + 0.5 : end };
  }
  const NOT_WORK = /\b(intern|internship|trainee|apprentice|volunteer|student|fellow|ambassador|member|club|society)\b/i;

  function userStage(me, now) {
    const sp = (me && me.senderProfile) || null;
    const resume = str(me && me.resumeText);
    if (!sp && !resume) return { stage: 'unknown', workYears: 0, gradYear: null, degreeLevel: null, city: '', cgpa: null };
    const edu = arr(sp && sp.education).filter(e => e && typeof e === 'object');
    const nowY = now.getFullYear();
    let gradYear = null, degreeLevel = null;
    for (const e of edu) {
      const r = rangeOf(e && e.years, now);
      const end = r ? Math.floor(r.end) : null;
      const lvl = levelOfDegree(`${e && e.degree} ${e && e.field}`);
      if (end && (gradYear === null || end > gradYear)) { gradYear = end; degreeLevel = lvl || degreeLevel; }
      else if (!degreeLevel && lvl) degreeLevel = lvl;
    }
    const worked = arr(sp && sp.experience).filter(e => e && !NOT_WORK.test(str(e.title))).map(e => rangeOf(e.years, now)).filter(Boolean);
    const workYears = Math.round(worked.reduce((n, r) => n + Math.max(0, r.end - r.start), 0) * 10) / 10;
    const text = `${sp && sp.intro} ${sp && sp.summary} ${edu.map(e => `${e.degree} ${e.field}`).join(' ')}`;
    let stage;
    if (/\b(student|pursuing|undergrad(?:uate)?|final[- ]year|(?:1st|2nd|3rd|4th|first|second|third|fourth)[- ]year|currently studying|expected graduation)\b/i.test(text) || (gradYear && gradYear >= nowY && workYears < 1)) stage = 'student';
    else if (workYears < 1) stage = 'fresher';
    else stage = 'experienced';
    if (stage === 'student' && gradYear && gradYear < nowY && workYears >= 1) stage = 'experienced';
    const cg = resume.match(/(?:c\.?g\.?p\.?a|gpa)\s*[:\-]?\s*(\d{1,2}(?:\.\d{1,2})?)/i);
    return { stage, workYears, gradYear, degreeLevel, city: flat(sp && sp.city), cgpa: cg ? Number(cg[1]) : null };
  }
  function levelOfDegree(t) {
    t = str(t);
    if (/ph\.?\s?d|doctor/i.test(t)) return 'phd';
    if (/\bm\.?\s?tech\b|\bm\.?\s?sc\b|master|\bmba\b|\bmca\b|\bm\.?e\.?\b(?!\w)|\bm\.?s\.?\b(?!\w)/i.test(t)) return 'masters';
    if (/\bb\.?\s?tech\b|\bb\.?e\.?\b(?!\w)|bachelor|\bb\.?\s?sc\b|\bbca\b|\bb\.?\s?com\b|\bbba\b|\bb\.?a\.?\b(?!\w)|undergrad/i.test(t)) return 'bachelors';
    if (/diploma/i.test(t)) return 'diploma';
    return null;
  }
  const RANK = { diploma: 0, bachelors: 1, masters: 2, phd: 3 };

  // ── what the posting asks for ────────────────────────────────────────────────
  const SENIOR_TITLE = /\b(senior|sr\.?|lead|staff|principal|head of|director|vp|vice president|architect|chief)\b/i;
  const ENTRY_TITLE = /\b(junior|jr\.?|associate|graduate|trainee|intern|apprentice|entry|fresher|campus)\b/i;
  const ENTRY_WORDS = /\b(?:freshers?|entry[- ]level|new grads?|new graduates?|recent graduates?|fresh graduates?|campus hiring|no (?:prior |previous )?experience (?:is )?(?:required|needed|necessary)|0\s*(?:-|–|to)\s*[1-2]\s*(?:years?|yrs?)|internship|trainee)\b/i;

  function yearsAsked(text) {
    const t = str(text);
    const found = [];
    const add = (re, pick) => { let m; const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'); while ((m = g.exec(t))) { const ctx = t.slice(Math.max(0, m.index - 60), m.index + m[0].length + 60); if (!/\b(?:experience|exp\b|background|working|industry|professional|hands[- ]on|in the field|of work|as a|in a|in an)\b/i.test(ctx) && !/years?\s+of\s+(?:\w+\s+){0,3}(?:experience)/i.test(ctx)) continue; const v = pick(m); if (v) found.push({ ...v, quote: quoteAround(t, m.index, m[0].length) }); } };
    add(/(\d{1,2})\s*(?:\+|plus)?\s*(?:-|–|to)\s*(\d{1,2})\s*\+?\s*(?:years?|yrs?)/i, m => ({ min: +m[1], max: +m[2] }));
    add(/(?:minimum|min\.?|at least|atleast|over|more than)\s*(?:of\s*)?(\d{1,2})\s*\+?\s*(?:years?|yrs?)/i, m => ({ min: +m[1], max: null }));
    add(/(\d{1,2})\s*(?:\+|plus)\s*(?:years?|yrs?)/i, m => ({ min: +m[1], max: null }));
    add(/(?<![\d\-–+.])(\d{1,2})\s*(?:years?|yrs?)\s*(?:of\s+)?(?:relevant\s+|work\s+|industry\s+|professional\s+|hands[- ]on\s+)?(?:experience|exp)\b/i, m => ({ min: +m[1], max: +m[1] }));
    return found.filter(f => f.min <= 30);
  }

  function requirements(job) {
    const title = str(job.title), desc = str(job.description);
    const yrs = yearsAsked(desc);
    const top = yrs.slice().sort((a, b) => b.min - a.min)[0] || null;
    let entry = ENTRY_WORDS.test(`${title} ${desc}`) || ENTRY_TITLE.test(title) || /internship|entry level/.test(str(job.seniorityLabel)) || job.employmentType === 'internship';
    const seniorTitle = SENIOR_TITLE.test(title) || /director|executive/.test(str(job.seniorityLabel));
    const midLabel = /mid-senior|senior level/.test(str(job.seniorityLabel));
    if (top && top.min >= 2) entry = ENTRY_TITLE.test(title) && top.min <= 2 ? entry : false;   // an explicit "3+ years" beats a stray "internship" mention
    return { minYears: top ? top.min : null, maxYears: top ? top.max : null, yearsQuote: top ? top.quote : '', entry, seniorTitle, midLabel };
  }

  function levelFit(req, you) {
    const asks = req.minYears != null ? `${req.minYears}${req.maxYears && req.maxYears !== req.minYears ? '–' + req.maxYears : '+'} years of experience` : '';
    const out = (status, score, message) => ({ status, score, message, asks, quote: req.yearsQuote, stage: you.stage });
    if (you.stage === 'unknown') {
      if (asks) return out('unknown', 70, `This role asks for ${asks}. Add your resume in Settings to compare it with your level.`);
      return out('unknown', 70, req.entry ? 'This looks open to freshers. Add your resume in Settings to see your fit.' : 'Add your resume in Settings to compare your level with this role.');
    }
    if (you.stage === 'student' || you.stage === 'fresher') {
      const who = you.stage === 'student' ? 'you are a student' : 'you are a fresher';
      if (req.seniorTitle && !req.entry) return out('blocker', 10, `This is a senior role${asks ? ` (${asks})` : ''}; ${who}.`);
      if (req.minYears != null && req.minYears >= 3) return out('blocker', 15, `Asks for ${asks}; ${who}. Experience like this is unlikely to be waived.`);
      if (req.minYears === 2) return out('stretch', 40, `Asks for ${asks}; ${who}. Strong projects or internships can sometimes make up part of it.`);
      if (req.minYears === 1 && !req.entry) return out('stretch', 60, `Asks for ${asks}; ${who}. Internships may count; read the posting closely.`);
      if (req.midLabel && req.minYears == null && !req.entry) return out('stretch', 45, `LinkedIn labels this mid-senior level; ${who}.`);
      if (req.entry || req.minYears === 0 || req.minYears === 1) return out('ok', 100, `This is open to ${you.stage === 'student' ? 'students and ' : ''}freshers.`);
      return out('ok', 85, 'The posting names no experience requirement.');
    }
    const w = you.workYears;
    if (req.minYears == null) return out('ok', req.entry && w >= 3 ? 80 : 90, req.entry && w >= 3 ? `This looks entry-level; you have about ${w} years of experience.` : 'The posting names no experience requirement.');
    if (w >= req.minYears) return out('ok', 100, `You have about ${w} years; the role asks for ${asks}.`);
    if (w >= req.minYears - 1) return out('stretch', 75, `You have about ${w} years; the role asks for ${asks}. Close enough to try.`);
    if (w >= req.minYears - 2) return out('stretch', 50, `You have about ${w} years; the role asks for ${asks}.`);
    return out('blocker', 25, `You have about ${w} years; the role asks for ${asks}.`);
  }

  // ── eligibility rows ─────────────────────────────────────────────────────────
  function eligibility(job, you, lvl) {
    const t = str(job.description), title = str(job.title);
    const rows = [];
    const push = (id, status, label, quote) => rows.push({ id, status, label, quote: quote || '' });

    // experience / seniority
    if (lvl.asks || lvl.status !== 'unknown' || lvl.message) {
      const st = lvl.status === 'blocker' ? 'blocker' : lvl.status === 'stretch' ? 'check' : lvl.status === 'ok' ? 'ok' : 'info';
      push('experience', st, lvl.message, lvl.quote);
    }

    // graduation year / batch
    const g = firstMatch(t, /(?:(?:batch|class)\s+of\s+((?:20\d{2})(?:\s*(?:,|\/|&|and|or|-|–|to)\s*20\d{2})*))|((?:20\d{2})(?:\s*(?:,|\/|&|and|or|-|–|to)\s*20\d{2})*)\s*(?:batch|pass[- ]?outs?|graduates?|graduating|grads?)|(?:graduat\w+|pass(?:ing)?[- ]?out|year of passing|passing year)[^.\n]{0,40}?((?:20\d{2})(?:\s*(?:,|\/|&|and|or|-|–|to)\s*20\d{2})*)/i);
    if (g) {
      const years = (g.m[1] || g.m[2] || g.m[3] || '').match(/20\d{2}/g).map(Number);
      const lo = Math.min(...years), hi = Math.max(...years);
      const range = /-|–|to/.test(g.m[1] || g.m[2] || g.m[3] || '') && years.length === 2;
      const allowed = range ? (y) => y >= lo && y <= hi : (y) => years.includes(y);
      const label = years.length > 1 ? `${lo}${range ? '–' : ' / '}${hi} graduates` : `${lo} graduates`;
      if (you.gradYear) push('graduation', allowed(you.gradYear) ? 'ok' : 'blocker', allowed(you.gradYear) ? `Open to your batch (${you.gradYear}): the posting asks for ${label}.` : `Asks for ${label}; your resume says you graduate in ${you.gradYear}.`, g.quote);
      else push('graduation', 'check', `Asks for ${label}. Check that your graduation year fits.`, g.quote);
    }

    // degree
    const d = firstMatch(t, /\b(ph\.?\s?d|doctorate|master(?:'s|s)?(?: degree)?|m\.?\s?tech|m\.?\s?sc|mba|mca|bachelor(?:'s|s)?(?: degree)?|b\.?\s?tech|b\.?\s?e\.?|b\.?\s?sc|bca)\b[^.\n]{0,60}/i);
    if (d && /\b(degree|required|must|minimum|pursuing|qualification|education|bachelor|master|ph\.?d)\b/i.test(d.quote)) {
      const need = levelOfDegree(d.m[1]);
      if (need) {
        const label = { phd: 'a PhD', masters: 'a master’s degree', bachelors: 'a bachelor’s degree', diploma: 'a diploma' }[need];
        if (you.degreeLevel) push('degree', RANK[you.degreeLevel] >= RANK[need] ? 'ok' : 'blocker', RANK[you.degreeLevel] >= RANK[need] ? `Asks for ${label}; your education covers it.` : `Asks for ${label}; your resume shows ${you.degreeLevel === 'bachelors' ? 'a bachelor’s' : you.degreeLevel}.`, d.quote);
        else push('degree', 'check', `Mentions ${label}. Check you meet it.`, d.quote);
      }
    }

    // CGPA / percentage cut-off
    const c = firstMatch(t, /(?:(?:min(?:imum)?|at least|above|>=?)\s*(?:of\s*)?(?:cgpa|gpa|percentage|aggregate)?\s*(?:of\s*)?(\d{1,2}(?:\.\d{1,2})?)\s*(%|cgpa|gpa)?)|(?:(\d{1,2}(?:\.\d{1,2})?)\s*(%|cgpa|gpa)\s*(?:and above|or above|or more|\+|throughout|aggregate|minimum))/i);
    if (c && /\b(cgpa|gpa|percentage|aggregate|marks|academic|%)\b/i.test(c.quote)) {
      const val = Number(c.m[1] || c.m[3]);
      const pct = /%/.test(c.m[2] || c.m[4] || '') || val > 10;
      const label = pct ? `${val}%` : `${val} CGPA`;
      if (you.cgpa != null && !pct && you.cgpa <= 10) push('cgpa', you.cgpa >= val ? 'ok' : 'blocker', `Asks for ${label}; your resume shows ${you.cgpa}.`, c.quote);
      else push('cgpa', 'check', `Asks for a minimum of ${label}. Check yours.`, c.quote);
    }

    // location and work mode
    if (job.workplace === 'remote') push('location', 'ok', 'Remote: you can apply from anywhere the posting allows.', '');
    else if (job.location || job.workplace) {
      const jobCity = flat(str(job.location).split(',')[0]).toLowerCase();
      const mine = flat(str(you.city).split(',')[0]).toLowerCase();
      const where = `${job.workplace ? job.workplace.replace('-', '') === 'onsite' ? 'On-site' : 'Hybrid' : 'Based'} in ${flat(str(job.location).split(',')[0]) || 'an unstated city'}`;
      if (jobCity && mine && !jobCity.includes(mine) && !mine.includes(jobCity)) push('location', 'check', `${where}; you are in ${flat(str(you.city).split(',')[0])}. Relocation or commuting would be needed.`, '');
      else if (jobCity && mine) push('location', 'ok', `${where}: matches your city.`, '');
      else push('location', 'info', `${where}.`, '');
    }

    const add = (id, re, label, status = 'check') => { const m = firstMatch(t, re); if (m) push(id, status, label, m.quote); };
    add('notice', /\bnotice period\b[^.\n]{0,50}|\bimmediate joiners?\b|\b\d+\s*(?:days?|months?)\s+notice\b/i, 'Mentions a notice period: aimed at people who are already employed.', you.stage === 'student' || you.stage === 'fresher' ? 'check' : 'info');
    add('visa', /\b(?:work (?:authori[sz]ation|permit)|right to work|visa|sponsorship|citizens?(?:hip)?|green card|permanent resident|eligible to work)\b[^.\n]{0,60}/i, 'Mentions work authorization or citizenship. Check you are eligible.');
    add('clearance', /\bsecurity clearance\b[^.\n]{0,40}|\bbackground (?:check|verification)\b[^.\n]{0,20}/i, 'Mentions a security clearance or background check.');
    add('language', /\b(?:fluen(?:t|cy)|proficien(?:t|cy)|native)\s+(?:level\s+)?(?:in\s+)?(German|French|Japanese|Spanish|Mandarin|Chinese|Korean|Arabic|Portuguese|Italian|Hindi|Tamil|Telugu|Kannada|Marathi|Bengali)\b/i, 'Asks for a language besides English. Check you meet it.');
    add('relocation', /\brelocat\w+[^.\n]{0,50}/i, 'Mentions relocation.', 'info');
    add('shift', /\b(?:night shifts?|rotational shifts?|us shift|uk shift|weekend work|24\s*[x*\/]\s*7)\b/i, 'Mentions shift or weekend work.', 'info');
    add('bond', /\b(?:service (?:agreement|bond)|bond (?:period|of)|\d+\s*(?:months?|years?)\s*(?:of\s*)?(?:bond|commitment))\b[^.\n]{0,40}/i, 'Mentions a service bond or minimum commitment. Read the terms before applying.');
    return rows;
  }

  // ── skills ───────────────────────────────────────────────────────────────────
  const SOFT = new Set(['Communication', 'Problem Solving']);
  function jobSkills(job) {
    const secs = JobParse.sections(job.description);
    const map = new Map();
    const note = (text, kind) => Skills.find(text).forEach(({ skill, literal }) => {
      const cur = map.get(skill);
      if (!cur) map.set(skill, { skill, literal, kind });
      else if (kind === 'required') cur.kind = 'required';
    });
    note(job.title, 'required');
    secs.forEach(s => { if (s.kind !== 'skip') note(s.line, s.kind === 'nice' ? 'nice' : 'required'); });
    if (!secs.length) note(job.description, 'required');
    const list = [...map.values()].filter(x => !SOFT.has(x.skill));   // soft skills are not keywords to add to a resume
    if (list.some(x => x.skill === 'Spring Boot')) return list.filter(x => x.skill !== 'Spring');
    return list.slice(0, 40);
  }

  function skillsMatch(job, me) {
    const wanted = jobSkills(job);
    const sp = (me && me.senderProfile) || {};
    const resume = str(me && me.resumeText);
    const mineText = [resume, arr(sp.skills).join(', '), arr(sp.projects).map(p => `${p && p.name} ${p && p.summary}`).join(' '), arr(sp.experience).map(e => `${e && e.title} ${e && e.detail}`).join(' '), str(sp.summary)].join('\n');
    const mine = new Set([...Skills.find(mineText).map(x => x.skill), ...arr(sp.skills).map(Skills.canonical)]);
    const hasProfile = !!(resume.trim() || arr(sp.skills).length || arr(sp.projects).length || arr(sp.experience).length);
    const matched = [], missingRequired = [], missingNice = [], hints = [];
    for (const w of wanted) {
      if (mine.has(w.skill)) {
        matched.push(w);
        const lit = flat(w.literal).toLowerCase();
        if (lit && lit !== w.skill.toLowerCase() && !mineText.toLowerCase().includes(lit) && w.skill.length > 1) hints.push({ job: w.literal, you: w.skill });
      } else (w.kind === 'nice' ? missingNice : missingRequired).push(w);
    }
    const weight = (x) => (x.kind === 'nice' ? 0.5 : 1);
    const total = wanted.reduce((n, x) => n + weight(x), 0);
    const got = matched.reduce((n, x) => n + weight(x), 0);
    const pct = total && hasProfile ? Math.round(100 * got / total) : null;
    return { wanted, matched, missingRequired, missingNice, hints: hints.slice(0, 5), hasProfile, pct, count: wanted.length };
  }

  // ── watch-outs: the common scam / bad-posting signals students meet ──────────
  function watchouts(job) {
    const t = `${str(job.title)}\n${str(job.description)}`;
    const out = [];
    const add = (id, severity, text, re) => { const m = firstMatch(t, re); if (m) out.push({ id, severity, text, quote: m.quote.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[email]') }); };
    add('fee', 'high', 'Asks you to pay money (a fee or deposit). Real employers do not charge applicants.', /\b(?:registration|training|security|refundable|joining|application|processing|onboarding|kit|laptop)\s+(?:fee|deposit|charges?|amount)\b|\bpay\s+(?:a\s+|an\s+)?(?:fee|deposit|amount)\b|\bdeposit\s+(?:required|of)\b/i);
    add('chat-only', 'high', 'Contact is WhatsApp or Telegram only. Be careful: many fake offers work this way.', /\b(?:whatsapp|telegram|signal)\b[^.\n]{0,40}(?:\+?\d[\d\s-]{7,}|number|only|contact|apply|dm)|\bdm\s+(?:us|me)\s+(?:on|to apply)\b/i);
    add('earnings', 'high', 'Promises very high or guaranteed earnings. That is a common scam sign.', /\bearn\s+(?:up to\s+)?(?:₹|rs\.?|inr|\$)?\s*\d[\d,]*\s*k?\s*(?:per|\/|a)\s*(?:day|hour|week)\b|\bguaranteed\s+(?:income|salary|job|placement|returns?)\b|\b100\s*%\s*(?:placement|job)\s*guarantee\b|\bwork from home\b[^.\n]{0,30}\bearn\b/i);
    add('free-mail', 'medium', 'Applications go to a personal email address (such as Gmail). Check the company is real.', /\b[\w.+-]+@(?:gmail|yahoo|outlook|hotmail|rediffmail|proton(?:mail)?)\.[a-z.]+\b/i);
    add('pressure', 'low', 'Uses pressure wording ("limited seats", "act now").', /\blimited\s+(?:seats|slots|vacancies|positions)\b|\bact now\b|\bhurry\b|\burgent(?:ly)?\s+(?:hiring|requirement)\b/i);
    add('ai-text', 'low', 'The posting contains text aimed at an AI. It was ignored.', /\bignore\s+(?:all\s+|any\s+)?(?:your\s+|the\s+)?(?:previous|prior|above)?\s*(?:instructions|rules)\b|\bsystem prompt\b|\byou are now\b/i);
    if (!flat(job.company) || /^confidential$/i.test(flat(job.company))) out.push({ id: 'company', severity: 'medium', text: 'No company name is shown. Find out who is hiring before you share anything.', quote: '' });
    return out;
  }

  // ── tailor: only ever points at things the user already has ──────────────────
  function tailor(job, me, sk) {
    const sp = me && me.senderProfile;
    let project = null;
    try {
      if (sp && Spotlight && (arr(sp.projects).length || arr(sp.experience).length)) {
        const target = { headline: job.title, currentTitle: job.title, about: str(job.description).slice(0, 1500), skills: sk.wanted.map(x => x.skill), recentPosts: [], experienceEntries: [] };
        const s = Spotlight.spotlight(sp, target, {});
        if (s) project = { title: s.title, matches: s.matches || [] };
      }
    } catch (_) { /* optional */ }
    const steps = [];
    if (project) steps.push(`Lead with “${project.title}”${project.matches.length ? ` (it touches ${project.matches.slice(0, 3).join(', ')})` : ''}: it is your most relevant work for this role.`);
    if (sk.hints.length) steps.push(`Use the job’s wording where it is true: ${sk.hints.map(h => `“${h.job}” (you wrote ${h.you})`).join(', ')}.`);
    if (sk.missingRequired.length) steps.push(`Required but not on your resume: ${sk.missingRequired.slice(0, 5).map(x => x.skill).join(', ')}. Add one only if you really have used it; otherwise say what you are learning.`);
    return { project, steps, reminder: 'Only add what is true. A keyword you cannot back up in an interview hurts more than it helps.' };
  }

  // ── the answer ───────────────────────────────────────────────────────────────
  function analyze(job, me, opts = {}) {
    const now = opts.now instanceof Date ? opts.now : new Date();
    job = job || {};
    const you = userStage(me, now);
    const req = requirements(job);
    const level = levelFit(req, you);
    const elig = eligibility(job, you, level);
    const sk = skillsMatch(job, me);
    const marks = watchouts(job);

    const blockers = elig.filter(r => r.status === 'blocker' && r.id !== 'experience');
    const eduScore = Math.max(0, 100 - 35 * blockers.length - 8 * elig.filter(r => r.status === 'check' && r.id !== 'experience').length);
    const skillScore = sk.pct == null ? 60 : sk.pct;
    const score = Math.round(0.55 * skillScore + 0.30 * level.score + 0.15 * eduScore);
    let band = score >= 75 ? 'Strong fit' : score >= 55 ? 'Worth applying' : score >= 35 ? 'Stretch' : 'Probably not a fit';
    const cap = (b) => { const order = ['Probably not a fit', 'Stretch', 'Worth applying', 'Strong fit']; if (order.indexOf(band) > order.indexOf(b)) band = b; };
    if (level.status === 'blocker') cap(level.score <= 15 ? 'Probably not a fit' : 'Stretch');
    else if (level.status === 'stretch') cap('Worth applying');
    if (blockers.length) cap('Stretch');
    if (you.stage === 'unknown') band = 'Add your resume to see your fit';
    const danger = marks.find(m => m.severity === 'high');
    if (danger) band = 'Be careful with this posting';

    let reason;
    if (danger) reason = danger.text;
    else if (you.stage === 'unknown') reason = level.message;
    else if (level.status === 'blocker') reason = level.message;
    else if (blockers.length) reason = blockers[0].label;
    else if (level.status === 'stretch') reason = level.message;
    else if (sk.missingRequired.length) reason = `Missing ${sk.missingRequired.slice(0, 3).map(x => x.skill).join(', ')} from the required skills.`;
    else if (sk.matched.length) reason = `Your resume covers ${sk.matched.slice(0, 3).map(x => x.skill).join(', ')}.`;
    else reason = 'The posting names few specific skills, so this is mostly about level and eligibility.';

    const insights = [];
    if (job.postedDaysAgo != null && job.postedDaysAgo <= 3) insights.push('Posted in the last few days: early applicants get noticed.');
    else if (job.postedDaysAgo != null && job.postedDaysAgo >= 30) insights.push('Posted a month or more ago: it may already be filled.');
    if (job.applicants != null) insights.push(job.applicants >= 100 ? `${job.applicants}+ applicants so far: stand out with a specific message.` : `About ${job.applicants} applicants so far.`);

    return {
      hasProfile: you.stage !== 'unknown', stage: you.stage, you,
      level, eligibility: elig, skills: sk,
      keyword: { pct: sk.pct, formula: 'Share of the skills this posting names (required count double, nice-to-have half) that your resume text also names. Not an ATS score.' },
      fit: { score, band, reason, parts: { skills: skillScore, level: level.score, education: eduScore } },
      tailor: tailor(job, me, sk), watchouts: marks, insights,
      meta: { title: flat(job.title), company: flat(job.company), postedDaysAgo: job.postedDaysAgo == null ? null : job.postedDaysAgo, applicants: job.applicants == null ? null : job.applicants }
    };
  }

  return { analyze, userStage, requirements, levelFit, eligibility, skillsMatch, watchouts, yearsAsked, levelOfDegree };
});
