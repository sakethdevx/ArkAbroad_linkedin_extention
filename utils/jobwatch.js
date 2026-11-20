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

    // the card goes just above the "About the job" section, so it is the first thing read under the title
    function anchorFor(s) {
      let a = s.el;
      for (let i = 0; i < 4 && a && a.parentElement && a.parentElement !== s.pane; i++) {
        if (/^(SECTION|ARTICLE)$/.test(a.tagName) || /(?:^|\s)jobs-description(?:\s|$)/.test(a.className || '')) break;
        a = a.parentElement;
      }
      return a || s.el;
    }
    function place(anchor) { if (anchor && anchor.parentNode) anchor.insertAdjacentElement('beforebegin', st.ui.host); st.anchorEl = anchor; }

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
          const pane = doc.querySelector('.jobs-search__job-details--container, .job-view-layout, main');
          if (pane) { st.ui = JobCard.create(win, { onPanel: () => send({ action: 'openPanel' }) }); pane.insertAdjacentElement('afterbegin', st.ui.host); st.key = 'unreadable:' + s.key; st.ui.render({ phase: 'unreadable', reason: s.reason }); }
        }
        return;
      }
      st.fails = 0;
      const key = s.key + ':' + Math.round(s.job.description.length / 200);
      if (st.ui && st.key === key) {   // same job: just put the card back if LinkedIn redrew the page without it
        if (!st.ui.host.isConnected) place(anchorFor(s));
        return;
      }
      removeUi();
      st.key = key;
      st.ui = JobCard.create(win, { onPanel: () => send({ action: 'openPanel' }) });
      place(anchorFor(s));
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
