'use strict';

// compose.js — the free, on-device message writer. Pure functions, no network.
//
// A good cold message (see CHANGELOG research notes) is short, opens with something specific to the
// reader, says who you are in one line, makes ONE small ask, and lets them say no easily.
// So we compose from slots instead of filling one fixed template:
//     greeting · hook (best shared background → their post → their role) · who I am · one ask · easy out · sign-off
// …then fit the result to the format's length budget by dropping the least valuable slot first.
//
// compose(ctx, {seed}) → { variants: [{ text, specific, hookKind }×3] }
// checklist(text, ctx) → live "reply-ready" checks (works on user-edited text too)

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Compose = api;
})(typeof self !== 'undefined' ? self : this, function () {

  // LinkedIn: connection-request notes are capped at 200 characters (LinkedIn Help). Messages have no
  // practical cap, but shorter wins, so we budget ~500 and aim for much less.
  const LIMITS = { note: 200, message: 500 };

  const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const pick = (arr, n) => arr[((n % arr.length) + arr.length) % arr.length];
  const stripEndPunct = (s) => clean(s).replace(/[.!?…]+$/, '');

  function wordClip(s, n) {
    s = clean(s);
    if (s.length <= n) return s;
    const cut = s.slice(0, n - 1);
    const sp = cut.lastIndexOf(' ');
    return (sp > n * 0.5 ? cut.slice(0, sp) : cut).replace(/[\s,;:.-]+$/, '') + '…';
  }

  function article(phrase) {
    const w = clean(phrase).split(' ')[0] || '';
    if (/^[A-Z]{2,4}$/.test(w)) return /^[AEFHILMNORSX]/.test(w) ? 'an' : 'a';   // MBA→an, PhD→a
    return /^[aeiou]/i.test(w) ? 'an' : 'a';
  }

  function listJoin(items) {
    return items.length <= 1 ? items.join('') : items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
  }

  // ── Tone ────────────────────────────────────────────────────────────────────
  const GREET   = { Formal: (n) => `Dear ${n},`, Neutral: (n) => `Hi ${n},`, Casual: (n) => `Hey ${n},` };
  const SIGNOFF = { Formal: 'Kind regards,', Neutral: 'Best,', Casual: 'Cheers,' };
  const OUT = {
    Formal:  ['I understand if your schedule is full.', 'Please feel free to ignore this if the timing is not right.'],
    Neutral: ["No worries if you're busy.", "Totally fine if now isn't a good time."],
    Casual:  ['No pressure at all!', "Totally fine if it's a no!"]
  };
  const EXPAND = [[/\bI['’]m\b/g, 'I am'], [/\bI['’]ve\b/g, 'I have'], [/\bI['’]d\b/g, 'I would'], [/\byou['’]re\b/gi, 'you are'],
    [/\bwe['’]re\b/gi, 'we are'], [/\bwe['’]ve\b/gi, 'we have'], [/\byou['’]ve\b/gi, 'you have'], [/\bdon['’]t\b/gi, 'do not'],
    [/\bisn['’]t\b/gi, 'is not'], [/\bit['’]s\b/gi, 'it is']];
  function tonalize(text, tone) {
    if (tone !== 'Formal') return text;
    return EXPAND.reduce((t, [re, to]) => t.replace(re, (m) => (m[0] === m[0].toUpperCase() ? to[0].toUpperCase() + to.slice(1) : to)), text);
  }

  // ── Hook phrases ────────────────────────────────────────────────────────────
  // Each overlap gets a few phrasings (long, and a short form for the 200-char note).
  function overlapHooks(o) {
    const L = stripEndPunct(o.label);
    switch (o.kind) {
      case 'school':   return { long: [`I noticed we both went to ${L}.`, `Saw you went to ${L}, same as me.`, `Fellow ${L} person here, so I had to say hi.`], short: [`I noticed we both went to ${L}.`, `Fellow ${L} person here.`] };
      case 'employer': return o.detail.startsWith('They work')
        ? { long: [`I see you're at ${L}, where I've also worked.`, `Saw you're at ${L}. I spent some time there too.`], short: [`I see you're at ${L}, where I've also worked.`, `Saw you're at ${L}; I've worked there too.`] }
        : { long: [`I noticed we've both worked at ${L}.`, `Saw ${L} on your profile. I've worked there too.`], short: [`We've both worked at ${L}.`, `I've worked at ${L} too.`] };
      case 'skills':   return { long: [`I noticed we both work with ${L}.`, `Saw you work with ${L}, same here.`, `We seem to have ${L} in common.`], short: [`We both work with ${L}.`, `Saw you work with ${L}, same here.`] };
      case 'city':     return { long: [`I noticed we're both based in ${L}.`, `Saw you're in ${L} too.`], short: [`We're both based in ${L}.`, `Saw you're in ${L} too.`] };
      default:         return { long: [o.line || ''], short: [o.line || ''] };
    }
  }

  function postHook(p, n, short) {
    const post = (p.recentPosts || []).find(x => typeof x === 'string' && x.trim() && (x.match(/\s\|\s/g) || []).length < 2);
    if (!post) return null;
    const snip = wordClip(post, short ? 40 : 60);
    const dot = /[….!?]$/.test(snip) ? '' : '.';   // no "…”." pile-up when the quote was truncated
    return { text: pick([`I enjoyed your recent post: “${snip}”${dot}`, `Your recent post “${snip}” caught my eye.`], n), kind: 'post' };
  }

  // Titles/companies are spliced into a sentence, so they must look like short labels. If the scrape ever hands us a
  // paragraph (descriptions, posts), skip the role line rather than quote it back at the reader.
  const ABBREV = /^(?:dr|mr|mrs|ms|prof|sr|jr|st|mt|inc|ltd|llc|co|corp|pvt|plc|gmbh|vs|no|dept|univ|assoc|eng|mgr|vp|svp|evp)$/i;
  const hasSentenceBreak = (t) => { const re = /(\p{L}+)[.!?]\s+\p{Lu}/gu; let m; while ((m = re.exec(t))) { if (m[1].length > 1 && !ABBREV.test(m[1])) return true; } return false; };
  const isLabel = (s, max) => { const t = clean(s); return !!t && t.length <= max && !/…/.test(t) && !hasSentenceBreak(t) && t.split(' ').length <= 12; };

  function roleHook(p, n) {
    const title = isLabel(p.currentTitle, 70) ? clean(p.currentTitle) : '';
    const co = isLabel(p.currentCompany, 60) ? clean(p.currentCompany) : '';
    // Never claim things the sender may not be able to stand behind ("I've been following…"): only describe what's on the profile.
    if (/^(?:student|undergraduate|graduate student|intern)$/i.test(title) && co) {
      return pick([`Saw you're ${/intern/i.test(title) ? 'interning' : 'studying'} at ${co}.`, `I noticed you're ${/intern/i.test(title) ? 'an intern' : 'a student'} at ${co}.`], n);
    }
    if (title && co) return pick([`Your work as ${title} at ${co} stood out to me.`, `Your role as ${title} at ${co} caught my attention.`], n);
    if (title) return pick([`Your work as ${title} stood out to me.`, `Your role as ${title} caught my attention.`], n);
    if (co) return `Your role at ${co} caught my attention.`;
    return null;
  }

  // ── Credential line (who I am, one line) ────────────────────────────────────
  function credLine(sender, bio, sharedLabel) {
    let intro = clean(sender && sender.intro);
    if (intro && sharedLabel) {   // "we both went to IIT Madras. I'm a CS student at IIT Madras" → drop the repeated "at IIT Madras"
      const esc = sharedLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      intro = clean(intro.replace(new RegExp(`\\s+(?:at|from|in|of)\\s+${esc}`, 'i'), ''));
    }
    if (intro) return `I'm ${article(intro)} ${stripEndPunct(intro)}.`;
    const first = clean(bio).split(/(?<=[.!?])\s/)[0];
    if (first && first.length <= 100) return /^(i['’]m|i am|i )/i.test(first) ? first : first;
    return null;
  }

  // ── Asks (ONE per message) ──────────────────────────────────────────────────
  function askFor(type, p, overlaps, n, short) {
    const co = isLabel(p.currentCompany, 60) ? clean(p.currentCompany) : '';
    const atCo = co ? ` at ${co}` : '';
    const skills = (overlaps || []).find(o => o.kind === 'skills');
    const A = {
      Networking: {
        long:  ['Would you be open to a quick 15-minute chat about how you got to where you are?', "I'd love to hear how you got started, if you have 15 minutes sometime.", "Would you be up for a short call? I'd really value your perspective."],
        short: ['Would you be open to a quick chat?', "I'd love to connect and learn from your path.", 'Would you be up for connecting?']
      },
      Job: {
        long:  [`I'm exploring roles${atCo} and would value 10 minutes of your advice on what teams look for.`, `I'm looking for opportunities${atCo}. Could I ask you a couple of quick questions about the team?`],
        short: [`I'm exploring roles${atCo}. Could I ask you two quick questions?`, `I'm exploring roles${atCo} and would value your advice.`]
      },
      Referral: {
        long:  [`I'm applying to ${co || 'roles where you work'} and would be grateful for any advice, or a referral if you feel I'd be a fit.`, `I'm applying${atCo}. Any advice on standing out would mean a lot, and a referral if you think I'd be a fit.`],
        short: [`I'm applying${atCo} and would value your advice.`, `I'm applying${atCo}. Any advice would mean a lot.`]   // no referral ask in a cold 200-char note
      },
      Collaboration: {
        long:  [skills ? `Would you be open to swapping ideas on ${skills.label}? I think we could build something useful.` : "I'd love to explore working together if you're open to it.", "I think there's something we could build together. Would you be open to a quick chat?"],
        short: ['Would you be open to exploring a collaboration?', skills ? `Open to swapping ideas on ${skills.label}?` : "I'd love to explore working together."]
      }
    };
    const set = A[type] || A.Networking;
    return pick(short ? set.short : set.long, n);
  }

  // ── Fit to the budget: drop the least valuable slot first ───────────────────
  const STEPS = [
    {},                                                                    // everything
    { out: false },                                                        // easy-out goes first
    { out: false, hook2: false },                                          // then a second shared point
    { out: false, hook2: false, cred: false },                             // then "who I am"
    { out: false, hook2: false, cred: false, short: true },                // then short-form hook + ask
    { out: false, hook2: false, cred: false, short: true, bare: true }     // last resort: greeting + hook + ask only
  ];

  function build(ctx, n, flags) {
    const { sender, messageType, tone, format } = ctx;
    const p = ctx.profile || {};
    const overlaps = Array.isArray(ctx.overlaps) ? ctx.overlaps : [];
    const isNote = format === 'note';
    const first = clean(p.firstName) || 'there';
    const short = isNote || !!flags.short;

    // hook
    const kept = overlaps.filter(Boolean);
    let hook, hookKind = 'generic', specific = true;
    const parts = [];
    if (kept.length) {
      const h = overlapHooks(kept[0]);
      hook = pick(short ? h.short : h.long, n);
      hookKind = kept[0].kind;
      parts.push(hook);
      if (!isNote && flags.hook2 !== false && kept[1]) parts.push(pick(overlapHooks(kept[1]).long, n + 1));
    } else {
      const ph = postHook(p, n, short);
      if (ph && !ctx.skipPost) { parts.push(ph.text); hookKind = 'post'; }
      else {
        const rh = roleHook(p, n);
        if (rh) { parts.push(rh); hookKind = 'role'; }
        else { parts.push('I came across your profile and wanted to reach out.'); specific = false; }
      }
    }

    const cred = flags.cred === false ? null : credLine(sender, ctx.bio, kept[0] && kept[0].kind === 'school' ? kept[0].label : '');
    if (cred) parts.push(cred);

    const ask = askFor(messageType, p, kept, n, short);
    const outLine = !isNote && flags.out !== false ? pick(OUT[tone] || OUT.Neutral, n) : null;
    const name = clean(ctx.senderName);
    const greet = (GREET[tone] || GREET.Neutral)(first);

    let text;
    if (isNote) {
      text = `${greet}\n${[parts.join(' '), ask].join(' ')}`;
    } else {
      const body1 = parts.join(' ');
      const body2 = [ask, outLine].filter(Boolean).join(' ');
      const sign = name ? `\n\n${SIGNOFF[tone] || 'Best,'}\n${name}` : '';
      text = `${greet}\n\n${body1}\n\n${body2}${sign}`;
    }
    return { text: tonalize(text, tone), specific, hookKind };
  }

  function hardFit(text, limit) {
    if (text.length <= limit) return text;
    const sentences = text.match(/[^.!?]+[.!?]+(?:\s|$)/g);
    if (sentences) {
      let acc = '';
      for (const s of sentences) { if ((acc + s).trim().length > limit) break; acc += s; }
      if (acc.trim().length >= limit * 0.5) return acc.trim();
    }
    return wordClip(text, limit);
  }

  function fit(ctx, n) {
    const limit = LIMITS[ctx.format] || LIMITS.note;
    let last;
    for (const flags of STEPS) {
      last = build(ctx, n, flags);
      if (last.text.length <= limit) return last;
    }
    return { ...last, text: hardFit(last.text, limit) };
  }

  // Three distinct variants. `seed` advances on each Regenerate so the user sees new combinations.
  function compose(ctx, opts = {}) {
    const seed = Number.isFinite(opts.seed) ? opts.seed : 0;
    const variants = [];
    const seen = new Set();
    for (let v = 0, tries = 0; variants.length < 3 && tries < 12; v++, tries++) {
      const r = fit(ctx, seed + v);
      if (seen.has(r.text)) continue;
      seen.add(r.text);
      variants.push(r);
    }
    return { variants };
  }

  // ── Reply-ready checklist (live; also runs on text the user edits) ──────────
  const CLICHES = [
    /hope this (message |email |note )?finds you well/i, /i came across your profile and (was|am) impressed/i, /impressed by your (work|profile|background)/i,
    /pick your brain/i, /touch base/i, /synerg/i, /i would love to connect and exchange ideas/i, /i'?d love to connect and exchange ideas/i,
    /\bquick call\b/i, /reaching out because/i, /game[- ]chang/i
  ];

  function mentionsFor(profile, overlaps) {
    const m = [];
    (overlaps || []).forEach(o => String(o.label).split(/,| and /).forEach(x => m.push(x)));
    const p = profile || {};
    [p.currentCompany, p.currentTitle].forEach(x => m.push(x));
    (p.educationEntries || []).slice(0, 2).forEach(e => m.push(typeof e === 'string' ? e.split(' — ')[0] : (e && e.school)));
    (p.skills || []).slice(0, 4).forEach(x => m.push(x));
    (p.recentPosts || []).slice(0, 1).forEach(x => m.push(wordClip(x, 25).replace(/…$/, '')));
    return [...new Set(m.map(clean).filter(x => x.length >= 3))];
  }

  function checklist(text, ctx = {}) {
    const t = String(text || '');
    const limit = LIMITS[ctx.format] || LIMITS.note;
    const lower = t.toLowerCase();
    const mention = (ctx.mentions || []).find(x => lower.includes(x.toLowerCase()));
    const qCount = (t.match(/\?/g) || []).length;
    const clichesFound = CLICHES.filter(re => re.test(t)).map(re => (t.match(re) || [''])[0]);
    const first = clean(ctx.firstName);
    const named = !first || first === 'there' ? false : lower.includes(first.toLowerCase());

    return [
      { id: 'specific', ok: !!mention, label: 'Mentions something specific to them', detail: mention ? `“${mention}”` : 'Name a shared school, employer, skill, or their work.' },
      { id: 'ask',      ok: qCount <= 1 && t.trim().length > 0, label: 'One clear ask', detail: qCount > 1 ? 'You ask more than one question; pick one.' : '' },
      { id: 'length',   ok: t.length <= limit, label: ctx.format === 'note' ? 'Fits a 200-character note' : 'Short enough to read quickly', detail: t.length <= limit ? '' : `${t.length - limit} over: trim a sentence` },
      { id: 'cliche',   ok: clichesFound.length === 0, label: 'No stock phrases', detail: clichesFound.length ? `Try rewording: “${clichesFound[0]}”` : '' },
      { id: 'named',    ok: named, label: 'Uses their first name', detail: named ? '' : 'Add their first name so it feels written for them.' }
    ];
  }

  return { LIMITS, compose, checklist, mentionsFor, wordClip, CLICHES };
});
