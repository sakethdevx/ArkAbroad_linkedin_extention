'use strict';

// pagecomposer.js — the card that appears INSIDE LinkedIn's note box, so you can draft without opening the side panel.
// It runs in the LinkedIn tab (content-script world; the page's own scripts cannot see it) and only ever:
//   • reads the profile you are looking at, on this device, when a note box opens;
//   • asks the background worker for drafts (free drafts are made on this device; the AI button is a separate, labelled click);
//   • types a draft into the box when YOU press "Use this draft".
// It never clicks anything on the page: not Send, not Cancel, not "Add a note". You read the text and press Send yourself.
// Messages it may send to the background worker: scrapeProfile, pageState, generateMessage, openPanel, BUILD_PROMPT, FINISH_DRAFTS (nothing else).
// The engine is the best one the user switched on: their AI (AI mode) → Chrome's on-device AI (Free mode + Free+) → free drafts, which are always the fallback.
//   PageComposer.factory(win, deps) → (box, ctl) => ui      (deps are injectable so this can be tested without LinkedIn)

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PageComposer = api;
})(typeof self !== 'undefined' ? self : this, function () {

  const PURPOSES = ['Networking', 'Job', 'Referral', 'Collaboration'];
  const TONES = ['Casual', 'Neutral', 'Formal'];
  const HOOK_WORD = { school: 'shared school', employer: 'shared employer', skills: 'shared skills', city: 'shared city', post: 'their recent post', role: 'their role' };

  const CSS = `
    :host { all: initial; display: block; font-family: -apple-system, system-ui, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
    * { box-sizing: border-box; }
    .card { container-type: inline-size; background: #f5f8ff; border: 1px solid #c9d6f5; border-radius: 12px; padding: 10px 14px 10px; color: #1b1f23; font-size: 13px; line-height: 1.45; }
    header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .logo { width: 22px; height: 22px; border-radius: 7px; background: #1a56db; color: #fff; display: grid; place-items: center; font-size: 12px; flex: none; }
    .title { font-weight: 700; font-size: 13px; }
    .for { color: #4b5563; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
    .grow { flex: 1; }
    button { font: inherit; cursor: pointer; }
    .link, .x { border: 0; background: none; color: #1a56db; font-size: 12px; padding: 4px 6px; border-radius: 6px; }
    .x { color: #4b5563; font-size: 14px; line-height: 1; }
    .link:hover, .x:hover { background: #e3ebff; }
    button:focus-visible { outline: 2px solid #1a56db; outline-offset: 2px; }
    .row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; flex-wrap: wrap; }
    .lbl { width: 40px; font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: #5b6472; flex: none; }
    .seg { display: flex; gap: 6px; flex-wrap: wrap; }
    .chip { border: 1px solid #b7c6ee; background: #fff; color: #1f3a8a; border-radius: 999px; padding: 4px 11px; font-size: 12px; font-weight: 600; transition: background .12s, color .12s; }
    .chip:hover { background: #eaf0ff; }
    .chip[aria-pressed="true"] { background: #1a56db; border-color: #1a56db; color: #fff; }
    .tabs { display: flex; gap: 6px; margin: 8px 0 6px; flex-wrap: wrap; }
    .tab { border: 0; background: transparent; color: #4b5563; border-radius: 8px; padding: 4px 10px; font-size: 12px; font-weight: 600; }
    .tab[aria-selected="true"] { background: #fff; color: #1a56db; box-shadow: 0 0 0 1px #c9d6f5; }
    .draft { background: #fff; border: 1px solid #d7e0f7; border-radius: 10px; padding: 10px 12px; max-height: 132px; overflow: auto; white-space: pre-wrap; word-break: break-word; font-size: 13.5px; line-height: 1.5; animation: pop .18s ease-out; }
    .meta { display: flex; justify-content: space-between; gap: 10px; align-items: baseline; margin: 6px 2px 0; font-size: 11.5px; color: #5b6472; flex-wrap: wrap; }
    .count.over { color: #b42318; font-weight: 700; }
    .count.ok::after { content: ' ✓'; color: #137333; }
    .note { margin: 6px 2px 0; font-size: 12px; color: #374151; }
    .note.warn { color: #9a3412; }
    .note.ok { color: #137333; }
    .actions { display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
    .primary { background: #1a56db; color: #fff; border: 1px solid #1a56db; border-radius: 999px; padding: 8px 18px; font-weight: 700; font-size: 13px; }
    .primary:hover { background: #1747b5; }
    .primary[disabled] { opacity: .5; cursor: not-allowed; }
    .ghost { background: #fff; color: #1a56db; border: 1px solid #b7c6ee; border-radius: 999px; padding: 8px 14px; font-weight: 600; font-size: 13px; }
    .ghost:hover { background: #eaf0ff; }
    .ghost[disabled] { opacity: .5; cursor: progress; }
    .foot { margin: 8px 2px 0; font-size: 11.5px; color: #5b6472; }
    .skel { display: grid; gap: 8px; padding: 4px 0 2px; }
    .bar { height: 12px; border-radius: 6px; background: linear-gradient(90deg, #e3e9f8 25%, #f2f5fd 50%, #e3e9f8 75%); background-size: 200% 100%; animation: shimmer 1.2s linear infinite; }
    .bar:nth-child(1) { width: 92%; } .bar:nth-child(2) { width: 78%; } .bar:nth-child(3) { width: 55%; }
    .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
    @keyframes shimmer { to { background-position: -200% 0; } }
    @keyframes pop { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }
    @media (prefers-reduced-motion: reduce) { .bar, .draft { animation: none; } .chip { transition: none; } }
    @container (max-width: 420px) { .lbl { width: 100%; } .actions > button { flex: 1 1 100%; } .primary { order: -1; } }`;

  function factory(win, deps) {
    const D = deps;
    const doc = win.document;
    const profileCache = new Map();   // profile address → the read profile (so a second box on the same page is instant)
    const el = (tag, attrs = {}, kids = []) => {
      const e = doc.createElement(tag);
      for (const [k, v] of Object.entries(attrs)) { if (k === 'text') e.textContent = v; else if (k === 'class') e.className = v; else e.setAttribute(k, v); }
      [].concat(kids).forEach(c => c && e.appendChild(c));
      return e;
    };
    let lastSendError = '';   // why the last message to the background failed (shown instead of a vague error)
    const STALE = /context invalidated|receiving end does not exist|message port closed/i;
    const send = (msg) => new Promise(res => {
      lastSendError = '';
      try {
        D.chrome.runtime.sendMessage(msg, (r) => {
          try { if (D.chrome.runtime.lastError) lastSendError = String(D.chrome.runtime.lastError.message || ''); } catch (e) { lastSendError = String((e && e.message) || 'Extension context invalidated'); }
          res(r || null);
        });
      } catch (e) { lastSendError = String((e && e.message) || 'Extension context invalidated'); res(null); }
    });
    const getStored = () => new Promise(res => { try { D.chrome.storage.local.get(['userName', 'userBio', 'senderProfile', 'prefs', 'onDevice'], r => res(r || {})); } catch (_) { res({}); } });
    const setPrefs = (patch) => { try { D.chrome.storage.local.get(['prefs'], r => D.chrome.storage.local.set({ prefs: { ...((r && r.prefs) || {}), ...patch } })); } catch (_) { /* a convenience */ } };

    const because = (b) => {
      const bits = [];
      if (b && b.hook && b.hook.kind && HOOK_WORD[b.hook.kind]) bits.push(b.hook.kind === 'post' || b.hook.kind === 'role' ? HOOK_WORD[b.hook.kind] : `${HOOK_WORD[b.hook.kind]} ${b.hook.label}`);
      const c = b && b.credential;
      if (c && c.kind === 'spotlight') bits.push(`your work “${c.label}”`); else if (c && c.kind === 'intro') bits.push('your intro');
      return bits.join(' · ');
    };

    return function mount(box, ctl) {
      const host = doc.createElement('div');
      host.setAttribute('data-outreach-fill', '');
      host.setAttribute('data-outreach-composer', '');
      // spacing set inline (and !important) because LinkedIn's own CSS can reset margins on any div, and it must keep a clear gap
      // from the text above and the box below
      [['display', 'block'], ['margin', '12px 0 16px'], ['clear', 'both']].forEach(([k, v]) => host.style.setProperty(k, v, 'important'));
      const shadow = host.attachShadow({ mode: 'open' });
      const anchor = box.kind === 'textarea' ? (box.el.closest('.relative') || box.el) : (box.el.parentElement || box.el);
      anchor.insertAdjacentElement('beforebegin', host);

      const S = { phase: 'loading', box, format: box.kind === 'textarea' ? 'note' : 'message', purpose: 'Networking', tone: 'Neutral', seed: 0, drafts: [], sel: 0,
        profile: null, sender: null, stored: {}, shared: null, ai: null, aiBusy: false, aiNote: '', engine: 'free', preferFree: false, polishing: false, odStatus: '', loadingNote: '', status: '', statusKind: '', token: 0, lastFilled: '', confirm: false, hidden: false, panelDraft: '' };
      const ui = { host, box, smart: true };

      const root = el('div', { class: 'card', role: 'group', 'aria-label': 'Outreach AI drafts' });
      shadow.append(el('style', { text: CSS }), root);
      const live = el('div', { class: 'sr', 'aria-live': 'polite' });

      const limit = () => D.limitOf(S.box) || null;
      const current = () => S.drafts[S.sel] || null;

      // ── drawing ──
      function chips(label, values, active, onPick) {
        const seg = el('div', { class: 'seg', role: 'group', 'aria-label': label });
        values.forEach(v => {
          const b = el('button', { class: 'chip', type: 'button', 'aria-pressed': String(v === active), text: v === 'Collaboration' ? 'Collaborate' : v });
          b.addEventListener('click', () => onPick(v));
          seg.appendChild(b);
        });
        return el('div', { class: 'row' }, [el('span', { class: 'lbl', text: label }), seg]);
      }

      function draw() {
        host.hidden = S.hidden;
        root.textContent = '';
        const first = (S.profile && (S.profile.firstName || (S.profile.name || '').split(/\s+/)[0])) || '';
        const head = el('header', {}, [
          el('span', { class: 'logo', 'aria-hidden': 'true', text: '✦' }), el('span', { class: 'title', text: 'Outreach AI' }),
          first ? el('span', { class: 'for', text: `for ${first}` }) : null, el('span', { class: 'grow' })]);
        const panelBtn = el('button', { class: 'link', type: 'button', text: 'Panel ↗', title: 'Open the full side panel' });
        panelBtn.addEventListener('click', () => { send({ action: 'openPanel' }); });
        const closeBtn = el('button', { class: 'x', type: 'button', 'aria-label': 'Hide Outreach AI for this box', title: 'Hide', text: '✕' });
        closeBtn.addEventListener('click', () => { S.hidden = true; host.hidden = true; });
        head.append(panelBtn, closeBtn);
        root.appendChild(head);

        if (S.phase === 'loading') {
          root.append(el('div', { class: 'skel', 'aria-hidden': 'true' }, [el('div', { class: 'bar' }), el('div', { class: 'bar' }), el('div', { class: 'bar' })]),
            el('p', { class: 'foot', text: S.loadingNote || (first ? `Reading ${first}’s profile on this device…` : 'Reading this profile on this device…') }), live);
          return;
        }

        root.appendChild(chips('Goal', PURPOSES, S.purpose, (v) => { S.purpose = v; setPrefs({ messageType: v }); regenerate(); }));
        root.appendChild(chips('Tone', TONES, S.tone, (v) => { S.tone = v; setPrefs({ tone: v }); regenerate(); }));

        if (S.phase === 'error') {
          root.appendChild(el('p', { class: 'note warn', text: S.error || 'I couldn’t read this profile here.' }));
          const retry = el('button', { class: 'ghost', type: 'button', text: 'Try again' });
          retry.addEventListener('click', () => start(true));
          const row = el('div', { class: 'actions' }, [retry]);
          if (S.stale) {   // the extension was reloaded or updated while this page stayed open: only a page refresh reconnects it
            const reload = el('button', { class: 'primary', type: 'button', text: 'Refresh this page' });
            reload.addEventListener('click', () => { try { win.location.reload(); } catch (_) { /* nothing more to do */ } });
            row.insertBefore(reload, retry);
          }
          root.appendChild(row);
          if (S.panelDraft) drawPanelDraft();
          root.appendChild(live);
          return;
        }

        const list = S.drafts;
        const tabs = el('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Drafts' });
        list.forEach((d, i) => {
          const t = el('button', { class: 'tab', type: 'button', role: 'tab', 'aria-selected': String(i === S.sel), text: d.label || String(i + 1) });
          t.addEventListener('click', () => { S.sel = i; S.confirm = false; draw(); });
          tabs.appendChild(t);
        });
        root.appendChild(tabs);

        const d = current();
        const body = el('div', { class: 'draft', role: 'tabpanel', tabindex: '0', text: d ? d.text : '' });
        root.appendChild(body);
        const lim = limit();
        const n = d ? d.text.length : 0;
        const over = !!lim && n > lim;
        const meta = el('div', { class: 'meta' }, [
          el('span', { class: `count ${over ? 'over' : 'ok'}`, text: lim ? `${n} / ${lim}` : `${n} characters` }),
          el('span', { text: d && d.src ? d.src : '' })]);
        root.appendChild(meta);

        const move = S.profile && D.Approach ? D.Approach.approach({ isConnection: S.profile.isConnection, overlaps: (S.shared && S.shared.overlaps) || [], recentPosts: S.profile.recentPosts, purpose: S.purpose }) : null;
        if (move) root.appendChild(el('p', { class: 'note', text: move.split(' In one vendor dataset')[0], title: move }));   // the statistic stays in the tooltip: the card is already tall
        if (over) root.appendChild(el('p', { class: 'note warn', text: `This draft is ${n} characters; the box allows ${lim}. Pick another, or press New ideas.` }));
        else if (S.status) root.appendChild(el('p', { class: `note ${S.statusKind}`, text: S.status }));
        if (S.aiNote) root.appendChild(el('p', { class: 'note warn', text: S.aiNote }));

        const use = el('button', { class: 'primary', type: 'button', text: S.lastFilled && d && S.lastFilled === d.text ? 'Used ✓ · Use again' : 'Use this draft' });
        if (!d || over) use.disabled = true;   // an over-long draft is never typed in, and never cut
        use.addEventListener('click', onUse);
        const actions = el('div', { class: 'actions' }, [use]);
        const more = el('button', { class: 'ghost', type: 'button', text: 'New ideas ↻' });
        more.addEventListener('click', () => { S.seed += 3; regenerate(); });
        actions.appendChild(more);
        if (S.engine !== 'free') {   // the smart engine runs by itself; this switches it off or on for this box
          const label = S.preferFree ? (S.engine === 'ai' ? `✨ Use ${S.stored.ai.name} again` : '✨ Polish on this device') : 'Free drafts instead';
          const sw = el('button', { class: 'ghost', type: 'button', text: label, title: S.engine === 'ai' ? `AI drafts send a short summary of this profile and your details to ${S.stored.ai.host}. Free drafts stay on this device.` : 'On-device AI runs inside Chrome; nothing leaves this computer.' });
          sw.addEventListener('click', () => { S.preferFree = !S.preferFree; regenerate(true); });
          actions.appendChild(sw);
        }
        root.appendChild(actions);

        const tip = !S.sender ? ' Tip: add your resume in the Outreach AI panel for sharper drafts.' : '';
        let lead = 'Free drafts are made on this device. ';
        if (d && d.source === 'ai') lead = `Written by ${S.stored.ai ? S.stored.ai.name : 'AI'} from a short summary of this profile. `;
        else if (d && d.source === 'ondevice') lead = 'Polished on this device by Chrome’s built-in AI; nothing left your computer. ';
        else if (S.polishing) lead = 'Free draft ready. Polishing it on this device… ';
        else if (S.odWanted && S.engine === 'free' && S.odStatus !== 'available') lead = 'Free drafts. On-device AI is on, but Chrome does not offer it to this page. ';
        root.appendChild(el('p', { class: 'foot', text: lead + 'You press Send yourself.' + tip }));
        root.appendChild(live);
      }

      function drawPanelDraft() {
        const t = el('div', { class: 'draft', text: S.panelDraft });
        const use = el('button', { class: 'primary', type: 'button', text: 'Use the panel draft' });
        use.addEventListener('click', () => doFill(S.panelDraft));
        root.append(el('p', { class: 'note', text: 'Your draft from the side panel:' }), t, el('div', { class: 'actions' }, [use]));
      }

      const announce = (t) => { live.textContent = ''; setTimeout(() => { live.textContent = t; }, 30); };

      // ── actions ──
      function doFill(text) {
        const lim = limit();
        if (lim && text.length > lim) { S.status = `This draft is ${text.length} characters; the box allows ${lim}. Pick a shorter one or press New ideas.`; S.statusKind = 'warn'; draw(); return; }
        const existing = D.currentText(S.box).trim();
        if (existing && existing !== S.lastFilled.trim() && !S.confirm) {
          S.confirm = true; S.status = 'There is already text in the box. Press the button again to replace it.'; S.statusKind = 'warn'; draw(); return;
        }
        D.fillBox(S.box, text, win);
        S.lastFilled = text; S.confirm = false; S.status = 'Filled. Read it, edit it if you like, then press Send yourself.'; S.statusKind = 'ok';
        remember(text);
        draw(); announce(S.status);
      }

      function onUse() { const d = current(); if (d) doFill(d.text); }

      function remember(text) {
        try {
          if (!D.Cache || !S.profile) return;
          D.Cache.addContact({ profileUrl: S.profile.profileUrl || String(win.location.href).split('?')[0], name: S.profile.name || 'Unknown', headline: S.profile.headline || '', company: S.profile.currentCompany || '', message: text, timestamp: Date.now() });
        } catch (_) { /* history is a convenience */ }
      }

      function applyResp(resp, source) {
        const vs = resp && resp.variants && resp.variants.length ? resp.variants : null;
        if (!vs) return false;
        S.drafts = vs.slice(0, 3).map((v, i) => ({ text: v.text, source: v.source, label: String(i + 1), src: v.source === 'ai' ? 'Written by AI' : v.source === 'ondevice' ? 'Polished on this device' : (v.because ? `Built on: ${because(v.because)}` : '') }));
        if (S.panelDraft) S.drafts.push({ text: S.panelDraft, source: 'panel', label: 'Panel', src: 'From your side panel' });
        S.sel = 0; S.confirm = false;
        return true;
      }

      let regenTimer = null;
      const smart = () => S.engine === 'ai' && !S.preferFree;
      // a free draft is instant (120 ms); an AI request costs something, so a quick run of clicks is sent once
      function regenerate(now) {
        S.status = ''; S.aiNote = ''; clearTimeout(regenTimer);
        S.phase = 'loading'; S.loadingNote = smart() ? `Writing with ${S.stored.ai.name} from a short summary…` : '';
        regenTimer = setTimeout(generate, now ? 0 : (smart() ? 450 : 120));
        draw();
      }

      const dataFor = (forceFree) => D.Request.generateData({ profile: S.profile, settings: S.stored, purpose: S.purpose, tone: S.tone, format: S.format, seed: S.seed, shared: S.shared, forceFree });

      // Best output the user has chosen: their AI (AI mode) → on-device AI (Free mode + Free+) → free drafts. Free drafts are always the fallback.
      async function generate() {
        const my = ++S.token;
        S.polishing = false; S.loadingNote = smart() ? `Writing with ${S.stored.ai.name} from a short summary…` : '';
        S.shared = D.Request.shared(S.sender, S.profile);
        if (S.phase === 'loading') draw();   // say which engine is working ("Writing with Groq…")
        const data = dataFor(!smart());
        const resp = await send({ action: 'generateMessage', data });
        if (my !== S.token) return;   // a newer choice replaced this one
        if (!applyResp(resp, 'free')) { S.phase = 'error'; S.error = 'I couldn’t write drafts just now.'; draw(); return; }
        S.phase = 'ready'; S.loadingNote = '';
        if (smart() && !(resp.source === 'ai')) S.aiNote = resp.aiError ? `${resp.aiError} Showing free drafts.` : 'AI didn’t answer this time. Showing free drafts.';
        const polish = S.engine === 'ondevice' && !S.preferFree && resp.source === 'template';
        S.polishing = polish;
        draw(); announce(`${S.drafts.length} drafts ready`);
        if (polish) polishLocal(my, dataFor(false));
      }

      // on-device AI (Chrome's built-in model) polishes the instant free drafts in place; any failure keeps the free ones
      async function polishLocal(my, data) {
        const done = () => { if (my === S.token) { S.polishing = false; draw(); } };
        const built = await send({ type: 'BUILD_PROMPT', payload: data });
        if (my !== S.token) return;
        if (!built || !built.success) return done();
        const raw = await D.OnDevice.polish({ system: built.system, user: built.user, schema: built.schema }, { timeoutMs: 25000 });
        if (my !== S.token) return;
        if (!raw) return done();
        const fin = await send({ type: 'FINISH_DRAFTS', payload: { data, raw } });
        if (my !== S.token) return;
        if (!fin || !fin.success || !fin.polished) return done();
        const keep = S.sel;
        applyResp(fin, 'ondevice');
        if (keep < S.drafts.length) S.sel = keep;
        S.polishing = false; draw(); announce('Polished on this device');
      }

      async function start(force) {
        S.phase = 'loading'; draw();
        S.stale = false;
        const stored = await getStored();
        const page = await send({ action: 'pageState' });
        if (!page && STALE.test(lastSendError)) { S.phase = 'error'; S.stale = true; S.error = 'Outreach AI was just reloaded or updated. Refresh this LinkedIn page to reconnect.'; draw(); return; }
        S.stored = { userName: stored.userName || '', userBio: stored.userBio || '',
          ai: page && page.success && page.aiReady ? { ready: true, name: page.providerName, host: page.host } : null };
        S.odWanted = !!stored.onDevice;
        S.odStatus = S.odWanted && D.OnDevice ? await D.OnDevice.status() : 'unsupported';
        S.engine = S.stored.ai ? 'ai' : (S.odStatus === 'available' ? 'ondevice' : 'free');
        S.sender = stored.senderProfile && D.Request.hasResumeInfo(stored.senderProfile) ? stored.senderProfile : null;
        S.senderRaw = stored.senderProfile || null;
        const prefs = stored.prefs || {};
        if (PURPOSES.includes(prefs.messageType)) S.purpose = prefs.messageType;
        if (TONES.includes(prefs.tone)) S.tone = prefs.tone;

        const key = String(win.location.pathname);
        let profile = !force && profileCache.get(key);
        if (!profile) {
          const r = await send({ action: 'scrapeProfile' });
          if (!r || !r.success || !r.data) {
            S.phase = 'error';
            S.stale = !r && STALE.test(lastSendError);
            S.error = S.stale ? 'Outreach AI was just reloaded or updated. Refresh this LinkedIn page to reconnect.'
              : (r && r.error) || `I couldn’t read this profile here${lastSendError ? ' (' + lastSendError + ')' : ''}. You can still use the Outreach AI side panel.`;
            draw(); return;
          }
          profile = r.data; profileCache.set(key, profile);
        }
        S.profile = profile;
        await generate();
      }

      ui.onPanelDraft = (d) => {
        S.panelDraft = d && d.text ? d.text : '';
        S.drafts = S.drafts.filter(x => x.source !== 'panel');
        if (S.panelDraft && S.phase === 'ready') S.drafts.push({ text: S.panelDraft, source: 'panel', label: 'Panel', src: 'From your side panel' });
        if (S.sel >= S.drafts.length) S.sel = 0;
        if (S.phase !== 'loading') draw();
      };
      ui.destroy = () => { clearTimeout(regenTimer); S.token++; host.remove(); };
      ui.refreshBox = (b) => { S.box = b; };

      draw();
      start(false);
      return ui;
    };
  }

  return { factory, PURPOSES, TONES };
});
