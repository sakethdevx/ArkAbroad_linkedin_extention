'use strict';

// Follow-up Coach (Recent tab): which sent messages are due for a gentle nudge, and a draft for it.
// The rules live in utils/followup.js. Nothing here sends anything: you copy the draft and send it yourself.

const SNOOZE_DAYS = 3;

// the count on the RECENT tab and the one calm line on the Current tab
async function refreshFollowUpBadge() {
  const dueNow = (await Cache.getContacts()).filter(c => FollowUp.due(c)).length;
  const badge = document.getElementById('recent-badge');
  const banner = document.getElementById('followup-banner');
  if (badge) { badge.textContent = String(dueNow); badge.classList.toggle('hidden', !dueNow); }
  if (banner) {
    banner.classList.toggle('hidden', !dueNow);
    const txt = document.getElementById('followup-banner-text');
    if (txt) txt.textContent = dueNow === 1 ? '1 follow-up is due' : `${dueNow} follow-ups are due`;
  }
}

// adds the "due" box and the "They replied" link to one Recent card
function addFollowUp(card, contact, idx) {
  if (!contact.sent) return;
  const dueInfo = FollowUp.due(contact);
  const box = document.createElement('div');
  box.className = 'followup-box' + (dueInfo ? '' : ' followup-quiet');
  const redraw = async () => { await renderRecentContacts(); await refreshFollowUpBadge(); };

  if (dueInfo) {
    box.innerHTML = `
      <p class="followup-note"><strong>Follow-up ${dueInfo.stage} of ${FollowUp.MAX} is due.</strong> It has been ${dueInfo.days} days since you sent this. A short nudge often gets the reply.</p>
      <div class="followup-draft hidden" id="fu-draft-${idx}">
        <textarea class="field-input" id="fu-text-${idx}" rows="7" aria-label="Follow-up draft (you can edit it)"></textarea>
        <div class="followup-refine">
          <div class="refine-chips" id="fu-chips-${idx}" role="group" aria-label="Quick changes"></div>
          <div class="refine-row">
            <input class="field-input" id="fu-ask-${idx}" type="text" maxlength="300" autocomplete="off" placeholder="Change something? e.g. make it shorter" aria-label="What should change in this follow-up?" />
            <button class="btn btn-sm btn-secondary" id="fu-askgo-${idx}" type="button">Rewrite</button>
          </div>
          <p class="refine-status" id="fu-askst-${idx}" role="status" aria-live="polite"></p>
          <button class="btn-link hidden" id="fu-undo-${idx}" type="button">Undo last change</button>
        </div>
        <div class="followup-row"><button class="btn btn-sm btn-primary" id="fu-copy-${idx}">Copy follow-up</button></div>
      </div>
      <div class="followup-row">
        <button class="btn btn-sm btn-secondary" id="fu-write-${idx}">Write follow-up</button>
        <button class="btn-link" id="fu-replied-${idx}">They replied</button>
        <button class="btn-link" id="fu-snooze-${idx}">Snooze ${SNOOZE_DAYS} days</button>
      </div>`;
  } else if (!contact.replied) {
    box.innerHTML = `<div class="followup-row"><button class="btn-link" id="fu-replied-${idx}">They replied</button></div>`;
  } else {
    box.innerHTML = '<p class="followup-note">✓ They replied. No more follow-ups for this person.</p>';
  }
  card.appendChild(box);

  const q = (id) => box.querySelector(`#${id}-${idx}`);
  const replied = q('fu-replied');
  if (replied) replied.addEventListener('click', async () => { await Cache.update(contact, { replied: true }); redraw(); });
  const snooze = q('fu-snooze');
  if (snooze) snooze.addEventListener('click', async () => { await Cache.update(contact, { snoozeUntil: Date.now() + SNOOZE_DAYS * FollowUp.DAY }); redraw(); });
  const write = q('fu-write');
  if (write) write.addEventListener('click', () => {
    const name = Safety.normalizeName(document.getElementById('user-name').value);
    q('fu-text').value = FollowUp.draft(contact, dueInfo.stage, name);
    q('fu-draft').classList.remove('hidden');
    write.classList.add('hidden');
    wireFollowUpRefine(contact, idx, q);
    q('fu-text').focus();
  });
  const copy = q('fu-copy');
  if (copy) copy.addEventListener('click', async () => {
    await navigator.clipboard.writeText(q('fu-text').value).catch(() => {});
    copy.textContent = 'Copied!';
    await Cache.update(contact, (c) => ({ followUps: (Number(c.followUps) || 0) + 1, snoozeUntil: null }));   // copying counts as sending it
    setTimeout(redraw, 900);
  });
}

// "Change something?" under a follow-up draft: the same engine as the main draft (utils/refine.js). In Free mode only "shorter" applies,
// because the free rules rebuild a FIRST message, not a follow-up; an AI engine can follow any wording.
async function followUpRequestData(contact) {
  const profile = { name: contact.name || '', firstName: String(contact.name || '').trim().split(/\s+/)[0] || '', headline: contact.headline || '', currentCompany: contact.company || '', profileUrl: contact.profileUrl || '' };
  const stored = await loadStoredSettings();
  return DraftRequest.generateData({ profile, settings: stored, purpose: 'Networking', tone: 'Neutral', format: 'message', seed: 0, shared: DraftRequest.shared(senderProfile, profile) });
}

async function wireFollowUpRefine(contact, idx, q) {
  const area = q('fu-text'), input = q('fu-ask'), go = q('fu-askgo'), status = q('fu-askst'), undo = q('fu-undo'), chips = q('fu-chips');
  const history = [];
  const say = (t, kind) => { status.textContent = t; status.className = 'refine-status' + (kind ? ' ' + kind : ''); };
  const engine = async () => ((await getModeState()).ai ? 'ai' : (await onDeviceActive()) ? 'ondevice' : 'free');
  const run = async (comment) => {
    const eng = await engine();
    const before = area.value;
    go.disabled = true; input.disabled = true;
    say('Rewriting…');
    let res;
    try {
      res = await Refine.run({ send: sendMsg, OnDevice: typeof OnDevice !== 'undefined' ? OnDevice : null }, {
        comment: comment !== undefined ? comment : input.value, draft: before, data: await followUpRequestData(contact), senderProfile,
        ai: eng === 'ai', onDevice: eng === 'ondevice', shorterOnly: true
      });
    } catch (_) { res = { ok: false, message: 'That did not work. Your follow-up is unchanged.' }; }
    go.disabled = false; input.disabled = false;
    if (!res.ok) { say(res.message, 'warn'); return; }
    history.push(before);
    area.value = res.text; input.value = '';
    undo.classList.remove('hidden');
    say('Revised: ' + (res.applied && res.applied.length ? res.applied.join(', ') : 'from your comment') + '. Read it, then copy it.', 'ok');
  };
  const eng0 = await engine();
  // free rules can only shorten a follow-up; an AI engine can do the rest ("Mention a project" makes no sense for a nudge)
  Refine.chipsFor(eng0).filter(c => (eng0 === 'free' ? c.label === 'Shorter' : c.label !== 'Mention a project')).forEach(c => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'refine-chip'; b.textContent = c.label;
    b.addEventListener('click', () => run(c.comment));
    chips.appendChild(b);
  });
  go.addEventListener('click', () => run());
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } });
  undo.addEventListener('click', () => { const prev = history.pop(); if (prev === undefined) return; area.value = prev; say('Back to the previous version.'); if (!history.length) undo.classList.add('hidden'); });
}
