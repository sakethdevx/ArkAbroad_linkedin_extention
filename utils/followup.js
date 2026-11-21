'use strict';

// followup.js — the Follow-up Coach. Most replies come from the second or third touch, and most people forget to send it.
// Pure: no DOM, no network, free (no AI). It never sends anything; it only says "this one is due" and offers a draft.
//   FollowUp.due(contact, now)   → null | { stage: 1|2, days }
//   FollowUp.draft(contact, stage, senderName) → string      a short, polite message that invents nothing
// Rules: a follow-up is due 4 days after you sent the first message, and a last one 10 days after. Never more than two,
// never once they replied, and "snooze" hides it for a while. Nagging people is how outreach goes wrong.

(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./compose.js') : root.Compose);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FollowUp = api;
})(typeof self !== 'undefined' ? self : this, function (Compose) {

  const DAY = 24 * 60 * 60 * 1000;
  const AFTER_DAYS = { 1: 4, 2: 10 };
  const MAX = 2;

  // when the first message went out: the moment you marked it sent (older entries: when the draft was saved)
  const sentOn = (c) => Number(c && (c.sentAt || c.timestamp)) || 0;

  function due(contact, now = Date.now()) {
    const c = contact || {};
    if (!c.sent || c.replied) return null;
    const done = Number(c.followUps) || 0;
    if (done >= MAX) return null;
    if (Number(c.snoozeUntil) > now) return null;
    const start = sentOn(c);
    if (!start) return null;
    const days = Math.floor((now - start) / DAY);
    const stage = done + 1;
    return days >= AFTER_DAYS[stage] ? { stage, days } : null;
  }

  const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';

  function draft(contact, stage, senderName) {
    const f = firstName(contact && contact.name);
    const hi = f ? `Hi ${f},` : 'Hi,';
    const body = stage >= 2
      ? 'One last note from me. If now is not a good time, no worries at all, and thank you for reading. I will leave it here.'
      : 'I wanted to follow up on my earlier message in case it got buried. Even a one-line reply would mean a lot, and no pressure if it is not a fit.';
    const sign = senderName ? `\n\n${Compose.SIGNOFF.Neutral}\n${senderName}` : '';
    return `${hi}\n${body}${sign}`;
  }

  return { due, draft, DAY, AFTER_DAYS, MAX };
});
