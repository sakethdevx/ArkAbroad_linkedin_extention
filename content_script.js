'use strict';

// content_script.js — injected on demand (only when the user clicks Generate).
// Reads what is already rendered on the page; never clicks, types or navigates.
// Depends on utils/profile_parse.js (injected first).

(function () {
  if (window.__outreachAiLoaded) return;   // guard: injecting twice must not double-register
  window.__outreachAiLoaded = true;

  const PP = window.ProfileParse;

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.action === 'ping') { sendResponse({ ok: true }); return; }
    if (msg && msg.action === 'scrapeProfile') {
      scrapeWithScroll()
        .then(profile => sendResponse({ success: true, data: profile }))
        .catch(err => sendResponse({ success: false, error: (err && err.message) || 'Scrape failed.' }));
      return true;
    }
  });

  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const jump = (y) => window.scrollTo({ top: y, behavior: 'instant' });

  // LinkedIn lazy-renders lower sections; nudge the page, then put the user back where they were.
  async function scrapeWithScroll() {
    const startY = window.scrollY;
    try {
      for (const y of [800, 1600, 2400]) { jump(y); await wait(450); }
    } finally {
      jump(startY);
    }
    return scrapeProfile();
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
      const out = [];
      leafLines(sec).forEach(t => {
        if (t.length > 40 && t.length < 500 &&
            !/dialog|window|escape|cancel|close|beginning|notifications|premium|people you may|you might/i.test(t) &&
            !out.includes(t)) out.push(t);
      });
      return out.slice(0, 3);
    }, [], warnings);

    const profile = PP.buildProfile({ name, headline, location, about, experience, education, skills, recentPosts, profileUrl: url, warnings });
    profile.rawTitle = document.title;
    return profile;
  }
})();
