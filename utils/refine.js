'use strict';

// refine.js — "tell me what to change": rewrite a draft from the user's own comment. Pure: no DOM, no network of its own.
// Used by the side panel, the on-page card and the follow-up coach, so they all behave the same.
//   Refine.parseIntent(comment, senderProfile) → { tone, shorter, purpose, mention, omit[], longer, applied[], unmatched, comment }
//   Refine.dataFor(requestData, intent, senderProfile) → the drafting request with the comment's choices applied
//   Refine.run(deps, args) → Promise<{ ok, text?, source?, applied?, message? }>
//
// Which engine rewrites it is the best one the user already switched on:  their AI (AI Mode) → Chrome's on-device AI
// (Free Mode + Free+) → free rule-based edits.  The free edits understand a fixed set of requests (shorter, warmer,
// more formal, ask for a referral / job, mention one of YOUR projects or skills, leave something out) and say so plainly
// when the wording is beyond them. A comment is the user's own words: it is never mixed into the instructions, and every
// rewrite still goes through the same output checks (no links, length, no invented facts) in the background worker.

(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./spotlight.js') : root.Spotlight);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Refine = api;
})(typeof self !== 'undefined' ? self : this, function (Spotlight) {

  const MAX_COMMENT = 300;
  const CONTROL = /[\u0000-\u001f\u007f​-‏‪-‮⁠﻿]/g;
  const cleanComment = (s) => String(s == null ? '' : s).replace(CONTROL, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_COMMENT);
  const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}+#]+/gu, ' ').trim();
  const arr = (a) => (Array.isArray(a) ? a : []);

  // the quick chips offered next to the comment box (each is just a comment the parser understands)
  const CHIPS = [
    { label: 'Shorter', comment: 'Make it shorter' },
    { label: 'Warmer', comment: 'Make it warmer and more casual' },
    { label: 'More formal', comment: 'Make it more formal' },
    { label: 'Mention a project', comment: 'Mention one of my projects' }
  ];
  // free mode only offers what its rules can really do; an AI engine can do more
  const SMART_CHIPS = [
    { label: 'Add a question', comment: 'End with one short, specific question' },
    { label: 'Less salesy', comment: 'Make it sound less salesy and more natural' }
  ];
  const chipsFor = (engine) => (engine === 'ai' || engine === 'ondevice' ? [...CHIPS, ...SMART_CHIPS] : CHIPS);

  const PURPOSE_WORDS = [
    [/\brefer(?:ral|rals|ring|red)?\b/, 'Referral'],
    [/\b(?:job|jobs|internship|internships|opening|openings|hiring|position|positions|vacanc\w+)\b/, 'Job'],
    [/\b(?:collaborat\w+|work together|team up)\b/, 'Collaboration'],
    [/\b(?:advice|coffee|networking|catch up|quick chat)\b/, 'Networking']
  ];
  const ASK_VERB = /\b(?:ask(?:ing)?|request(?:ing)?|switch to|change (?:it )?to|turn it into|make it (?:a|an)|about|for)\b/;
  const OMIT_KIND = { school: 'school', college: 'school', university: 'school', employer: 'employer', company: 'employer', skill: 'skills', skills: 'skills', city: 'city', location: 'city', post: 'post', posts: 'post' };

  function parseIntent(comment, sender) {
    const text = cleanComment(comment);
    const t = ' ' + text.toLowerCase() + ' ';
    const has = (re) => re.test(t);
    const intent = { comment: text, tone: null, shorter: false, longer: false, purpose: null, mention: null, omit: [], applied: [], unmatched: false };

    if (has(/\b(?:less|not so|not too|don'?t be so|stop being so)\s+(?:formal|stiff|professional)\b|\binformal\b|\bcasual\b|\brelaxed\b|\bfriendl(?:y|ier)\b|\bwarm(?:er|ly)?\b|\bchatty\b|\bless stiff\b/)) { intent.tone = 'Casual'; intent.applied.push('warmer'); }
    else if (has(/\b(?:formal|professional|polite|respectful)\b/)) { intent.tone = 'Formal'; intent.applied.push('more formal'); }

    if (has(/\b(?:shorter|shorten|short|brief(?:er)?|concise|trim|cut (?:it )?down|fewer words|tighten|less wordy|too long)\b/)) { intent.shorter = true; intent.applied.push('shorter'); }
    if (has(/\b(?:longer|lengthen|more detail|more details|elaborate|expand)\b/)) intent.longer = true;

    // what to leave out: "don't mention my school", "without the company", "drop the skills"
    const omitRe = /\b(?:don'?t|do not|without|remove|drop|skip|leave out|leave off|no|exclude)\s+(?:mention(?:ing)?\s+)?(?:the\s+|my\s+|their\s+|any\s+)?(school|college|university|employer|company|skills?|city|location|posts?)\b/g;
    let m;
    while ((m = omitRe.exec(t))) { const k = OMIT_KIND[m[1]]; if (k && !intent.omit.includes(k)) { intent.omit.push(k); intent.applied.push(`left out the ${m[1]}`); } }

    // a different ask: "ask for a referral", "ask about internships"
    for (const [re, purpose] of PURPOSE_WORDS) {
      const found = t.match(new RegExp('(?:' + ASK_VERB.source + ')\\s+(?:for\\s+|about\\s+)?(?:a\\s+|an\\s+|the\\s+|any\\s+)?(?:' + re.source + ')'));
      if (found) { intent.purpose = purpose; intent.applied.push(`ask for ${purpose === 'Job' ? 'a role' : purpose === 'Referral' ? 'a referral' : purpose === 'Collaboration' ? 'a collaboration' : 'a chat'}`); break; }
    }

    // "mention my CampusMap project" / "mention one of my projects": only ever the sender's OWN items
    if (has(/\b(?:mention|include|highlight|talk about|bring up|feature|show|add|use)\b/) && !intent.omit.length) {
      const items = [];
      arr(sender && sender.projects).forEach(p => p && p.name && items.push({ kind: 'project', name: p.name }));
      arr(sender && sender.experience).forEach(e => { if (e && e.title) items.push({ kind: 'role', name: e.title }); if (e && e.company) items.push({ kind: 'role', name: e.company }); });
      arr(sender && sender.skills).forEach(s => s && items.push({ kind: 'skill', name: s }));
      const hay = ' ' + norm(text) + ' ';
      const hit = items.filter(i => norm(i.name).length >= 2 && hay.includes(' ' + norm(i.name) + ' ')).sort((a, b) => norm(b.name).length - norm(a.name).length)[0];
      if (hit) { intent.mention = hit; intent.applied.push(`mentioned ${hit.name}`); }
      else if (has(/\b(?:project|projects|work|experience)\b/)) { intent.mention = { kind: 'project', name: '' }; intent.applied.push('mentioned one of your projects'); }
    }

    intent.unmatched = !intent.tone && !intent.shorter && !intent.purpose && !intent.mention && !intent.omit.length;
    return intent;
  }

  // the drafting request with the comment's choices applied (tone, ask, what to leave out, which of YOUR items to mention)
  function dataFor(data, intent, sender) {
    const d = { ...data };
    if (intent.tone) d.tone = intent.tone;
    if (intent.purpose) d.messageType = intent.purpose;
    if (intent.omit.length) {
      d.overlaps = arr(d.overlaps).filter(o => !intent.omit.includes(o.kind));
      if (intent.omit.includes('post')) d.profileData = { ...(d.profileData || {}), recentPosts: [] };
    }
    if (intent.mention && sender) {
      let sp = null;
      if (intent.mention.kind === 'skill') {
        const want = norm(intent.mention.name);
        const owner = [...arr(sender.projects).map(p => ({ title: p && p.name, text: `${p && p.name} ${p && p.summary}` })),
          ...arr(sender.experience).map(e => ({ title: e && (e.title || e.company), text: `${e && e.title} ${e && e.company} ${e && e.detail}` }))]
          .find(o => o.title && (' ' + norm(o.text) + ' ').includes(' ' + want + ' '));
        sp = owner ? Spotlight.named(sender, owner.title) : null;
      } else sp = Spotlight.named(sender, intent.mention.name);
      if (sp) d.spotlight = sp; else intent.applied = intent.applied.filter(a => !/^mentioned/.test(a));
    }
    return d;
  }

  const hasFreeEffect = (i) => !!(i.tone || i.shorter || i.purpose || i.mention || i.omit.length);

  const SHORTER_ONLY = 'In Free mode a follow-up can only be made shorter. Switch on AI or on-device AI for other changes.';
  const FREE_LIMIT = 'Free mode can’t follow that wording. Pick a quick option, or switch on AI or on-device AI for free-form changes.';

  // deps: { send(msg) → Promise<response>, OnDevice? { polish() } }
  // args: { comment, draft, data, senderProfile, ai (AI Mode with a key), onDevice (Free+ on and the model is reachable) }
  async function run(deps, args) {
    const comment = cleanComment(args.comment);
    if (!comment) return { ok: false, message: 'Write what you would like changed, or pick one of the quick options.' };
    const intent = parseIntent(comment, args.senderProfile);
    const data = dataFor(args.data, intent, args.senderProfile);
    const draft = String(args.draft || '');

    if (args.ai) {
      const r = await deps.send({ action: 'refineDraft', data, draft, comment, intent });
      if (r && r.success && r.text) return { ok: true, text: r.text, source: 'ai', applied: r.applied && r.applied.length ? r.applied : ['revised'] };
      return { ok: false, message: (r && (r.error || r.message)) || 'The AI did not answer this time. Your draft is unchanged.' };
    }

    if (args.onDevice && deps.OnDevice) {
      const built = await deps.send({ type: 'BUILD_REFINE_PROMPT', payload: { data, draft, comment } });
      if (built && built.success) {
        const raw = await deps.OnDevice.polish({ system: built.system, user: built.user, schema: built.schema }, { timeoutMs: 25000 });
        if (raw) {
          const fin = await deps.send({ type: 'FINISH_DRAFTS', payload: { data, raw, comment } });
          if (fin && fin.success && fin.polished && fin.variants && fin.variants[0] && fin.variants[0].source === 'ondevice') {
            return { ok: true, text: fin.variants[0].text, source: 'ondevice', applied: intent.applied.length ? intent.applied : ['revised'] };
          }
        }
      }
      if (intent.unmatched) return { ok: false, message: 'On-device AI could not make that change this time. Your draft is unchanged.' };   // then the rules below if the wording was understood
    }

    if (args.shorterOnly && (intent.tone || intent.purpose || intent.mention || intent.omit.length)) return { ok: false, message: SHORTER_ONLY };
    if (intent.unmatched) return { ok: false, message: intent.longer ? 'Free mode can’t make a draft longer. Pick “Add a question”, or switch on AI or on-device AI.' : FREE_LIMIT };
    const r = await deps.send({ action: 'refineDraft', data: { ...data, forceFree: true }, draft, comment, intent });
    if (r && r.success && r.text) return { ok: true, text: r.text, source: 'template', applied: r.applied && r.applied.length ? r.applied : intent.applied };
    return { ok: false, message: (r && (r.error || r.message)) || 'I could not make that change. Your draft is unchanged.' };
  }

  return { CHIPS, SMART_CHIPS, chipsFor, MAX_COMMENT, cleanComment, parseIntent, dataFor, hasFreeEffect, run, FREE_LIMIT, SHORTER_ONLY };
});
