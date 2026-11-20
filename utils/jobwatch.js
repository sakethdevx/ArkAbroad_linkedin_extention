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
    // compare", "people you can reach out to"), so it is on screen without scrolling. It is always in the normal flow of the page, never in a sticky
    // or fixed header (a tall card there would take over the screen and block scrolling). If the layout is not recognised it goes just above the
    // description text instead.
    const isPinned = (n) => { try { const p = win.getComputedStyle(n).position; return p === 'sticky' || p === 'fixed'; } catch (_) { return false; } };
    function column(from, pane) {   // the nearest ancestor that holds the page's sections side by side
      for (let n = from.parentElement, i = 0; n && i < 10; n = n.parentElement, i++) { if (n.children.length >= 4) return n; if (n === pane) break; }
      return null;
    }
    function place(s) {
      const el = s.el;
      if (!el || !el.parentNode) return;
      const col = column(el, s.pane);
      if (col) {
        for (const t of s.titleEls || []) {
          if (!col.contains(t)) continue;
          let top = t, pinned = false;
          for (; top && top.parentElement && top.parentElement !== col; top = top.parentElement) if (isPinned(top)) pinned = true;
          if (top && isPinned(top)) pinned = true;
          if (pinned || !top || top.parentElement !== col || top.contains(el)) continue;   // a sticky copy of the title, or the title is inside the description block
          top.insertAdjacentElement('afterend', st.ui.host); st.anchorEl = top; return;
        }
      }
      if (/^(SECTION|ARTICLE)$/.test(el.tagName)) el.insertBefore(st.ui.host, el.children[1] || el.firstChild);   // after its "About the job" heading
      else el.insertAdjacentElement('beforebegin', st.ui.host);
      st.anchorEl = el;
    }

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
        if (!st.ui.host.isConnected) place(s);
        return;
      }
      removeUi();
      st.key = key;
      st.ui = JobCard.create(win, { onPanel: () => send({ action: 'openPanel' }) });
      place(s);
      st.ui.render({ phase: 'loading' });
      check(s, ++st.token);
    }

    const schedule = (ms = 500) => { clearTimeout(st.timer); st.timer = setTimeout(() => { try { tick(); } catch (e) { log('job fit paused:', String((e && e.message) || e)); } }, ms); };

    const ctl = {
      state: st,
      tick,
      setMode(mode) { st.mode = mode === 'off' ? 'off' : 'card'; if (st.mode === 'off') removeUi(); else schedule(50); },
      watch() {
        if (st.mo || !win.MutationObserver) return;
        st.mo = new win.MutationObserver((muts) => {
          if (st.ui && muts.every(m => st.ui.host.contains(m.target) || m.target === st.ui.host)) return;
          schedule(600);
        });
        st.mo.observe(doc.documentElement, { childList: true, subtree: true });
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
