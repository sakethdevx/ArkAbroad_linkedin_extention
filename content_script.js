'use strict';

// content_script.js — injected on demand (only when the user clicks Generate).
// Reads what is already rendered on the page; never clicks, types or navigates.
// Depends on utils/profile_parse.js (injected first).

(function () {
  // Guard against double-registering, but keyed by version so new code replaces stale code after an update.
  const VERSION = 'scroll-3';
  if (window.__outreachAiLoaded === VERSION) return;
  window.__outreachAiLoaded = VERSION;

  const PP = window.ProfileParse;
  const PS = window.PageScroll;

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.action === 'ping') { sendResponse({ ok: true, version: VERSION }); return; }
    if (msg && msg.action === 'scrapeProfile') {
      scrapeWithScroll()
        .then(profile => sendResponse({ success: true, data: profile }))
        .catch(err => sendResponse({ success: false, error: (err && err.message) || 'Scrape failed.' }));
      return true;
    }
  });

  // LinkedIn lazy-renders lower sections as they near the viewport. Scroll through the page the way a reader
  // would (adaptive steps, stops once the sections exist), then put the user back where they were.
  async function scrapeWithScroll() {
    let info = null;
    try {
      info = await PS.loadAll({
        isReady: () => hasContent('experience') && hasContent('education') && (hasContent('skills') || !!findSection('skills'))
      });
    } catch (_) { /* scrolling is best-effort; we still read whatever is on the page */ }
    const profile = scrapeProfile();
    if (info) profile.load = info;
    return profile;
  }

  function hasContent(key) {
    const sec = findSection(key);
    return !!(sec && sec.querySelector('li, p, span') && (sec.innerText || sec.textContent || '').trim().length > 20);
  }

  // ── DOM helpers (all defensive) ─────────────────────────────────────────────
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'SVG', 'PATH', 'IMG', 'BUTTON', 'NOSCRIPT']);

  function leafLines(root, excludeEls) {
    if (!root) return [];
    const lines = [];
    for (const el of root.querySelectorAll('*')) {
      if (el.children.length > 0 || SKIP_TAGS.has(el.tagName.toUpperCase())) continue;
      if (excludeEls && excludeEls.some(x => x.contains(el))) continue;
      const t = (el.innerText || el.textContent || '').trim();
      if (t) lines.push(t);
    }
    return PP.cleanLines(lines);
  }

  // Text of an element as LINES. Chrome's innerText already does this from the layout; if it is unavailable or flat,
  // walk the tree and break lines at block-level elements (inline pieces such as links stay on the same line).
  const BLOCK = new Set(['DIV', 'P', 'LI', 'UL', 'OL', 'SECTION', 'ARTICLE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BR', 'TR', 'HEADER', 'FOOTER']);
  function textLines(el) {
    if (!el) return [];
    const viaLayout = typeof el.innerText === 'string' ? el.innerText : '';
    if (viaLayout.includes('\n')) return viaLayout.split(/\n+/);
    const lines = []; let cur = '';
    const flush = () => { if (cur.trim()) lines.push(cur); cur = ''; };
    (function walk(n) {
      if (n.nodeType === 3) { cur += n.nodeValue + ' '; return; }
      if (n.nodeType !== 1 || SKIP_TAGS.has(n.tagName.toUpperCase())) return;
      const block = BLOCK.has(n.tagName.toUpperCase());
      if (block) flush();
      n.childNodes.forEach(walk);
      if (block) flush();
    })(el);
    flush();
    return lines.map(l => l.replace(/\s+([,.;:!?…])/g, '$1').replace(/\s+/g, ' ').trim());
  }

  // Language-independent first: LinkedIn puts <div id="experience"> anchors inside each card.
  // Fallback: match the section's heading text in several languages.
  function findSection(key) {
    try {
      const anchor = document.getElementById(key);
      const viaAnchor = anchor && anchor.closest('section');
      if (viaAnchor) return viaAnchor;
    } catch (_) { /* fall through */ }
    const aliases = (PP.SECTION_ALIASES[key] || [key]).map(a => a.toLowerCase());
    return Array.from(document.querySelectorAll('section')).find(s => {
      const h = s.querySelector('h2');
      const t = ((h && (h.innerText || h.textContent)) || '').trim().toLowerCase();
      return t && aliases.some(a => t === a || t.startsWith(a));
    }) || null;
  }

  // Top-level <li> items of a section → {lines, children[]} blocks (children = roles inside a company group).
  function sectionBlocks(section) {
    if (!section) return [];
    const all = Array.from(section.querySelectorAll('li'));
    const top = all.filter(li => {
      const outer = li.parentElement && li.parentElement.closest('li');
      return !(outer && section.contains(outer));
    });
    return top.map(li => {
      const nested = all.filter(n => n !== li && li.contains(n) && n.parentElement.closest('li') === li);
      return {
        lines: leafLines(li, nested),
        children: nested.map(n => ({ lines: leafLines(n), children: [] }))
      };
    }).filter(b => b.lines.length || b.children.length);
  }

  function safe(label, fn, fallback, warnings) {
    try { return fn(); }
    catch (e) { warnings.push(`Could not read ${label}.`); return fallback; }
  }

  // ── Scrape ──────────────────────────────────────────────────────────────────
  function scrapeProfile() {
    const warnings = [];
    const url = window.location.href.split('?')[0];

    const topSection = Array.from(document.querySelectorAll('section')).find(s => s.querySelector('h1')) || null;
    const topLines   = safe('the top card', () => leafLines(topSection), [], warnings);

    const name = safe('the name', () => {
      const h1 = document.querySelector('h1');
      const fromH1 = PP.clean(h1 && (h1.innerText || h1.textContent));
      if (fromH1) return fromH1;
      // Fallbacks only make sense on an actual profile URL (never invent a name like "LinkedIn").
      return /^\/in\//.test(window.location.pathname) ? (PP.nameFromPageTitle(document.title) || PP.nameFromUrl(url)) : '';
    }, '', warnings);

    const headline = safe('the headline', () => {
      const viaClass = document.querySelector('div.text-body-medium');
      const c = PP.clean(viaClass && viaClass.innerText);
      if (c && c !== name) return c;
      const cands = topLines.filter(t => t !== name && t.length > 5 && !/^(?:·|\(?\d+(?:st|nd|rd)\)?|contact info)/i.test(t));
      return cands.find(t => /[|@·]|\bat\b/i.test(t)) || cands[0] || '';
    }, '', warnings);

    const location = safe('the location', () => {
      const viaClass = document.querySelector('span.text-body-small.inline.break-words');
      const c = PP.clean(viaClass && viaClass.innerText);
      if (c && c.length < 80) return c;
      return topLines.find(t => t !== name && t !== headline && t.includes(',') && t.length < 60 && !/[|@]/.test(t)) || '';
    }, '', warnings);

    const about = safe('About', () => {
      const lines = leafLines(findSection('about')).filter(t => t.length > 40 && !/^about$/i.test(t));
      return lines.sort((a, b) => b.length - a.length)[0] || '';
    }, '', warnings);

    const experience = safe('Experience', () => {
      const sec = findSection('experience');
      if (!sec) return [];
      const blocks = sectionBlocks(sec);
      const viaBlocks = PP.parseExperienceBlocks(blocks);
      return viaBlocks.length ? viaBlocks : PP.parseExperienceLines(leafLines(sec));
    }, [], warnings);

    const education = safe('Education', () => {
      const sec = findSection('education');
      if (!sec) return [];
      const viaBlocks = PP.parseEducationBlocks(sectionBlocks(sec));
      return viaBlocks.length ? viaBlocks : PP.parseEducationLines(leafLines(sec));
    }, [], warnings);

    const skills = safe('Skills', () => {
      const sec = findSection('skills');
      if (!sec) return [];
      const blocks = sectionBlocks(sec);
      const firsts = blocks.map(b => b.lines[0]).filter(Boolean);
      return PP.parseSkills(firsts.length ? firsts : leafLines(sec));
    }, [], warnings);

    const recentPosts = safe('Activity', () => {
      const sec = findSection('activity');
      if (!sec) return [];
      // Each post is a card (usually an <li>). Read it as text LINES (innerText keeps inline links like "Amazon ML Summer School"
      // on the same line instead of splitting them into fragments) and let extractPostText drop the card chrome.
      const cards = Array.from(sec.querySelectorAll('li')).filter(li => !(li.parentElement && li.parentElement.closest('li') && sec.contains(li.parentElement.closest('li'))));
      const groups = cards.length ? cards.map(c => textLines(c)) : [textLines(sec)];
      const out = [];
      for (const lines of groups) {
        const post = PP.extractPostText(lines, { name, headline });
        if (post && !out.includes(post)) out.push(post);
        if (out.length >= 3) break;
      }
      return out;
    }, [], warnings);

    const profile = PP.buildProfile({ name, headline, location, about, experience, education, skills, recentPosts, profileUrl: url, warnings, connectionDegree: safe('the connection badge', () => PP.parseConnectionDegree(topLines), '', warnings) });
    profile.rawTitle = document.title;
    return profile;
  }
})();
