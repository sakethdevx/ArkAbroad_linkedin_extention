'use strict';

// jobwatch.js — runs inside a LinkedIn tab and, while you look at a job on LinkedIn Jobs, shows the "Job fit" card above its description.
//   • It only READS the page (utils/jobscrape.js) and draws its own card (utils/jobcard.js). It never clicks Apply, Easy Apply, Save,
//     Dismiss or anything else, and it never types into the page.
//   • The posting goes to this extension's background worker, which compares it with your profile on the device and answers. Nothing leaves
//     your computer. Your resume and profile are read by the worker, not by this script.
//   • LinkedIn is a single-page app, so it watches for the job changing (URL or page changes) and updates the card.
//   • Inert on every page except /jobs/…; the setting "On job pages" (Settings) can turn it off.
// Messages it may send to the background worker: analyzeJob, openPanel (nothing else).

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.JobWatch = api; api.start(root); }
})(typeof self !== 'undefined' ? self : this, function () {

  const VERSION = 'jobwatch-1';
  const STALE = /context invalidated|receiving end does not exist|message port closed/i;
  const log = (...a) => { try { console.info('[Outreach AI]', ...a); } catch (_) { /* no console */ } };

  function create(win, deps) {
    const { JobScrape, JobCard } = deps;
    const doc = win.document;
    const st = { mode: 'card', key: '', ui: null, timer: null, mo: null, poll: null, token: 0, fails: 0, lastHref: '', anchorEl: null };
    let lastSendError = '';
    const send = (msg) => new Promise(res => {
      lastSendError = '';
      try {
        deps.chrome.runtime.sendMessage(msg, (r) => {
          try { if (deps.chrome.runtime.lastError) lastSendError = String(deps.chrome.runtime.lastError.message || ''); } catch (e) { lastSendError = String((e && e.message) || 'Extension context invalidated'); }
          res(r || null);
        });
      } catch (e) { lastSendError = String((e && e.message) || 'Extension context invalidated'); res(null); }
    });

    const onJobs = () => /^\/jobs(\/|$)/.test(win.location.pathname);

    function removeUi() { if (st.ui) { st.ui.remove(); st.ui = null; } st.key = ''; st.anchorEl = null; }

    // Where the card goes: right under the top card (title, place, chips, Apply / Save) and above LinkedIn's own boxes (Premium match, "how you
    // compare", "people you can reach out to"), so it is on screen without scrolling. The top card is found by what it CONTAINS, not by LinkedIn's
    // class names: start at the title and climb to the largest block that does not yet include the description or one of LinkedIn's own boxes.
    // The card always goes in the normal flow of the page, never in a sticky or fixed header (a tall card there would take over the screen and
    // block scrolling). If nothing is recognised it goes just above the description text.
    const OTHER_BOXES = /\bpremium\b|job match is|see how you compare|about the job|meet the hiring team|people you can reach out to|show match details|tailor my resume|help me stand out/i;
    const isPinned = (n) => { try { const p = win.getComputedStyle(n).position; return p === 'sticky' || p === 'fixed'; } catch (_) { return false; } };
    function topBlock(start, desc) {
      let top = start, pinned = isPinned(start);
      for (let i = 0; i < 14; i++) {
        const p = top.parentElement;
        if (!p || p === win.document.body || p.contains(desc) || OTHER_BOXES.test(p.textContent || '')) break;
        top = p;
        if (isPinned(top)) pinned = true;
      }
      return pinned ? null : top;
    }
    function place(s) {
      const el = s.el;
      if (!el || !el.parentNode) return;
      for (const t of s.titleEls || []) {
        if (t.contains(el) || el.contains(t)) continue;
        const top = topBlock(t, el);
        if (top && top !== el && !top.contains(el) && !el.contains(top) && top.parentNode) { top.insertAdjacentElement('afterend', st.ui.host); st.anchorEl = top; return; }
      }
      if (/^(SECTION|ARTICLE)$/.test(el.tagName)) el.insertBefore(st.ui.host, el.children[1] || el.firstChild);   // after its "About the job" heading
      else el.insertAdjacentElement('beforebegin', st.ui.host);
      st.anchorEl = el;
    }

    // Match the width of LinkedIn's own boxes. LinkedIn's cards sit inside side padding that the card's parent does not have, so left alone the
    // card would be wider than the Premium box right below it. Measure the neighbouring card (the first bordered or shadowed box in the
    // block after ours, else in the block before) and use its left and right edges.
    const cardLike = (n) => { try { const c = win.getComputedStyle(n); const r = n.getBoundingClientRect(); return r.width > 200 && r.height > 50 && ((c.borderTopStyle && c.borderTopStyle !== 'none' && parseFloat(c.borderTopWidth) > 0) || (c.boxShadow && c.boxShadow !== 'none')); } catch (_) { return false; } };
    function referenceBox(from) {
      const queue = [from]; let seen = 0;
      while (queue.length && seen < 250) {
        const n = queue.shift(); seen++;
        if (n.nodeType === 1 && n !== from && cardLike(n)) return n;
        if (n.children) for (const c of n.children) queue.push(c);
      }
      return null;
    }
    function align() {
      const host = st.ui && st.ui.host;
      if (!host || !host.isConnected) return;
      try {
        const set = (l, r) => { host.style.setProperty('margin-left', l + 'px', 'important'); host.style.setProperty('margin-right', r + 'px', 'important'); };
        set(0, 0);
        const own = host.getBoundingClientRect();
        if (!own.width) return;   // not laid out (or not a real browser): leave the default
        const ref = (host.nextElementSibling && referenceBox(host.nextElementSibling)) || (host.previousElementSibling && referenceBox(host.previousElementSibling));
        if (!ref) return;
        const rr = ref.getBoundingClientRect();
        const l = Math.round(rr.left - own.left), r = Math.round(own.right - rr.right);
        if (l >= 0 && r >= 0 && l + r < own.width / 2) set(l, r);
      } catch (_) { /* the default width is fine */ }
    }
    const alignSoon = () => { [60, 400, 1500].forEach(ms => setTimeout(align, ms)); };   // LinkedIn lays its own boxes out a little later

    async function check(s, token) {
      const r = await send({ action: 'analyzeJob', job: s.job });
      if (token !== st.token || !st.ui) return;
      if (!r && STALE.test(lastSendError)) { st.ui.render({ phase: 'stale' }); return; }
      if (r && r.success) st.ui.render({ phase: 'result', data: r });
      else st.ui.render({ phase: 'error', message: (r && r.error) || 'I could not check this job. Nothing was changed.' });
    }

    function tick() {
      if (st.mode === 'off' || !onJobs()) { removeUi(); st.fails = 0; return; }
      const s = JobScrape.scrape(doc, win.location);
      if (!s.ok) {
        // a search page with no job picked yet has no description: say nothing. A job we were asked to open but cannot read: say so, after a few tries.
        if (!s.key) { removeUi(); st.fails = 0; return; }
        if (++st.fails >= 3 && (!st.ui || st.key !== 'unreadable:' + s.key)) {
          removeUi();
          const pane = doc.querySelector('.jobs-search__job-details--container, .job-view-layout');   // only a known job pane: never guess a spot
          if (pane) { st.ui = JobCard.create(win, { onPanel: () => send({ action: 'openPanel' }) }); pane.insertAdjacentElement('afterbegin', st.ui.host); st.key = 'unreadable:' + s.key; st.ui.render({ phase: 'unreadable', reason: s.reason }); }
        }
        return;
      }
      st.fails = 0;
      const key = s.key + ':' + Math.round(s.job.description.length / 200);
      if (st.ui && st.key === key) {   // same job: just put the card back if LinkedIn redrew the page without it
        if (!st.ui.host.isConnected) { place(s); alignSoon(); } else align();
        return;
      }
      removeUi();
      st.key = key;
      st.ui = JobCard.create(win, { onPanel: () => send({ action: 'openPanel' }) });
      place(s);
      alignSoon();
      st.ui.render({ phase: 'loading' });
      check(s, ++st.token);
    }

    const schedule = (ms = 500) => { clearTimeout(st.timer); st.timer = setTimeout(() => { try { tick(); } catch (e) { log('job fit paused:', String((e && e.message) || e)); } }, ms); };

    const ctl = {
      state: st,
      tick, align,
      setMode(mode) { st.mode = mode === 'off' ? 'off' : 'card'; if (st.mode === 'off') removeUi(); else schedule(50); },
      watch() {
        if (st.mo || !win.MutationObserver) return;
        st.mo = new win.MutationObserver((muts) => {
          if (st.ui && muts.every(m => st.ui.host.contains(m.target) || m.target === st.ui.host)) return;
          schedule(600);
        });
        st.mo.observe(doc.documentElement, { childList: true, subtree: true });
        win.addEventListener('resize', () => schedule(250));
        st.poll = win.setInterval(() => { if (win.location.href !== st.lastHref) { st.lastHref = win.location.href; schedule(300); } }, 1000);
        schedule(300);
      },
      destroy() { clearTimeout(st.timer); if (st.mo) st.mo.disconnect(); st.mo = null; if (st.poll) win.clearInterval(st.poll); removeUi(); }
    };
    return ctl;
  }

  function start(win) {
    if (!win || !win.document || !win.chrome || !win.chrome.runtime || !win.chrome.runtime.onMessage || !win.JobScrape || !win.JobCard) return;
    if (win.__outreachJobWatch && win.__outreachJobWatch.version === VERSION) return;
    if (win.__outreachJobWatch) win.__outreachJobWatch.ctl.destroy();
    const ctl = create(win, { chrome: win.chrome, JobScrape: win.JobScrape, JobCard: win.JobCard });
    win.__outreachJobWatch = { version: VERSION, ctl };
    const read = () => { try { win.chrome.storage.local.get(['jobMode'], r => ctl.setMode((r && r.jobMode) === 'off' ? 'off' : 'card')); } catch (_) { ctl.setMode('card'); } };
    read();
    try { win.chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch.jobMode) read(); }); } catch (_) { /* no live updates */ }
    ctl.watch();
    log('job fit helper running (' + VERSION + ')');
  }

  return { VERSION, create, start };
});
