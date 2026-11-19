'use strict';

// spotlight.js — "which ONE thing from your resume is most relevant to THIS person?"
// Pure functions, no DOM, no network. It can only SELECT an item that already exists in the user's own profile:
// it never writes new claims, and it returns null rather than a weak guess.
//   sender    = the user's profile ({ projects[], experience[], skills[], … }, edited by the user)
//   recipient = normalised scraped profile (headline, about, skills, currentTitle, experienceEntries, recentPosts)
//   → { type: 'project'|'experience', title, text, matches[], score } | null

(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./overlap.js') : root.Overlap);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Spotlight = api;
})(typeof self !== 'undefined' ? self : this, function (Overlap) {
  const { norm, skillKey } = Overlap;

  // Words that say nothing about a field of work (so "built a web app" never "matches" "building web apps").
  const STOP = new Set(('a an and are as at be been by for from has have in into is it its of on or our that the their this to was were with within using used use ' +
    'built build building develop developed developing create created creating made make design designed designing implement implemented ' +
    'project projects application applications app apps system systems tool tools platform service services feature features ' +
    'work worked working team teams role roles experience experienced intern interns internship engineer engineers developer developers ' +
    'senior junior lead manager software student years year new top best great strong real time helping help based across over per via ' +
    'i we you your my me us they them he she his her also more most very well like open source company companies').split(' '));

  const words = (s) => norm(s).split(' ').filter(w => w.length >= 4 && !STOP.has(w));
  const stem = (w) => w.replace(/(?:ing|ers|er|ies|es|s|ed|ion|ions)$/, '');
  const cap = (s, n) => { const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
  const arr = (a) => (Array.isArray(a) ? a : []);

  function recipientBag(r) {
    r = r || {};
    const pieces = [r.headline, r.about, r.currentTitle, ...arr(r.skills), ...arr(r.recentPosts), ...arr(r.experienceEntries).map(e => e && e.title)];
    const text = ' ' + norm(pieces.filter(Boolean).join(' . ')) + ' ';
    const stems = new Set(words(pieces.filter(Boolean).join(' ')).map(stem));
    const skillKeys = new Set(arr(r.skills).map(skillKey).filter(Boolean));
    return { text, stems, skillKeys };
  }

  // Which of the sender's known skills does an item mention, and does the recipient share that skill?
  function skillHits(itemText, senderSkills, bag) {
    const hay = ' ' + norm(itemText) + ' ';
    const hits = [];
    for (const s of senderSkills) {
      const key = skillKey(s);
      if (!key || key.length < 2) continue;
      const inItem = hay.includes(' ' + norm(s) + ' ') || hay.includes(' ' + key + ' ');
      const inRecipient = bag.skillKeys.has(key) || bag.text.includes(' ' + key + ' ') || bag.text.includes(' ' + norm(s) + ' ');
      if (inItem && inRecipient && !hits.some(h => skillKey(h) === key)) hits.push(s);
    }
    return hits;
  }

  function score(itemText, senderSkills, bag) {
    const skills = skillHits(itemText, senderSkills, bag);
    const skillSet = new Set(skills.map(s => norm(s)));
    const seen = new Set();
    const tokens = [];
    for (const w of words(itemText)) {
      const st = stem(w);
      if (seen.has(st) || skillSet.has(w)) continue;
      seen.add(st);
      if (bag.stems.has(st)) tokens.push(w);
    }
    return { points: skills.length * 3 + tokens.length, matches: [...skills, ...tokens].slice(0, 4), distinct: skills.length + tokens.length };
  }

  const lcFirst = (s) => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
  const article = (w) => (/^[aeiou]/i.test(w) ? 'an' : 'a');

  // opts.excludeCompanies: employers already used as the hook (don't repeat the same fact twice)
  function spotlight(sender, recipient, opts = {}) {
    if (!sender || !recipient) return null;
    const bag = recipientBag(recipient);
    const skills = arr(sender.skills).map(s => cap(s, 40)).filter(Boolean);
    const skip = new Set(arr(opts.excludeCompanies).map(norm).filter(Boolean));
    const candidates = [];

    arr(sender.projects).forEach((p, i) => {
      const name = cap(p && p.name, 80), summary = cap(p && p.summary, 160);
      if (!name) return;
      candidates.push({ type: 'project', order: i, title: name, summary, itemText: `${name} ${summary}`,
        text: `I built ${name}${summary ? ', ' + lcFirst(summary).replace(/[.!?]+$/, '') : ''}.` });
    });
    arr(sender.experience).forEach((e, i) => {
      const title = cap(e && e.title, 80), company = cap(e && e.company, 80), detail = cap(e && e.detail, 160);
      if (!title && !company) return;
      if (company && skip.has(norm(company))) return;
      const role = title ? `${article(title)} ${title}` : 'an intern';
      candidates.push({ type: 'experience', order: 100 + i, title: title || company, summary: detail, itemText: `${title} ${detail}`,
        text: company ? `I worked as ${role} at ${company}.` : `I worked as ${role}.` });
    });

    let best = null;
    for (const c of candidates) {
      const s = score(c.itemText, skills, bag);
      if (!(s.points >= 3 || s.distinct >= 2)) continue;           // conservative: no weak links
      const rank = [s.points + (c.type === 'project' ? 1 : 0), 0, -c.order];   // a project is the better conversation starter, so it edges out an equal role
      if (!best || rank[0] > best.rank[0] || (rank[0] === best.rank[0] && (rank[1] > best.rank[1] || (rank[1] === best.rank[1] && rank[2] > best.rank[2])))) {
        best = { rank, out: { type: c.type, title: c.title, text: c.text, matches: s.matches, score: s.points } };
      }
    }
    return best ? best.out : null;
  }

  // Hints about the user's own profile for Job / Referral messages (the "best next move" about the other person lives in approach.js).
  function adviceFor(purpose, { spotlight: spot = null, sender = null } = {}) {
    const out = [];
    if ((purpose === 'Job' || purpose === 'Referral') && !(sender && String(sender.goal || '').trim())) {
      out.push('Suggestion: add what you are looking for in Settings → Your profile, so the ask can be specific.');
    }
    if ((purpose === 'Job' || purpose === 'Referral') && !spot && sender && (arr(sender.projects).length || arr(sender.experience).length)) {
      out.push('Suggestion: none of your projects clearly matches their work, so the draft will not name one. That is fine; it avoids a stretch.');
    }
    return out.slice(0, 2);
  }

  return { spotlight, adviceFor };
});
