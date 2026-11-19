'use strict';

// Cache utility — recent drafts in chrome.storage.local (newest first, capped).

const Cache = (() => {
  const KEY = 'recentContacts';
  const MAX = 30;

  // Profiles without a URL (pasted text) must not collapse into one entry.
  const keyOf = (c) => (c.profileUrl || `${c.name || ''}|${c.headline || ''}`).toLowerCase();

  async function getContacts() {
    return new Promise((resolve) => {
      chrome.storage.local.get([KEY], (result) => {
        resolve(result[KEY] || []);
      });
    });
  }

  async function addContact(contact) {
    const contacts = await getContacts();
    const prev = contacts.find(c => keyOf(c) === keyOf(contact));
    const merged = { ...contact, ...(prev && prev.sent ? { sent: true } : {}) };   // re-saving an edit must not un-send it
    const updated = [merged, ...contacts.filter(c => keyOf(c) !== keyOf(contact))].slice(0, MAX);
    return new Promise((resolve) => {
      chrome.storage.local.set({ [KEY]: updated }, resolve);
    });
  }

  async function setSent(contact, sent) {
    const contacts = await getContacts();
    const updated = contacts.map(c => (keyOf(c) === keyOf(contact) ? { ...c, sent: !!sent } : c));
    return new Promise((resolve) => chrome.storage.local.set({ [KEY]: updated }, resolve));
  }

  async function clearContacts() {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [KEY]: [] }, resolve);
    });
  }

  return { getContacts, addContact, setSent, clearContacts, MAX };
})();
