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
        if (flat(n.textContent).length >= 200) return n;
      }
    }
    // last resort: the longest job-looking text block inside <main>
    const main = q(doc, 'main') || doc.body;
    if (!main) return null;
    let best = null, bestLen = 0;
    qa(main, 'section,article,div').forEach(e => {
      const len = flat(e.textContent).length;
      if (len >= 300 && len <= 20000 && len > bestLen && JOBISH.test(e.textContent) && e.querySelectorAll('section,article').length < 6) { best = e; bestLen = len; }
    });
    return best;
  }

  function findPane(doc, desc) {
    for (const sel of PANE_SELECTORS) { const el = q(doc, sel); if (el && (!desc || el.contains(desc))) return el; }
    return (desc && (desc.closest('main') || desc.parentElement)) || doc.body;
  }

  function titleFrom(doc, pane) {
    const h1 = q(pane, 'h1') || q(doc, 'h1');
    if (h1 && flat(h1.textContent)) return flat(h1.textContent);
    const el = q(pane, '[class*="job-title"]') || q(pane, 'h2');
    if (el && flat(el.textContent)) return flat(el.textContent);
    const t = flat(doc.title || '').replace(/^\(\d+\)\s*/, '');
    return flat(t.split(/\s[|–-]\s/)[0]);
  }

  function companyFrom(doc, pane, title) {
    const a = qa(pane, 'a[href*="/company/"]').map(x => flat(x.textContent)).find(t => t && t.length < 80);
    if (a) return a;
    const parts = flat(doc.title || '').replace(/^\(\d+\)\s*/, '').split(/\s[|–-]\s/).map(flat);
    const i = parts.findIndex(p => p === title);
    return i >= 0 && parts[i + 1] && !/linkedin/i.test(parts[i + 1]) ? parts[i + 1] : '';
  }

  function jobIdFrom(loc) {
    const href = String((loc && (loc.href || '')) || '');
    const m = href.match(/[?&]currentJobId=(\d+)/) || href.match(/\/jobs\/view\/(?:[^/?#]*-)?(\d+)/);
    return m ? m[1] : '';
  }
  const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return String(h); };

  function scrape(doc, loc) {
    try {
      if (!doc || !doc.body) return { ok: false, reason: 'no-page', key: '' };
      const desc = findDescription(doc);
      const id = jobIdFrom(loc);
      if (!desc) return { ok: false, reason: 'no-description', key: id };
      const descLines = linesOf(desc).filter(l => !/^(?:about the job|show more|show less|see more|…\s*more)$/i.test(l));
      const description = descLines.join('\n');
      if (description.length < 80) return { ok: false, reason: 'too-short', key: id };
      const pane = findPane(doc, desc);
      const title = titleFrom(doc, pane);
      const company = companyFrom(doc, pane, title);
      // the lines above the description in the pane ("City, State · 2 days ago · Over 100 applicants", "On-site", "Full-time", "Entry level")
      const paneLines = linesOf(pane, 6000);
      const at = paneLines.findIndex(l => /^about the job$/i.test(l));
      const top = (at > 0 ? paneLines.slice(0, at) : paneLines.slice(0, 25)).join('\n').slice(0, 1500);
      const loc1 = (top.split('\n').map(l => l.split(/\s[·•]\s/)[0]).find(l => /,\s*[A-Z]/.test(l) && l.length < 80 && l !== title) || '');
      return {
        ok: true, el: desc, pane, key: id || hash(title + '|' + description.slice(0, 400)),
        job: { title, company, location: flat(loc1), rawText: top, chips: [], description, url: String((loc && loc.href) || '').split('#')[0].slice(0, 300) }
      };
    } catch (e) {
      return { ok: false, reason: 'error', key: '' };
    }
  }

  return { scrape, findDescription, linesOf, jobIdFrom };
});
