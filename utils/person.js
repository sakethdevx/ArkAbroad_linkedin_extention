'use strict';

// person.js — who is this person? A LinkedIn profile is identified by the handle in its address
// (linkedin.com/in/<handle>). The handle is stable, so the same person is one entry in Recent even when the
// address differs by query string, trailing slash, language prefix or country subdomain.
//   Person.handleOf(url)      → 'jane-doe' | null        (null for anything that is not a profile address)
//   Person.profileLink(x)     → 'https://www.linkedin.com/in/jane-doe/' | null   (x = a handle or a profile address)
// A link is built ONLY from a handle that passes the check below, so nothing else can ever be opened from Recent.
// Pure: no DOM, no network.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Person = api;
})(typeof self !== 'undefined' ? self : this, function () {

  const VALID = /^[\p{L}\p{N}_.\-]{1,100}$/u;
  const PROFILE = /^https?:\/\/(?:[a-z0-9-]+\.)?linkedin\.com\/(?:[a-z]{2}\/)?in\/([^/?#]+)/i;

  function cleanHandle(h) {
    let t = String(h == null ? '' : h).trim();
    try { t = decodeURIComponent(t); } catch (_) { return null; }
    t = t.toLowerCase();
    return VALID.test(t) ? t : null;
  }

  function handleOf(url) {
    const m = String(url || '').match(PROFILE);
    return m ? cleanHandle(m[1]) : null;
  }

  function profileLink(x) {
    const s = String(x == null ? '' : x).trim();
    const h = /^https?:\/\//i.test(s) ? handleOf(s) : cleanHandle(s);
    return h ? `https://www.linkedin.com/in/${encodeURIComponent(h)}/` : null;
  }

  return { handleOf, profileLink };
});
