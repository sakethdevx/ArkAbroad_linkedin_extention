'use strict';

// draftcheck.js — everything that happens to a model's draft AFTER the model, shared by the cloud path and the
// on-device path so both are held to exactly the same rules. Pure: no DOM, no network.
//   finishDrafts(raw[], opts)  → { good: string[], bad: [{ draft, problems[] }] }
//   groundedness(text, facts)  → names/numbers in the draft that are NOT in the facts we gave the model
// What it does to each draft, in order: drop a stray name sign-off on notes, complete a partial sign-off on messages,
// turn "you both" into "we both", add the recipient's first name if the greeting is missing, shorten a draft that is a
// little too long by dropping middle sentences (nothing is reworded or added), then validate.

(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./safety.js') : root.Safety);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DraftCheck = api;
})(typeof self !== 'undefined' ? self : this, function (Safety) {

  const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const FILLER = ['thanks', 'thank', 'you', 'best', 'regards', 'cheers', 'sincerely', 'warmly'];

  // a connection note has no sign-off: drop a trailing line that is only the sender's name (models love adding one)
  function stripSignoff(t, { format, nameWords }) {
    if (format !== 'note' || !nameWords.length) return t;
    const lines = t.replace(/\s+$/, '').split('\n');
    if (lines.length < 2) return t;
    const last = lines[lines.length - 1].toLowerCase().replace(/[^\p{L}\s'-]/gu, ' ').split(/\s+/).filter(Boolean);
    return last.length && last.length <= 4 && last.every(w => nameWords.includes(w) || FILLER.includes(w)) ? lines.slice(0, -1).join('\n').trim() : t;
  }

  // a message signs off with the FULL name; if the model used only one part of it (e.g. just the surname), complete it
  function fixSignoff(t, { format, nameWords, senderName }) {
    if (format !== 'message' || !nameWords.length) return t;
    const lines = t.split('\n');
    const last = lines[lines.length - 1].trim();
    const words = last.toLowerCase().replace(/[^\p{L}\s'-]/gu, ' ').split(/\s+/).filter(Boolean);
    if (lines.length > 1 && words.length && words.length <= 3 && words.every(w => nameWords.includes(w)) && last !== senderName) lines[lines.length - 1] = senderName;
    return lines.join('\n');
  }

  // "you both" is ambiguous in a message written by the sender (who is "both"?). Say "we both".
  const fixVoice = (t) => t.replace(/\bI (?:see|notice|noticed) (?:that )?you both\b/gi, 'I noticed we both').replace(/\byou both\b/gi, 'we both');

  // models sometimes skip the greeting; add it when it fits, so every draft reads as written for them
  function greet(t, { firstName, maxChars }) {
    if (!firstName || new RegExp('\\b' + escRe(firstName) + '\\b', 'i').test(t)) return t;
    const g = `Hi ${firstName},\n${t}`;
    return g.length <= maxChars ? g : t;
  }

  // Models cannot count. A draft only slightly over the limit is shortened by dropping whole sentences from the middle
  // (the hook and the ask stay); nothing is reworded or added, so no new claims can slip in.
  function trimToFit(t, { maxChars }) {
    t = t.trim();
    if (t.length <= maxChars) return t;
    const parts = t.split(/(?<=[.!?])\s+/);
    while (parts.length > 2 && parts.join(' ').length > maxChars) parts.splice(parts.length - 2, 1);
    return parts.length >= 2 && parts.join(' ').length <= maxChars ? parts.join(' ') : t;
  }

  // ── Groundedness: small models invent details. Every capitalised word (not at the start of a sentence) and every
  // number in a draft must already appear in the facts we gave the model, or the draft is rejected.
  const GREETING_OK = new Set(['hi', 'hello', 'hey', 'dear', 'thanks', 'thank', 'best', 'regards', 'cheers', 'sincerely', 'warmly', 'would', 'could', 'i', 'im', 'ive', 'id', 'linkedin']);
  const norm = (s) => String(s || '').normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase();

  function ungrounded(text, facts) {
    const hay = ' ' + norm(facts).replace(/[^\p{L}\p{N}]+/gu, ' ') + ' ';
    const out = [];
    const re = /(\p{Lu}[\p{L}'’-]*|\d[\d,.]*)/gu;
    const t = String(text || '');
    let m;
    while ((m = re.exec(t))) {
      const word = m[0];
      const before = t.slice(0, m.index).replace(/\s+$/, '');
      const sentenceStart = before === '' || /[.!?:\n]$/.test(before) || /\n\s*$/.test(t.slice(0, m.index));
      const key = norm(word).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
      if (!key || GREETING_OK.has(key)) continue;
      if (sentenceStart && /^\p{Lu}[\p{Ll}'’-]*$/u.test(word) && !hay.includes(' ' + key + ' ')) {
        // a normal sentence-opening word ("Would", "Fellow") is fine; only skip it when it is also a common lower-case word
        if (/^[a-z]+$/.test(key) && key.length <= 9) continue;
      }
      if (!hay.includes(' ' + key + ' ')) out.push(word);
    }
    return [...new Set(out)];
  }

  function groundedness(text, facts) {
    const bad = ungrounded(text, facts);
    return bad.length ? [`mentions ${bad.slice(0, 2).map(w => `"${w}"`).join(', ')}, which is not in your data`] : [];
  }

  // opts: { format, maxChars, firstName, senderName, allowedText, facts, requireGrounded }
  function finishDrafts(rawList, opts = {}) {
    const { format = 'note', maxChars = 200, firstName = '', senderName = '', allowedText = '', facts = '', requireGrounded = false } = opts;
    const nameWords = String(senderName || '').toLowerCase().split(/\s+/).filter(Boolean);
    const ctx = { format, nameWords, senderName, firstName, maxChars };
    const good = [], bad = [];
    for (const v of (Array.isArray(rawList) ? rawList : []).filter(x => typeof x === 'string').slice(0, 3)) {
      let t = stripSignoff(v, ctx);
      t = fixSignoff(t, ctx);
      t = fixVoice(t);
      t = greet(t, ctx);
      t = trimToFit(t, ctx);
      const checked = Safety.validateOutput(t, { maxChars, allowedText });
      const problems = checked.problems.slice();
      if (requireGrounded && checked.ok) problems.push(...groundedness(checked.text, facts));
      if (!problems.length) good.push(checked.text); else bad.push({ draft: String(v).slice(0, 700), problems });
    }
    return { good, bad };
  }

  return { finishDrafts, groundedness, stripSignoff, fixSignoff, fixVoice, greet, trimToFit };
});
