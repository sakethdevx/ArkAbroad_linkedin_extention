'use strict';

// jobscrape.js — reads the job you are looking at on LinkedIn Jobs, on this device, into { title, company, location, rawText, description, url }.
// It runs in the LinkedIn tab (content-script world) and only READS the page: it never clicks, types or scrolls anything.
// LinkedIn changes its class names often, so it finds things by STRUCTURE first (the "About the job" heading, the job title heading,
// the company link) and only then by known class names, and it never throws: a page it cannot read gives { ok: false, reason }.
//   JobScrape.scrape(doc, loc) → { ok, job?, key, reason? }      key = job id (or a content hash) so the caller knows when the job changed

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JobScrape = api;
})(typeof self !== 'undefined' ? self : this, function () {

  const BLOCK = /^(?:address|article|aside|blockquote|br|dd|div|dl|dt|fieldset|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tr|ul)$/i;
  const SKIP = /^(?:script|style|noscript|svg|button|template|iframe|input|select|textarea)$/i;
  const flat = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

  // text with line breaks where the page has block boundaries (works the same in a browser and in jsdom; hidden "show more" buttons are skipped)
  function linesOf(el, cap = 40000) {
    const out = [];
    let cur = '';
    const flush = () => { const t = flat(cur); if (t) out.push(t); cur = ''; };
    const walk = (n, depth) => {
      if (!n || depth > 60 || out.join('\n').length > cap) return;
      if (n.nodeType === 3) { cur += n.nodeValue; return; }
      if (n.nodeType !== 1 || SKIP.test(n.nodeName)) return;
      if (n.hasAttribute && (n.hasAttribute('hidden') || n.getAttribute('aria-hidden') === 'true') && !n.querySelector) return;
      const block = BLOCK.test(n.nodeName);
      if (block) flush();
      for (let c = n.firstChild; c; c = c.nextSibling) walk(c, depth + 1);
      if (block) flush();
    };
    walk(el, 0);
    flush();
    return out;
  }

  const q = (root, sel) => { try { return root.querySelector(sel); } catch (_) { return null; } };
  const qa = (root, sel) => { try { return Array.from(root.querySelectorAll(sel)); } catch (_) { return []; } };

  const DESC_SELECTORS = ['#job-details', '.jobs-description__content', '.jobs-box__html-content', '.jobs-description-content__text', '.show-more-less-html__markup', '[class*="jobs-description"]'];
  const PANE_SELECTORS = ['.jobs-search__job-details--container', '.jobs-details', '.job-view-layout', '.scaffold-layout__detail', '[class*="jobs-search__job-details"]', '[class*="job-details"]'];
  const JOBISH = /\b(responsibilit|requirement|qualification|experience|skills?|you will|we are looking|about the (?:role|job)|apply)\w*/i;

  function findDescription(doc) {
    for (const sel of DESC_SELECTORS) {
      const el = q(doc, sel);
      if (el && flat(el.textContent).length >= 80) return el;
    }
    // by structure: the heading "About the job" and the section that holds it
    const heads = qa(doc, 'h1,h2,h3,h4,span,div,p').filter(e => e.children.length === 0 && /^about the job$/i.test(flat(e.textContent)));
    for (const h of heads) {
      let n = h;
      for (let i = 0; i < 5 && n && n.parentElement; i++) {
        n = n.parentElement;
        if (flat(n.textContent).length >= 100) return n;   // the smallest block around the heading that holds real text after it
      }
    }
    // no further guessing: on the Jobs home page and search results with no job picked there is nothing to read, and guessing from the
    // longest block of text would mistake the whole page for a posting
    return null;
  }

  function findPane(doc, desc) {
    for (const sel of PANE_SELECTORS) { const el = q(doc, sel); if (el && (!desc || el.contains(desc))) return el; }
    return (desc && (desc.closest('main') || desc.parentElement)) || doc.body;
  }

  const META = /\s[·•]\s|\bago\b|applicants?\b|clicked apply|responses managed|\bpromoted\b|\bviewed\b/i;
  const GENERIC = /^(?:are these results helpful\??|jobs?|search results|jobs based on.*|top job picks.*|recommended.*|people you can reach out to|about the job|premium|job match.*)$/i;
  const NOT_TITLE = /^(?:apply|easy apply|save|saved|share|report|show more|show less|follow|message|…)$/i;

  // The company name sits right next to the job title ("Technoidentity" above "AI/ML Engineer - DevOps"), so the title is found from the
  // company first; LinkedIn's headings are not reliable (a feedback box can be the first <h1> in the pane).
  function titleFrom(doc, pane, id, company, paneLines) {
    const good = (t) => { t = flat(t); return t.length >= 3 && t.length <= 140 && !NOT_TITLE.test(t) && !GENERIC.test(t) && !META.test(t) ? t : ''; };
    if (id) { const a = qa(pane, `a[href*="/jobs/view/${id}"]`).map(x => good(x.textContent)).find(Boolean); if (a) return a; }
    const byClass = qa(pane, '[class*="job-title"]').map(x => good(x.textContent)).find(Boolean);
    if (byClass) return byClass;
    if (company) {
      const i = paneLines.findIndex(l => l === company);
      if (i >= 0) { const next = good(paneLines[i + 1] || ''); if (next && next !== company) return next; const prev = good(paneLines[i - 1] || ''); if (prev && prev !== company) return prev; }
    }
    const h = qa(pane, 'h1,h2').map(x => good(x.textContent)).find(Boolean);
    if (h) return h;
    const t = flat(doc.title || '').replace(/^\(\d+\)\s*/, '');
    return good(t.split(/\s[|–-]\s/)[0]);
  }

  function companyFrom(doc, pane) {
    const a = qa(pane, 'a[href*="/company/"]').map(x => flat(x.textContent)).find(t => t && t.length < 80);
    if (a) return a;
    const parts = flat(doc.title || '').replace(/^\(\d+\)\s*/, '').split(/\s[|–-]\s/).map(flat);
    return parts.length >= 3 && !/linkedin/i.test(parts[1]) ? parts[1] : '';
  }

  const lca = (a, b) => { const up = new Set(); for (let n = a; n; n = n.parentElement) up.add(n); for (let n = b; n; n = n.parentElement) if (up.has(n)) return n; return null; };
  const depthOf = (n) => { let d = 0; for (; n && n.parentElement; n = n.parentElement) d++; return d; };
  // Elements that show the title as a whole, for placing the card under the top card. On the search layout the SAME title also appears in the
  // list of jobs on the left, so list items are ignored, only copies before the description count, and the copy closest to the description
  // (the deepest shared ancestor) comes first.
  function titleElements(doc, title, desc) {
    if (!title || !doc.body) return [];
    const small = qa(doc.body, 'a,h1,h2,h3,p,span,div,strong').filter(e => e.children.length <= 3 && (e.textContent || '').length <= title.length + 40 && flat(e.textContent) === title);
    const deepest = small.filter(e => !small.some(o => o !== e && e.contains(o)));
    return deepest
      .filter(e => !desc.contains(e) && (e.compareDocumentPosition(desc) & 4) && !(e.closest && e.closest('li, [data-job-id], [class*="job-card"], [class*="results-list"], [class*="search-results"], [class*="jobs-search-results"]')))
      .sort((x, y) => depthOf(lca(y, desc)) - depthOf(lca(x, desc)));
  }

  function jobIdFrom(loc) {
    const href = String((loc && (loc.href || '')) || '');
    const m = href.match(/[?&](?:currentJobId|jobId)=(\d+)/) || href.match(/\/jobs\/view\/(?:[^/?#]*-)?(\d+)/);
    return m ? m[1] : '';
  }
  const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return String(h); };

  function scrape(doc, loc) {
    try {
      if (!doc || !doc.body) return { ok: false, reason: 'no-page', key: '' };
      const id = jobIdFrom(loc);
      if (!id) return { ok: false, reason: 'no-job-selected', key: '' };   // a job must be open: the address names it
      const desc = findDescription(doc);
      if (!desc) return { ok: false, reason: 'no-description', key: id };
      const descLines = linesOf(desc).filter(l => !/^(?:about the job|show more|show less|see more|…\s*more)$/i.test(l));
      const description = descLines.join('\n');
      if (description.length < 80) return { ok: false, reason: 'too-short', key: id };
      const pane = findPane(doc, desc);
      const paneLines = linesOf(pane, 8000);
      const company = companyFrom(doc, pane);
      const title = titleFrom(doc, pane, id, company, paneLines);
      // the top-card lines ("City, State · 2 days ago · Over 100 applicants", "On-site", "Full-time", "Entry level"), up to LinkedIn's own Premium / About boxes
      const titleEls = titleElements(doc, title, desc);
      const tight = titleEls.length ? (lca(titleEls[0], desc) || pane) : pane;   // the details pane itself, not the whole results layout
      const tightLines = tight === pane ? paneLines : linesOf(tight, 8000);
      const stop = tightLines.findIndex(l => /^(?:premium|job match|see how you compare|meet the hiring team|about the job)\b/i.test(l));
      const top = (stop > 0 ? tightLines.slice(0, stop) : tightLines.slice(0, 25)).join('\n').slice(0, 1500);
      const tl = top.split('\n');
      const metaLine = tl.find(l => /\s[·•]\s/.test(l) && /\bago\b|applicants?|clicked apply/i.test(l));   // "India · 4 hours ago · 22 people clicked apply"
      const loc1 = (metaLine ? metaLine.split(/\s[·•]\s/)[0] : '') || (tl.map(l => l.split(/\s[·•]\s/)[0]).find(l => /,\s*[A-Z]/.test(l) && l.length < 80 && l !== title) || '');
      return {
        ok: true, el: desc, pane: tight, titleEls, key: id || hash(title + '|' + description.slice(0, 400)),
        job: { title, company, location: flat(loc1), rawText: top, chips: [], description, url: String((loc && loc.href) || '').split('#')[0].slice(0, 300) }
      };
    } catch (e) {
      return { ok: false, reason: 'error', key: '' };
    }
  }

  return { scrape, findDescription, linesOf, jobIdFrom };
});
