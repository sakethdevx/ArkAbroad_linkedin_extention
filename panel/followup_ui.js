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
