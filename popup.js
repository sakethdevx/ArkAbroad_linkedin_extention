'use strict';

// ─── State ────────────────────────────────────────────────────────────────────
let currentProfile     = null;
let isGenerating       = false;

// Storage in one place (the panel's only access to chrome.storage.local), and a quiet debug switch:
// set DEBUG = true to see errors that are deliberately handled (they never reach the user).
const DEBUG = false;
const debug = (where, err) => { if (DEBUG) console.warn('[outreach]', where, err); };
const storageGet = (keys) => new Promise(r => chrome.storage.local.get(keys, r));
const storageSet = (o) => new Promise(r => chrome.storage.local.set(o, r));
const storageRemove = (keys) => new Promise(r => chrome.storage.local.remove(keys, r));
// every key the panel reads at start-up, named once
const STORED_KEYS = ['userApiKey', 'userName', 'userBio', 'resumeText', 'resumeFileName', 'resumeBase64', 'senderProfile', 'prefs', 'aiConsent', 'resumeTipDismissed', 'aiProvider', 'mode', 'onDevice'];

// ─── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  initTabs();
  initModeToggle();
  wireSettingsEvents();
  wireCurrentEvents();
  wireRecentEvents();
  document.getElementById('followup-banner-go').addEventListener('click', () => switchTab('recent'));
  wireReadCard();
  document.getElementById('paste-btn').addEventListener('click', handlePasteProfile);
  document.getElementById('privacy-details-btn').addEventListener('click', showPrivacyDetails);
  wireProviderUi();
  wireOnDevice();
  wireNoteFill();
  wireRefine();
  wireTranslate();
  wireModeSwitch();
  document.getElementById('resume-tip-go').addEventListener('click', () => { switchTab('settings'); document.getElementById('about-card').open = true; document.getElementById('file-upload-area').focus(); });
  document.getElementById('resume-tip-dismiss').addEventListener('click', async () => { await storageSet({ resumeTipDismissed: true }); refreshResumeTip(); });
  wireConsentDialog();
  [document.documentElement, document.body].forEach(el => el.addEventListener('scroll', pinShell, { passive: true }));
  window.addEventListener('scroll', pinShell, { passive: true });
  await checkCurrentPage();
  await loadSettings();
  await loadPrefs();
  await renderRecentContacts();
  await refreshFollowUpBadge();
  await refreshModeBadge();
  await refreshOnDeviceCard();
  await refreshNoteFillCard();
  pushDraftToPage();   // panel opened on a LinkedIn tab: start the helper so its button can appear (with or without a draft)
  await refreshResumeTip();
  await onTabContextChanged();
  watchTabs();
});

// ─── Tabs ─────────────────────────────────────────────────────────────────────
function initTabs() {
  const btns = Array.from(document.querySelectorAll('.tab-btn'));
  btns.forEach((btn, i) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    btn.addEventListener('keydown', (e) => {
      const keys = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: btns.length - 1 };
      if (!(e.key in keys)) return;
      e.preventDefault();
      const next = btns[(keys[e.key] + btns.length) % btns.length];
      switchTab(next.dataset.tab);
      next.focus();
    });
  });
}

function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => {
    const on = b.dataset.tab === name;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
  });
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.getElementById(`tab-${name}`).classList.add('active');
  if (name === 'recent') renderRecentContacts();
}

// ─── Mode toggle ──────────────────────────────────────────────────────────────
function initModeToggle() {
}


// ─── Page check ───────────────────────────────────────────────────────────────
// Are you connected to this person? Read just the top card's badge/buttons as soon as the profile is open, so the right
// format is already selected before you press anything. Retries a few times while LinkedIn finishes drawing the page.
let connDetectKey = '';
let connDetectBusy = false;
async function autoDetectConnection(tab) {
  const key = pageKey(tab && tab.url);
  if (formatByUser || connDetectBusy || connDetectKey === key) return;
  connDetectBusy = true;
  try {
    for (const wait of [0, 900, 2200, 4500]) {
      if (wait) await new Promise(r => setTimeout(r, wait));
      const cur = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!cur[0] || pageKey(cur[0].url) !== key || formatByUser) return;
      const res = await new Promise(r => chrome.runtime.sendMessage({ action: 'detectConnection', tabId: tab.id }, r));
      if (!res || !res.success) continue;
      const d = ProfileParse.detectConnection({ lines: res.lines, labels: res.labels });
      if (d.connected !== null) {
        connDetectKey = key;
        maybeAutoFormat({ isConnection: d.connected, connectionDegree: d.degree, source: 'page' }, { applyLive: true });
        return;
      }
    }
  } catch (err) { debug('auto-detect connection', err); /* a convenience; the format buttons always work */ }
  finally { connDetectBusy = false; }
}

async function checkCurrentPage() {
  const tabs      = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab       = tabs[0];
  const onProfile = tab && tab.url && /linkedin\.com\/in\/[^/?#]+/.test(tab.url);
  document.getElementById('scrape-btn').disabled  = !onProfile;
  if (onProfile) autoDetectConnection(tab);   // not awaited: picks the right format in the background
  if (!onProfile) {
    document.getElementById('page-warning').classList.remove('hidden');
  } else {
    document.getElementById('page-warning').classList.add('hidden');
  }
  return onProfile;
}

// ─── Wire events ──────────────────────────────────────────────────────────────
function wireCurrentEvents() {
  document.getElementById('scrape-btn').addEventListener('click', handleScrapeAndGenerate);
  document.getElementById('regenerate-btn').addEventListener('click', () => regenerate(true));
  document.getElementById('spot-chip').addEventListener('click', onSpotlightToggle);
  document.getElementById('copy-btn').addEventListener('click', handleCopy);
  document.getElementById('copy-open-btn').addEventListener('click', handleCopyAndOpen);
  document.getElementById('generated-message').addEventListener('input', onDraftInput);
  document.querySelectorAll('.format-btn').forEach(b => b.addEventListener('click', () => { formatByUser = true; formatAutoNote = ''; setFormat(b.dataset.format); }));
  ['message-type', 'tone'].forEach(id => document.getElementById(id).addEventListener('change', () => { savePrefs(); applyChangeLive(); }));
}

function wireSettingsEvents() {
  document.getElementById('save-settings-btn').addEventListener('click', handleSaveSettings);
  document.getElementById('validate-btn').addEventListener('click', handleValidateKey);
  document.getElementById('api-key').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleValidateKey();
  });

  // Resume upload (keyboard + mouse + drag/drop)
  const dropArea = document.getElementById('file-upload-area');
  const picker   = document.getElementById('resume-upload');
  dropArea.addEventListener('click', (e) => { if (e.target !== picker) picker.click(); });
  dropArea.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); picker.click(); } });
  dropArea.addEventListener('dragover', (e) => { e.preventDefault(); dropArea.classList.add('drag-over'); });
  dropArea.addEventListener('dragleave', () => dropArea.classList.remove('drag-over'));
  dropArea.addEventListener('drop', (e) => {
    e.preventDefault();
    dropArea.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) processResumeFile(file);
  });
  picker.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) processResumeFile(file);
    picker.value = '';
  });
  document.getElementById('resume-paste-btn').addEventListener('click', () => {
    const text = document.getElementById('resume-paste').value;
    if (text.trim().length < 40) { setResumeStatus('Paste a bit more of your resume text first.', 'error'); return; }
    ingestResumeText(text, 'Pasted resume');
  });
  document.getElementById('resume-remove-btn').addEventListener('click', removeResume);
  document.getElementById('user-name').addEventListener('input', renderAboutSummary);
  document.getElementById('resume-ai-btn').addEventListener('click', async () => {
    const { resumeText } = await storageGet(['resumeText']);
    if (!resumeText) { setResumeStatus('Upload or paste your resume first.', 'error'); return; }
    if ((await getModeState()).ai) await tryAiResume(resumeText); else await tryOnDeviceResume(resumeText);
  });
  ['me-intro', 'me-goal', 'me-schools', 'me-employers', 'me-skills', 'me-city', 'me-education', 'me-experience', 'me-projects', 'me-certs', 'me-languages'].forEach(id =>
    document.getElementById(id).addEventListener('change', () => saveSenderFromCard()));
}

function wireRecentEvents() {
  document.getElementById('clear-recent-btn').addEventListener('click', async () => {
    await Cache.clearContacts();
    renderRecentContacts();
  });
}

// ─── Simple Mode ──────────────────────────────────────────────────────────────
async function handleScrapeAndGenerate() {
  if (isGenerating) return;

  isGenerating = true;
  hideMessage();
  setButtonLoading('scrape-btn', 'btn-label', 'btn-spinner', true, 'Reading profile…');
  clearCurrentStatus();

  try {
    const profile = await sendToBackground({ action: 'scrapeProfile', tabId: await activeTabId() });
    await generateFromProfile(profile);
  } catch (err) {
    showCurrentStatus(err.message, 'error');
    openPasteCard();           // always leave the user a way forward
  } finally {
    isGenerating = false;
    setButtonLoading('scrape-btn', 'btn-label', 'btn-spinner', false, 'Read profile &amp; write draft');
  }
}

// Shared by scraping and pasted text: show what was read, then draft unless nothing was readable.
async function generateFromProfile(profile, setBusy = (t) => setButtonLoading('scrape-btn', 'btn-label', 'btn-spinner', true, t)) {
  currentProfile = profile;
  maybeAutoFormat(profile);
  suggestTranslation(profile);   // not awaited
  renderProfileCard(profile);
  renderReadCard(profile);
  renderOverlaps(false);
  const confidence = profile.quality ? profile.quality.confidence : 'high';

  if (confidence === 'none') {
    showCurrentStatus("I couldn't read anything useful from this page. Paste the profile text below and I'll use that instead.", 'error');
    openPasteCard();
    return;
  }

  seed = 0;
  setBusy('Writing your draft…');
  const resp = await callQuickGenerate(currentProfile);
  renderDrafts(resp);
  await saveToHistory();

  if (confidence !== 'high') showCurrentStatus('Draft ready. I only read part of this profile, so check “What I read” above.', 'warning');
  else showCurrentStatus('Draft ready. Read it, make it yours, then send it yourself.', 'success');
}

// ─── “What I read” card + paste fallback ─────────────────────────────────────
const CONF_LABEL = { high: 'Read well', medium: 'Partly read', low: 'Barely read', none: 'Nothing read' };

function renderReadCard(profile) {
  const q = profile.quality || { confidence: 'high', warnings: [], missing: [] };
  const card = document.getElementById('read-card');
  card.classList.remove('hidden');
  card.open = q.confidence !== 'high';       // open by default only when something needs attention

  const pill = document.getElementById('read-conf');
  pill.textContent = CONF_LABEL[q.confidence] || '';
  pill.className = `conf-pill conf-${q.confidence}`;

  document.getElementById('read-name').value    = profile.name || '';
  document.getElementById('read-role').value    = profile.currentTitle || '';
  document.getElementById('read-company').value = profile.currentCompany || '';

  const n = (a) => (a || []).length;
  document.getElementById('read-counts').textContent =
    `Experience ${n(profile.experienceEntries)} · Education ${n(profile.educationEntries)} · Skills ${n(profile.skills)} · About ${profile.about ? '✓' : '—'}`;

  const list = document.getElementById('read-warnings');
  list.innerHTML = '';
  const notes = [...(q.warnings || [])];
  if (q.missing && q.missing.length && q.confidence !== 'high') notes.push(`Not found: ${q.missing.join(', ')}.`);
  notes.forEach(t => { const li = document.createElement('li'); li.textContent = t; list.appendChild(li); });
  list.classList.toggle('hidden', notes.length === 0);
}

function wireReadCard() {
  const apply = () => {
    if (!currentProfile) return;
    currentProfile.name           = document.getElementById('read-name').value.trim();
    currentProfile.currentTitle   = document.getElementById('read-role').value.trim();
    currentProfile.currentCompany = document.getElementById('read-company').value.trim();
    renderProfileCard(currentProfile);
    renderOverlaps(true);
    document.getElementById('read-edit-hint').classList.remove('hidden');
  };
  ['read-name', 'read-role', 'read-company'].forEach(id => document.getElementById(id).addEventListener('input', apply));
}

function openPasteCard() {
  const card = document.getElementById('paste-card');
  card.open = true;
  scrollIntoViewSoft(card);
}

async function handlePasteProfile() {
  if (isGenerating) return;
  const text = document.getElementById('paste-text').value;
  if (text.trim().length < 20) { showCurrentStatus('Paste the profile text first (select all on the profile, copy, paste here).', 'error'); return; }

  const profile = ProfileParse.parseProfileText(text);
  isGenerating = true;
  hideMessage();
  clearCurrentStatus();
  setButtonLoading('paste-btn', 'paste-label', 'paste-spinner', true, 'Reading…');
  try {
    await generateFromProfile(profile, (t) => setButtonLoading('paste-btn', 'paste-label', 'paste-spinner', true, t));
  } catch (err) {
    showCurrentStatus(err.message, 'error');
  } finally {
    isGenerating = false;
    setButtonLoading('paste-btn', 'paste-label', 'paste-spinner', false, 'Use pasted text');
  }
}

async function requestData(profile) {
  const stored = await loadStoredSettings();
  return DraftRequest.generateData({   // utils/request.js: the same payload the LinkedIn page builds
    profile, settings: stored,   // only userName and userBio are used: not the key, not the resume text
    purpose: document.getElementById('message-type').value,
    tone: document.getElementById('tone').value,
    format: currentFormat, seed, shared: sharedContext()
  });
}

async function callQuickGenerate(profile) {
  const data = await requestData(profile);
  const resp = await sendToBackground({ action: 'generateMessage', data });
  maybePolishOnDevice(data, resp, profile);   // not awaited: the instant drafts show first, the polished ones replace them
  return resp;
}

// ─── Pipeline UI ──────────────────────────────────────────────────────────────
// ─── UI helpers ───────────────────────────────────────────────────────────────
function renderProfileCard(data) {
  const section = document.getElementById('profile-section');
  section.classList.remove('hidden');
  const name = data.name || 'Unknown';
  const avatar = document.getElementById('profile-avatar');
  avatar.classList.remove('has-photo');
  avatar.textContent = name.charAt(0).toUpperCase();          // initial first: always something sensible
  if (ProfileParse.isLinkedInImage(data.photoUrl)) {          // then their real photo, straight from LinkedIn's image servers
    const img = document.createElement('img');
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    img.decoding = 'async';
    img.addEventListener('load', () => avatar.classList.add('has-photo'));       // fade the picture in over the initial
    img.addEventListener('error', () => { img.remove(); avatar.classList.remove('has-photo'); });   // keeps the initial
    avatar.appendChild(img);
    img.src = data.photoUrl;
  } else avatar.classList.remove('has-photo');
  document.getElementById('profile-name').textContent    = name;
  document.getElementById('profile-headline').textContent = data.headline || '';
  document.getElementById('profile-company').textContent  = data.currentCompany || '';
}

// ─── Recent contacts ──────────────────────────────────────────────────────────
async function renderRecentContacts() {
  const contacts  = await Cache.getContacts();
  const listEl    = document.getElementById('recent-list');
  const emptyEl   = document.getElementById('no-recent');
  const actionsEl = document.getElementById('recent-actions');
  listEl.innerHTML = '';
  if (contacts.length === 0) {
    emptyEl.classList.remove('hidden'); actionsEl.classList.add('hidden'); return;
  }
  emptyEl.classList.add('hidden'); actionsEl.classList.remove('hidden');
  document.getElementById('recent-subtitle').textContent = `${contacts.length} recent draft${contacts.length > 1 ? 's' : ''}`;
  contacts.forEach((c, i) => listEl.appendChild(buildContactCard(c, i)));
}

function buildContactCard(contact, idx) {
  const card = document.createElement('div');
  card.className = 'contact-card';
  const link = Person.profileLink(contact.handle || contact.profileUrl);   // null unless it is a real LinkedIn profile handle
  const date    = new Date(contact.timestamp).toLocaleDateString('en-US', { month:'short', day:'numeric' });
  const preview = (contact.message || '').substring(0, 110) + ((contact.message || '').length > 110 ? '…' : '');
  card.innerHTML = `
    <div class="contact-header">
      <div class="contact-info">
        ${link ? `<button class="contact-name contact-link" id="open-${idx}" title="Open ${esc(contact.name || 'their')} profile on LinkedIn">${esc(contact.name||'Unknown')} <span aria-hidden="true">↗</span></button>`
               : `<div class="contact-name">${esc(contact.name||'Unknown')}</div>`}
        <div class="contact-meta">${esc(contact.headline||contact.company||'')}</div>
        ${link ? '' : '<div class="contact-meta contact-nolink">From pasted text, so there is no profile to open.</div>'}
      </div>
      <div class="contact-date">${esc(date)}</div>
    </div>
    <div class="contact-message-preview" id="prev-${idx}">${esc(preview)}</div>
    <div class="contact-message-full hidden" id="full-${idx}">${esc(contact.message||'')}</div>
    <div class="contact-actions">
      <button class="btn-link" id="expand-${idx}">Show full message</button>
      <button class="btn-link" id="sent-${idx}" aria-pressed="${contact.sent ? 'true' : 'false'}">${contact.sent ? '✓ Sent' : 'Mark as sent'}</button>
      <button class="btn btn-sm btn-primary" id="copy-c-${idx}">Copy</button>
    </div>`;

  card.querySelector(`#expand-${idx}`).addEventListener('click', () => {
    const isHidden = card.querySelector(`#full-${idx}`).classList.contains('hidden');
    card.querySelector(`#prev-${idx}`).classList.toggle('hidden', isHidden);
    card.querySelector(`#full-${idx}`).classList.toggle('hidden', !isHidden);
    card.querySelector(`#expand-${idx}`).textContent = isHidden ? 'Show less' : 'Show full message';
  });

  const openBtn = card.querySelector(`#open-${idx}`);
  if (openBtn) openBtn.addEventListener('click', () => { chrome.tabs.create({ url: link }); });

  const sentBtn = card.querySelector(`#sent-${idx}`);
  sentBtn.addEventListener('click', async () => {
    const next = !contact.sent;
    contact.sent = next;
    await Cache.setSent(contact, next);
    sentBtn.textContent = next ? '✓ Sent' : 'Mark as sent';
    sentBtn.setAttribute('aria-pressed', String(next));
    renderRecentContacts(); refreshFollowUpBadge();   // the follow-up clock starts (or resets) with this click
  });

  card.querySelector(`#copy-c-${idx}`).addEventListener('click', async () => {
    await navigator.clipboard.writeText(contact.message || '').catch(() => {});
    const btn = card.querySelector(`#copy-c-${idx}`);
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy'; }, 2200);
  });

  addFollowUp(card, contact, idx);
  return card;
}

// ─── Follow the active tab (the side panel stays open while you browse) ───────
let lastPageUrl = null;

async function onTabContextChanged() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const key = pageKey(tabs[0] && tabs[0].url);
  if (lastPageUrl !== null && key !== lastPageUrl) {
    // a new person: forget the last person's connection reading BEFORE reading this page
    connDetectKey = ''; formatAutoNote = '';
    if (!formatByUser) currentFormat = 'note';
    setFormat(currentFormat, { silent: true });
    resetForNewPage();
  }
  lastPageUrl = key;
  await checkCurrentPage();
  pushDraftToPage();   // a different tab or person: the helper there needs the (possibly empty) current draft
}

// A draft written for one person must never sit under another person's profile.
function resetForNewPage() {
  if (isGenerating) return;
  if (!currentProfile && !drafts.length) return;
  currentProfile = null;
  cancelPolish();
  resetTranslate();
  formatAutoNote = ''; setFormat(currentFormat, { silent: true });
  overlapAll = []; overlapOff.clear(); spotlightOff = false; currentSpotlight = null; seed = 0;
  ['profile-section', 'read-card', 'overlap-panel'].forEach(id => document.getElementById(id).classList.add('hidden'));
  hideMessage();
  showCurrentStatus('You moved to a new page, so the old draft was cleared.', '');
}

function watchTabs() {
  let t;
  const kick = () => { clearTimeout(t); t = setTimeout(onTabContextChanged, 150); };
  if (chrome.tabs.onActivated) chrome.tabs.onActivated.addListener(kick);
  if (chrome.tabs.onUpdated) chrome.tabs.onUpdated.addListener((id, info, tab) => { if (tab && tab.active && (info.url || info.status === 'complete')) kick(); });
  if (chrome.windows && chrome.windows.onFocusChanged) chrome.windows.onFocusChanged.addListener(kick);
}

// ─── Chrome messaging ─────────────────────────────────────────────────────────
function sendToBackground(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (response) => {
      if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
      if (!response) { reject(new Error('No response from background.')); return; }
      if (!response.success) { reject(new Error(response.error || 'Background returned an error.')); return; }
      if (response.data !== undefined) { resolve(response.data); return; }
      if (response.variants !== undefined || response.generatedMessage !== undefined) { resolve(response); return; }
      reject(new Error('Unexpected response: ' + JSON.stringify(Object.keys(response))));
    });
  });
}

