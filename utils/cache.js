'use strict';

// Cache utility — recent drafts in chrome.storage.local (newest first, capped).

const Cache = (() => {
  const KEY = 'recentContacts';
  const MAX = 30;

  // The person's LinkedIn handle identifies them (the same person is one entry whatever the address looks like).
  // Profiles without one (pasted text) fall back to name + headline so they do not collapse into one entry.
  const handleFor = (c) => c.handle || (typeof Person !== 'undefined' ? Person.handleOf(c.profileUrl) : null) || null;
  const keyOf = (c) => { const h = handleFor(c); return h ? 'in:' + h : `${c.name || ''}|${c.headline || ''}`.toLowerCase(); };
  const upgrade = (c) => { const h = handleFor(c); return h && !c.handle ? { ...c, handle: h } : c; };   // entries saved before handles existed

  async function getContacts() {
    return new Promise((resolve) => {
      chrome.storage.local.get([KEY], (result) => {
        resolve((result[KEY] || []).map(upgrade));
      });
    });
  }

  async function addContact(contact) {
    const contacts = await getContacts();
    const prev = contacts.find(c => keyOf(c) === keyOf(contact));
    const merged = { ...upgrade(contact), ...(prev && prev.sent ? { sent: true } : {}) };   // re-saving an edit must not un-send it
    const updated = [merged, ...contacts.filter(c => keyOf(c) !== keyOf(contact))].slice(0, MAX);
    return new Promise((resolve) => {
      chrome.storage.local.set({ [KEY]: updated }, resolve);
    });
  }

  // change one entry (found by person, not by position). patch = object to merge, or a function(entry) → object
  async function update(contact, patch) {
    const contacts = await getContacts();
    const updated = contacts.map(c => (keyOf(c) === keyOf(contact) ? { ...c, ...(typeof patch === 'function' ? patch(c) : patch) } : c));
    return new Promise((resolve) => chrome.storage.local.set({ [KEY]: updated }, resolve));
  }

  // marking sent starts the follow-up clock; un-marking resets it
  const setSent = (contact, sent) => update(contact, (c) => (sent
    ? { sent: true, sentAt: c.sentAt || Date.now() }
    : { sent: false, sentAt: null, followUps: 0, replied: false, snoozeUntil: null }));

  async function clearContacts() {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [KEY]: [] }, resolve);
    });
  }

  return { getContacts, addContact, update, setSent, clearContacts, MAX };
})();
