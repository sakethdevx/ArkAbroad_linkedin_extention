'use strict';

// approach.js — "what is the best next move for THIS person?" One short, rule-based suggestion shown above the drafts.
// Pure: no DOM, no network, nothing leaves the device. It is advice, never a prediction.
//   Approach.approach({ isConnection, overlaps[], recentPosts[], purpose }) → string | null
// Rules run in this order and the first that applies wins (so there is always ONE move, never a pile of tips).

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Approach = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const arr = (a) => (Array.isArray(a) ? a : []);

  function approach({ isConnection = null, overlaps = [], recentPosts = [], purpose = 'Networking' } = {}) {
    const shared = arr(overlaps).filter(o => o && o.label);
    const posts = arr(recentPosts).filter(x => x && !/\s[·•]\s/.test(x) && !(String(x).length <= 90 && !/[.!?]/.test(String(x).replace(/\.{3}|…/g, '')) && /^(?:\S+\s+){0,5}\S+\s(?:at|@)\s(?:\S+\s*){1,5}$/i.test(String(x).trim())));   // a card subtitle is not a post

    if (isConnection === true) {
      return 'Best next move: you are already connected, so a short, friendly message is enough. No note needed.';
    }
    if (purpose === 'Referral' && !shared.length) {
      return 'Best next move: ask for advice first and keep the referral request for your second message. You have no shared ground with them yet.';
    }
    if (posts.length) {
      return 'Best next move: like or comment on one of their recent posts first, then send the note. In one vendor dataset, warm messages got about 4× the replies (directional, not a guarantee).';
    }
    if (shared.length) {
      return `Best next move: open with what you share (${shared.slice(0, 2).map(o => o.label).join(', ')}); it is the most believable reason to write.`;
    }
    return null;
  }

  return { approach };
});
