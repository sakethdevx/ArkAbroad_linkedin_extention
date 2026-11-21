'use strict';

// jobcard.js — the "Job fit" card that appears on a LinkedIn job, above the description. Pure drawing: it receives a result
// (from utils/jobfit.js via the background worker) and shows it. It has no buttons that act on LinkedIn: it never clicks Apply,
// Easy Apply, Save or anything else on the page. Its only controls are its own (collapse, hide, "How is this worked out?", Panel).
//   JobCard.create(win, { onPanel }) → { host, render(state), remove(), setCollapsed(bool) }
//   state = { phase: 'loading' } | { phase: 'result', data: { result, job } } | { phase: 'unreadable', reason } | { phase: 'stale' } | { phase: 'error', message }

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JobCard = api;
})(typeof self !== 'undefined' ? self : this, function () {

  const BAND = { 'Strong fit': 'good', 'Worth applying': 'ok', 'Stretch': 'warn', 'Probably not a fit': 'bad', 'Be careful with this posting': 'bad', 'Add your resume to see your fit': 'none' };
  const ICON = { ok: '✓', check: '!', blocker: '✕', info: 'i' };
  const SR = { ok: 'Fine: ', check: 'Check: ', blocker: 'Likely a problem: ', info: 'Note: ' };

  const CSS = `
    :host { all: initial; display: block; font-family: -apple-system, system-ui, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
    * { box-sizing: border-box; }
    .card { overflow-wrap: anywhere; background: #f5f8ff; border: 1px solid #c9d6f5; border-radius: 12px; padding: 10px 14px 12px; color: #1b1f23; font-size: 13px; line-height: 1.45; }
    header { display: flex; align-items: center; gap: 8px; }
    .logo { width: 22px; height: 22px; border-radius: 7px; background: #1a56db; color: #fff; display: grid; place-items: center; font-size: 12px; flex: none; }
    .title { font-weight: 700; font-size: 13px; }
    .for { color: #4b5563; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
    .grow { flex: 1; }
    button { font: inherit; cursor: pointer; }
    .link, .x { border: 0; background: none; color: #1a56db; font-size: 12px; padding: 4px 6px; border-radius: 6px; }
    .x { color: #4b5563; font-size: 14px; line-height: 1; }
    .link:hover, .x:hover { background: #e3ebff; }
    button:focus-visible { outline: 2px solid #1a56db; outline-offset: 2px; }
    .body { margin-top: 8px; }
    .verdict { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 8px; }
    .pill { flex: none; border-radius: 999px; padding: 4px 12px; font-weight: 700; font-size: 12.5px; border: 1px solid; white-space: nowrap; }
    .pill.good { background: #e6f4ea; color: #137333; border-color: #b7dfc2; }
    .pill.ok { background: #e8f0fe; color: #1a56db; border-color: #b7c6ee; }
    .pill.warn { background: #fef3e2; color: #9a5b00; border-color: #f2d49b; }
    .pill.bad { background: #fde8e8; color: #b42318; border-color: #f3b4ae; }
    .pill.none { background: #eef0f3; color: #4b5563; border-color: #d5d9e0; }
    .reason { margin: 2px 0 0; font-size: 13px; color: #1b1f23; }
    .banner { border-radius: 10px; padding: 8px 10px; margin: 0 0 8px; font-size: 12.5px; background: #fde8e8; color: #7a1d14; border: 1px solid #f3b4ae; }
    .banner strong { display: block; margin-bottom: 2px; }
    .meters { display: grid; gap: 6px; margin: 6px 0 4px; }
    .meter { display: grid; grid-template-columns: 112px 1fr 46px; align-items: center; gap: 8px; font-size: 12px; color: #374151; }
    .bar { height: 8px; border-radius: 999px; background: #e3e8f4; overflow: hidden; }
    .bar > i { display: block; height: 100%; border-radius: 999px; background: #1a56db; }
    .bar > i.good { background: #1e8e3e; } .bar > i.warn { background: #e8a317; } .bar > i.bad { background: #d93025; }
    .val { text-align: right; font-weight: 700; color: #1b1f23; }
    h4 { margin: 12px 0 4px; font-size: 11px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: #5b6472; }
    ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 5px; }
    li.row { display: grid; grid-template-columns: 18px 1fr; gap: 6px; font-size: 12.5px; }
    .ic { width: 16px; height: 16px; border-radius: 50%; display: grid; place-items: center; font-size: 10px; font-weight: 800; color: #fff; margin-top: 1px; }
    .ic.ok { background: #1e8e3e; } .ic.check { background: #e8a317; } .ic.blocker { background: #d93025; } .ic.info { background: #7b8494; }
    .q { display: block; margin-top: 1px; font-size: 11.5px; color: #5b6472; font-style: italic; }
    .chips { display: flex; flex-wrap: wrap; gap: 5px; }
    .chip { border-radius: 999px; padding: 2px 9px; font-size: 11.5px; font-weight: 600; border: 1px solid #b7c6ee; background: #fff; color: #1f3a8a; }
    .chip.have { background: #e6f4ea; border-color: #b7dfc2; color: #137333; }
    .chip.need { background: #fff; border-color: #f3b4ae; color: #b42318; }
    .chip.nice { border-color: #d5d9e0; color: #5b6472; }
    .steps li { font-size: 12.5px; }
    .steps li::before { content: '→ '; color: #1a56db; font-weight: 700; }
    .note { margin: 8px 0 0; font-size: 11.5px; color: #5b6472; }
    .how { margin: 6px 0 0; padding: 8px 10px; background: #fff; border: 1px solid #d7e0f7; border-radius: 8px; font-size: 12px; color: #374151; }
    .foot { margin: 10px 0 0; font-size: 11.5px; color: #5b6472; }
    .skel .b { height: 10px; border-radius: 6px; background: linear-gradient(90deg, #e3e8f4, #f1f4fb, #e3e8f4); background-size: 200% 100%; animation: sh 1.2s linear infinite; margin: 8px 0; }
    @keyframes sh { to { background-position: -200% 0; } }
    @media (prefers-reduced-motion: reduce) { .skel .b { animation: none; } }
    .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
    @media (max-width: 420px) { .meter { grid-template-columns: 88px 1fr 40px; } .verdict { flex-direction: column; gap: 4px; } }
  `;

  function create(win, deps = {}) {
    const doc = win.document;
    const el = (tag, attrs = {}, kids = []) => {
      const n = doc.createElement(tag);
      for (const [k, v] of Object.entries(attrs)) { if (v == null || v === false) continue; if (k === 'text') n.textContent = v; else n.setAttribute(k, v === true ? '' : v); }
      (Array.isArray(kids) ? kids : [kids]).forEach(c => { if (c) n.appendChild(typeof c === 'string' ? doc.createTextNode(c) : c); });
      return n;
    };
    const host = doc.createElement('div');
    host.setAttribute('data-outreach-jobfit', '');
    [['display', 'block'], ['margin', '12px 0 16px'], ['clear', 'both']].forEach(([k, v]) => host.style.setProperty(k, v, 'important'));
    const shadow = host.attachShadow({ mode: 'open' });
    const card = el('div', { class: 'card', role: 'region', 'aria-label': 'Outreach AI job fit' });
    shadow.append(el('style', { text: CSS }), card);

    const S = { state: { phase: 'loading' }, collapsed: false, how: false, hidden: false, details: !!deps.details };

    const meter = (label, pct, text, tone) => el('div', { class: 'meter' }, [
      el('span', { text: label }),
      el('span', { class: 'bar', role: 'img', 'aria-label': `${label}: ${text}` }, [el('i', { class: tone || '', style: `width:${Math.max(3, Math.min(100, pct == null ? 0 : pct))}%` })]),
      el('span', { class: 'val', text })]);
    const tone = (p) => (p >= 75 ? 'good' : p >= 45 ? 'warn' : 'bad');

    function drawResult(data) {
      const r = data.result, job = data.job || {};
      const sk = r.skills || {};
      const wrap = el('div', { class: 'body' });
      const danger = (r.watchouts || []).filter(w => w.severity === 'high');
      if (danger.length) wrap.appendChild(el('div', { class: 'banner', role: 'alert' }, [el('strong', { text: 'Be careful with this posting' }), ...danger.slice(0, 3).map(w => el('div', { text: '• ' + w.text }))]));

      const unsafe = danger.length > 0;
      if (unsafe) {   // a likely scam gets no friendly scores: they would only distract from the warning
        wrap.appendChild(el('div', { class: 'verdict' }, [el('span', { class: 'pill bad', text: r.fit.band })]));
        wrap.appendChild(el('p', { class: 'note', text: 'The fit scores are hidden because this posting looks unsafe. Check who is really hiring before you apply or share anything.' }));
        const rest = (r.watchouts || []).filter(w => w.severity !== 'high');
        if (rest.length) {
          wrap.appendChild(el('h4', { text: 'More watch-outs' }));
          wrap.appendChild(el('ul', {}, rest.map(w => el('li', { class: 'row' }, [el('span', { class: 'ic check', 'aria-hidden': 'true', text: '!' }), el('span', {}, [w.text, w.quote ? el('span', { class: 'q', text: '“' + w.quote + '”' }) : null])]))));
        }
        wrap.appendChild(el('p', { class: 'foot', text: 'Worked out on this device from the posting; nothing was sent anywhere. Outreach AI never clicks Apply or Save for you.' }));
        return wrap;
      }
      wrap.appendChild(el('div', { class: 'verdict' }, [el('span', { class: 'pill ' + (BAND[r.fit.band] || 'none'), text: r.fit.band }), el('p', { class: 'reason', text: r.fit.reason })]));

      if (r.hasProfile) {
        const kw = r.keyword.pct;
        wrap.appendChild(el('div', { class: 'meters' }, [
          meter('Keyword match', kw == null ? 0 : kw, kw == null ? '–' : kw + '%', kw == null ? '' : tone(kw)),
          meter('Level fit', r.level.score, r.level.score >= 75 ? 'Good' : r.level.score >= 45 ? 'Stretch' : 'Low', tone(r.level.score)),
          meter('Eligibility', r.fit.parts.education, r.fit.parts.education >= 75 ? 'Clear' : r.fit.parts.education >= 45 ? 'Check' : 'Issues', tone(r.fit.parts.education))]));
        const howBtn = el('button', { class: 'link', type: 'button', 'aria-expanded': String(S.how), text: 'How is this worked out?' });
        howBtn.addEventListener('click', () => { S.how = !S.how; draw(); });
        wrap.appendChild(howBtn);
        if (S.how) wrap.appendChild(el('div', { class: 'how' }, [
          el('div', { text: r.keyword.formula }),
          el('div', { text: `Overall = skills ${r.fit.parts.skills}% × 55% + level ${r.fit.parts.level}% × 30% + eligibility ${r.fit.parts.education}% × 15%, then capped if something likely rules you out. It is a guide, not a prediction.` })]));
      } else {
        wrap.appendChild(el('p', { class: 'note', text: 'Add your resume in Outreach AI Settings to see your skills and level fit. The checks below come from the posting alone.' }));
      }

      if (!S.details) {   // compact by default: the job page stays readable and scrollable; the rest is one tap away
        const lows0 = (r.watchouts || []).filter(w => w.severity !== 'high');
        const bits = [(r.eligibility || []).length && `${r.eligibility.length} eligibility ${r.eligibility.length === 1 ? 'check' : 'checks'}`, (sk.wanted || []).length && `${sk.wanted.length} ${sk.wanted.length === 1 ? 'skill' : 'skills'}`, lows0.length && `${lows0.length} ${lows0.length === 1 ? 'watch-out' : 'watch-outs'}`].filter(Boolean);
        const more = el('button', { class: 'link more', type: 'button', 'aria-expanded': 'false', text: 'Show details' + (bits.length ? ' · ' + bits.join(' · ') : '') });
        more.addEventListener('click', () => { S.details = true; draw(); });
        wrap.appendChild(more);
        if ((r.insights || []).length) wrap.appendChild(el('p', { class: 'note', text: r.insights.join(' ') }));
        wrap.appendChild(el('p', { class: 'foot', text: 'Worked out on this device; nothing was sent anywhere. Outreach AI never clicks Apply or Save for you.' }));
        return wrap;
      }

      if ((r.eligibility || []).length) {
        wrap.appendChild(el('h4', { text: 'Eligibility check' }));
        wrap.appendChild(el('ul', {}, r.eligibility.map(e => el('li', { class: 'row' }, [
          el('span', { class: 'ic ' + e.status, 'aria-hidden': 'true', text: ICON[e.status] || 'i' }),
          el('span', {}, [el('span', { class: 'sr', text: SR[e.status] || '' }), e.label, e.quote ? el('span', { class: 'q', text: '“' + e.quote + '”' }) : null])]))));
      }

      if ((sk.wanted || []).length) {
        wrap.appendChild(el('h4', { text: 'Skills in the posting' }));
        const chips = el('div', { class: 'chips' });
        (sk.matched || []).forEach(x => chips.appendChild(el('span', { class: 'chip have', text: '✓ ' + x.skill })));
        (sk.missingRequired || []).forEach(x => chips.appendChild(el('span', { class: 'chip need', text: x.skill })));
        (sk.missingNice || []).forEach(x => chips.appendChild(el('span', { class: 'chip nice', title: 'Nice to have', text: x.skill })));
        if (!r.hasProfile) chips.querySelectorAll('.chip').forEach(c => { c.className = 'chip'; });
        wrap.appendChild(chips);
      }

      const steps = (r.tailor && r.tailor.steps) || [];
      if (r.hasProfile && steps.length) {
        wrap.appendChild(el('h4', { text: 'Tailor your application' }));
        wrap.appendChild(el('ul', { class: 'steps' }, steps.map(s => el('li', { text: s }))));
        wrap.appendChild(el('p', { class: 'note', text: r.tailor.reminder }));
      }

      const lows = (r.watchouts || []).filter(w => w.severity !== 'high');
      if (lows.length) {
        wrap.appendChild(el('h4', { text: 'Watch-outs' }));
        wrap.appendChild(el('ul', {}, lows.map(w => el('li', { class: 'row' }, [el('span', { class: 'ic check', 'aria-hidden': 'true', text: '!' }), el('span', {}, [w.text, w.quote ? el('span', { class: 'q', text: '“' + w.quote + '”' }) : null])]))));
      }
      if ((r.insights || []).length) wrap.appendChild(el('p', { class: 'note', text: r.insights.join(' ') }));
      const less = el('button', { class: 'link', type: 'button', 'aria-expanded': 'true', text: 'Hide details' });
      less.addEventListener('click', () => { S.details = false; draw(); });
      wrap.appendChild(less);
      wrap.appendChild(el('p', { class: 'foot', text: 'Worked out on this device from the posting and your resume; nothing was sent anywhere. You decide whether to apply: Outreach AI never clicks Apply or Save for you.' }));
      return wrap;
    }

    function draw() {
      host.hidden = S.hidden;
      card.textContent = '';
      const st = S.state;
      const title = st.phase === 'result' && st.data && st.data.job && st.data.job.title;
      const head = el('header', {}, [el('span', { class: 'logo', 'aria-hidden': 'true', text: '✦' }), el('span', { class: 'title', text: 'Job fit' }), title ? el('span', { class: 'for', text: '· ' + title }) : null, el('span', { class: 'grow' })]);
      const panel = el('button', { class: 'link', type: 'button', text: 'Panel ↗', title: 'Open the Outreach AI side panel' });
      panel.addEventListener('click', () => { try { deps.onPanel && deps.onPanel(); } catch (_) { /* best effort */ } });
      const fold = el('button', { class: 'x', type: 'button', 'aria-expanded': String(!S.collapsed), 'aria-label': S.collapsed ? 'Show job fit' : 'Collapse job fit', title: S.collapsed ? 'Show' : 'Collapse', text: S.collapsed ? '▸' : '▾' });
      fold.addEventListener('click', () => { S.collapsed = !S.collapsed; draw(); });
      const close = el('button', { class: 'x', type: 'button', 'aria-label': 'Hide job fit for this job', title: 'Hide', text: '✕' });
      close.addEventListener('click', () => { S.hidden = true; host.hidden = true; });
      head.append(panel, fold, close);
      card.appendChild(head);
      if (S.collapsed) return;

      if (st.phase === 'loading') {
        card.append(el('div', { class: 'skel', 'aria-hidden': 'true' }, [el('div', { class: 'b' }), el('div', { class: 'b' }), el('div', { class: 'b' })]), el('p', { class: 'foot', role: 'status', text: 'Reading this job on your device…' }));
      } else if (st.phase === 'result') {
        card.appendChild(drawResult(st.data));
      } else if (st.phase === 'stale') {
        card.appendChild(el('p', { class: 'note', role: 'status', text: 'Outreach AI was just reloaded or updated. Refresh this LinkedIn page to reconnect.' }));
      } else {
        const msg = st.phase === 'unreadable'
          ? 'I could not read this job posting here. Open the job on its own page (the address contains /jobs/view/) and try again, or paste the description into the Outreach AI side panel.'
          : (st.message || 'I could not check this job. Nothing was changed.');
        card.appendChild(el('p', { class: 'note', role: 'status', text: msg }));
      }
    }

    const ui = {
      host,
      render(state) { S.state = state || { phase: 'loading' }; draw(); },
      isHidden: () => S.hidden,
      remove() { host.remove(); },
      setCollapsed(v) { S.collapsed = !!v; draw(); },
      setDetails(v) { S.details = !!v; draw(); }
    };
    draw();
    return ui;
  }

  return { create, CSS, BAND };
});
