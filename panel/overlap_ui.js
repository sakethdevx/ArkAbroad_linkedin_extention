'use strict';

// "Why you two": shared background and the spotlight chip
// Part of the side panel: plain scripts share one page scope (no build step); see popup.html for the load order.

// ─── Shared background: what you two have in common ───────────────────────────
let senderProfile = null;
let overlapAll    = [];
const overlapOff  = new Set();
const KIND_LABEL  = { school: 'School', employer: 'Employer', skills: 'Skills', city: 'City' };

const hasResumeInfo = (sp) => !!sp && !!((sp.schools || []).length || (sp.employers || []).length || (sp.skills || []).length || (sp.projects || []).length || (sp.experience || []).length || (sp.education || []).length || sp.city || sp.goal);
const selectedOverlaps = () => overlapAll.filter(o => !overlapOff.has(o.id));
// What we hand to the drafter: the kept overlaps and a compact, contact-free summary of the sender.
const sharedContext = () => ({
  overlaps:  selectedOverlaps().map(({ kind, label, detail, line }) => ({ kind, label, detail, line })),
  sender:    hasResumeInfo(senderProfile) ? Overlap.senderSummary(senderProfile) : null,
  spotlight: keptSpotlight()
});

// The ONE most relevant project/role for this person (see utils/spotlight.js). Recomputed when you toggle a shared point,
// because dropping a shared employer makes a role at that employer eligible again.
let currentSpotlight = null;
let spotlightOff = false;
const keptSpotlight = () => (currentSpotlight && !spotlightOff ? currentSpotlight : null);

function refreshSpotlight() {
  const row = document.getElementById('spot-row');
  const excl = selectedOverlaps().filter(o => o.kind === 'employer').map(o => o.label);
  currentSpotlight = currentProfile && hasResumeInfo(senderProfile) ? Spotlight.spotlight(senderProfile, currentProfile, { excludeCompanies: excl }) : null;
  row.classList.toggle('hidden', !currentSpotlight);
  // say so when nothing matches, instead of silently showing nothing
  const none = document.getElementById('spot-none');
  const hasWork = !!(senderProfile && ((senderProfile.projects || []).length || (senderProfile.experience || []).length));
  none.textContent = hasWork && currentProfile && !currentSpotlight ? 'Your work: none of your projects or roles clearly matches their field, so the draft won’t name one (that avoids a stretch).' : '';
  none.classList.toggle('hidden', !none.textContent);
  if (!currentSpotlight) return;
  document.getElementById('spot-label').textContent = currentSpotlight.title;
  document.getElementById('spot-evidence').textContent = currentSpotlight.matches.length ? `matches their ${currentSpotlight.matches.join(', ')}` : '';
  document.getElementById('spot-chip').setAttribute('aria-pressed', String(!spotlightOff));
  document.getElementById('spot-chip').title = currentSpotlight.text;
}

function renderOverlaps(keepSelection = false) {
  const panel = document.getElementById('overlap-panel');
  const chips = document.getElementById('overlap-chips');
  const empty = document.getElementById('overlap-empty');
  const hint  = document.getElementById('overlap-hint');
  if (!keepSelection) { overlapOff.clear(); spotlightOff = false; }
  chips.innerHTML = '';
  hint.textContent = '';
  empty.classList.add('hidden');
  if (!currentProfile) { panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');

  if (!hasResumeInfo(senderProfile)) {
    overlapAll = [];
    refreshSpotlight();
    empty.textContent = 'Add your resume in Settings and I’ll find shared schools, employers and skills.';
    empty.classList.remove('hidden');
    return;
  }

  overlapAll = Overlap.findOverlaps(senderProfile, currentProfile);
  refreshSpotlight();
  if (!overlapAll.length) {
    empty.textContent = currentSpotlight
      ? 'No shared school, employer or skills found, but part of your work is relevant to theirs (below).'
      : 'No shared school, employer or skills found. That’s fine: the draft will lead with something from their profile.';
    empty.classList.remove('hidden');
    return;
  }

  hint.textContent = 'Tap to leave one out';
  overlapAll.forEach(o => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `chip chip-${o.kind}`;
    b.setAttribute('aria-pressed', String(!overlapOff.has(o.id)));
    b.title = o.detail;
    const k = document.createElement('span'); k.className = 'chip-kind'; k.textContent = KIND_LABEL[o.kind] || '';
    const l = document.createElement('span'); l.className = 'chip-label'; l.textContent = o.label;
    b.append(k, l);
    b.addEventListener('click', () => onChipToggle(o.id, b));
    chips.appendChild(b);
  });
}

async function onChipToggle(id, btn) {
  if (overlapOff.has(id)) overlapOff.delete(id); else overlapOff.add(id);
  btn.setAttribute('aria-pressed', String(!overlapOff.has(id)));
  refreshSpotlight();
  applyChangeLive();
}

function onSpotlightToggle() {
  spotlightOff = !spotlightOff;
  document.getElementById('spot-chip').setAttribute('aria-pressed', String(!spotlightOff));
  applyChangeLive();
}

function loadStoredSettings() {
  return new Promise(resolve => {
    chrome.storage.local.get(['userApiKey','userName','userBio','resumeText','resumeFileName','resumeBase64','senderProfile','prefs','aiConsent','resumeTipDismissed','aiProvider','mode','onDevice'], resolve);
  });
}

function esc(str) {
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
