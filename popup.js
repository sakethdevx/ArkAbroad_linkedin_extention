'use strict';

// ─── State ────────────────────────────────────────────────────────────────────
let currentProfile     = null;
let isGenerating       = false;
let currentMode        = 'simple';
let deepProfileJSON    = null;
let deepEnrichmentJSON = null;
let isEnriching        = false;

// ─── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  initTabs();
  initModeToggle();
  wireSettingsEvents();
  wireCurrentEvents();
  wireRecentEvents();
  wireReadCard();
  document.getElementById('paste-btn').addEventListener('click', handlePasteProfile);
  await checkCurrentPage();
  await loadSettings();
  await renderRecentContacts();
  await refreshModeBadge();
});

// ─── Mode badge in header (Free vs AI) ───────────────────────────────────────
async function refreshModeBadge() {
  const s   = await loadStoredSettings();
  const key = (s.userApiKey || '').trim();
  const el  = document.getElementById('key-status');
  el.textContent = key ? '● AI Mode' : '● Free Mode';
  el.className   = 'key-status active';
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.querySelector(`.tab-btn[data-tab="${name}"]`).classList.add('active');
  document.getElementById(`tab-${name}`).classList.add('active');
  if (name === 'recent') renderRecentContacts();
}

// ─── Mode toggle ──────────────────────────────────────────────────────────────
function initModeToggle() {
  document.getElementById('mode-simple').addEventListener('click', () => setMode('simple'));
  document.getElementById('mode-deep').addEventListener('click', () => setMode('deep'));
}

function setMode(mode) {
  currentMode = mode;
  document.getElementById('mode-simple').classList.toggle('active', mode === 'simple');
  document.getElementById('mode-deep').classList.toggle('active', mode === 'deep');
  document.getElementById('simple-mode-ui').classList.toggle('hidden', mode === 'deep');
  document.getElementById('deep-mode-ui').classList.toggle('hidden', mode === 'simple');
  hideMessage();
  clearCurrentStatus();
}

// ─── Page check ───────────────────────────────────────────────────────────────
async function checkCurrentPage() {
  const tabs      = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab       = tabs[0];
  const onProfile = tab && tab.url && /linkedin\.com\/in\/[^/?#]+/.test(tab.url);
  document.getElementById('scrape-btn').disabled  = !onProfile;
  document.getElementById('enrich-btn').disabled  = !onProfile;
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
  document.getElementById('enrich-btn').addEventListener('click', handleEnrich);
  document.getElementById('deep-generate-btn').addEventListener('click', handleDeepGenerate);
  document.getElementById('regenerate-btn').addEventListener('click', handleRegenerate);
  document.getElementById('copy-btn').addEventListener('click', handleCopy);
  document.getElementById('generated-message').addEventListener('input', updateCharCount);
}

function wireSettingsEvents() {
  document.getElementById('save-settings-btn').addEventListener('click', handleSaveSettings);
  document.getElementById('validate-btn').addEventListener('click', handleValidateKey);
  document.getElementById('api-key').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleValidateKey();
  });

  // Résumé upload (keyboard + mouse + drag/drop)
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
    if (text.trim().length < 40) { setResumeStatus('Paste a bit more of your résumé text first.', 'error'); return; }
    ingestResumeText(text, 'Pasted résumé');
  });
  document.getElementById('resume-remove-btn').addEventListener('click', removeResume);
  ['me-intro', 'me-schools', 'me-employers', 'me-skills', 'me-city'].forEach(id =>
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
    const profile = await sendToBackground({ action: 'scrapeProfile' });
    await generateFromProfile(profile);
  } catch (err) {
    showCurrentStatus(err.message, 'error');
    openPasteCard();           // always leave the user a way forward
  } finally {
    isGenerating = false;
    setButtonLoading('scrape-btn', 'btn-label', 'btn-spinner', false, 'Scrape &amp; Generate');
  }
}

// Shared by scraping and pasted text: show what was read, then draft unless nothing was readable.
async function generateFromProfile(profile, setBusy = (t) => setButtonLoading('scrape-btn', 'btn-label', 'btn-spinner', true, t)) {
  currentProfile = profile;
  renderProfileCard(profile);
  renderReadCard(profile);
  renderOverlaps(false);
  const confidence = profile.quality ? profile.quality.confidence : 'high';

  if (confidence === 'none') {
    showCurrentStatus("I couldn't read anything useful from this page. Paste the profile text below and I'll use that instead.", 'error');
    openPasteCard();
    return;
  }

  setBusy('Generating message…');
  const message = await callQuickGenerate(currentProfile);
  renderMessage(message);

  await Cache.addContact({
    profileUrl: profile.profileUrl || '',
    name:       profile.name       || 'Unknown',
    headline:   profile.headline   || '',
    company:    profile.currentCompany || '',
    message,
    timestamp:  Date.now()
  });

  if (confidence === 'high') showCurrentStatus('Message ready.', 'success');
  else showCurrentStatus('Draft ready. I only read part of this profile, so check “What I read” above.', 'warning');
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
    if (deepProfileJSON) {   // Review/Deep flow keeps its own normalised copy
      deepProfileJSON.name           = currentProfile.name;
      deepProfileJSON.firstName      = currentProfile.name.split(/\s+/)[0] || 'there';
      deepProfileJSON.currentTitle   = currentProfile.currentTitle;
      deepProfileJSON.currentCompany = currentProfile.currentCompany;
    }
    renderProfileCard(currentProfile);
    renderOverlaps(true);
    document.getElementById('read-edit-hint').classList.remove('hidden');
  };
  ['read-name', 'read-role', 'read-company'].forEach(id => document.getElementById(id).addEventListener('input', apply));
}

function openPasteCard() { document.getElementById('paste-card').open = true; }

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
    if (currentMode === 'deep') await runEnrich(profile);
    else await generateFromProfile(profile, (t) => setButtonLoading('paste-btn', 'paste-label', 'paste-spinner', true, t));
  } catch (err) {
    showCurrentStatus(err.message, 'error');
  } finally {
    isGenerating = false;
    setButtonLoading('paste-btn', 'paste-label', 'paste-spinner', false, 'Use pasted text');
  }
}

async function callQuickGenerate(profile) {
  const settings    = await loadStoredSettings();
  const messageType = document.getElementById('message-type').value;
  const tone        = document.getElementById('tone').value;
  return sendToBackground({ action: 'generateMessage', data: { profileData: profile, settings, messageType, tone, ...sharedContext() } });
}

async function handleRegenerate() {
  if (isGenerating) return;
  if (currentMode === 'deep') { handleDeepGenerate(); return; }
  if (!currentProfile) return;

  isGenerating = true;
  setButtonLoading('scrape-btn', 'btn-label', 'btn-spinner', true, 'Regenerating…');

  try {
    const message = await callQuickGenerate(currentProfile);
    renderMessage(message);
    showCurrentStatus('Regenerated!', 'success');
  } catch (err) {
    showCurrentStatus(err.message, 'error');
  } finally {
    isGenerating = false;
    setButtonLoading('scrape-btn', 'btn-label', 'btn-spinner', false, 'Scrape &amp; Generate');
  }
}

// ─── Deep Mode ────────────────────────────────────────────────────────────────
function resetDeepState() {
  deepProfileJSON = null;
  deepEnrichmentJSON = null;
  resetLayerStatuses();
  document.getElementById('hooks-panel').classList.add('hidden');
  document.getElementById('deep-generate-btn').disabled = true;
  hideMessage();
  clearCurrentStatus();
}

async function handleEnrich() {
  if (isEnriching) return;
  resetDeepState();

  isEnriching = true;
  setButtonLoading('enrich-btn', 'enrich-label', 'enrich-spinner', true, 'Reading profile…');
  setLayerStatus(1, 'running', 'Reading…');

  try {
    const raw = await sendToBackground({ action: 'scrapeProfile' });
    await runEnrich(raw);
  } catch (err) {
    setLayerStatus(1, 'error', 'Failed');
    showCurrentStatus(err.message, 'error');
    openPasteCard();
  } finally {
    isEnriching = false;
    setButtonLoading('enrich-btn', 'enrich-label', 'enrich-spinner', false, 'Read &amp; Find Common Ground');
  }
}

// Shared by scraping and pasted text.
async function runEnrich(rawProfileData) {
  resetDeepState();
  currentProfile = rawProfileData;
  renderProfileCard(rawProfileData);
  renderReadCard(rawProfileData);
  renderOverlaps(false);

  if (rawProfileData.quality && rawProfileData.quality.confidence === 'none') {
    setLayerStatus(1, 'error', 'Nothing read');
    showCurrentStatus("I couldn't read anything useful from this page. Paste the profile text below instead.", 'error');
    openPasteCard();
    return;
  }

  setLayerStatus(1, 'running', 'Parsing…');
  showCurrentStatus('Finding hooks…');
  const response = await new Promise(resolve => chrome.runtime.sendMessage({ type: 'RUN_ENRICH', payload: { rawProfileData } }, resolve));

  if (chrome.runtime.lastError || !response || response.status === 'error') {
    setLayerStatus(1, 'error', 'Error');
    setLayerStatus(2, 'error', 'Error');
    showCurrentStatus((response && response.error) || 'Something went wrong. Please try again.', 'error');
    return;
  }

  setLayerStatus(1, 'done', 'Done');
  setLayerStatus(2, 'done', 'Done');
  deepProfileJSON    = response.profileJSON;
  deepEnrichmentJSON = response.enrichmentJSON;
  renderProfileCard(deepProfileJSON);
  renderHooks(deepEnrichmentJSON);
  setLayerStatus(3, '', 'Ready');
  document.getElementById('deep-generate-btn').disabled = false;
  showCurrentStatus('Hooks found. Hit Generate Message.', 'success');
}

async function handleDeepGenerate() {
  if (isGenerating || !deepProfileJSON || !deepEnrichmentJSON) return;

  isGenerating = true;
  setButtonLoading('deep-generate-btn', 'deep-gen-label', 'deep-gen-spinner', true, 'Writing message…');
  setLayerStatus(3, 'running', 'Writing…');
  showCurrentStatus('Layer 3: writing message…');
  hideMessage();

  const messageType = document.getElementById('message-type').value;
  const tone        = document.getElementById('tone').value;

  chrome.runtime.sendMessage(
    { type: 'RUN_GENERATE', payload: { profileJSON: deepProfileJSON, enrichmentJSON: deepEnrichmentJSON, messageType, tone, ...sharedContext() } },
    async (response) => {
      isGenerating = false;
      setButtonLoading('deep-generate-btn', 'deep-gen-label', 'deep-gen-spinner', false, 'Write Draft');

      if (chrome.runtime.lastError || !response) {
        setLayerStatus(3, 'error', 'Error');
        showCurrentStatus('Generation failed.', 'error');
        return;
      }

      if (response.status === 'error') {
        setLayerStatus(3, 'error', 'Error');
        showCurrentStatus(response.error, 'error');
        return;
      }

      setLayerStatus(3, 'done', 'Done');
      renderMessage(response.generatedMessage);
      showCurrentStatus('Message ready.', 'success');

      await Cache.addContact({
        profileUrl: deepProfileJSON.profileUrl || '',
        name:       deepProfileJSON.name || 'Unknown',
        headline:   deepProfileJSON.headline || '',
        company:    deepProfileJSON.currentCompany || '',
        message:    response.generatedMessage,
        timestamp:  Date.now()
      });
    }
  );
}

// ─── Settings ─────────────────────────────────────────────────────────────────
async function loadSettings() {
  let s = await loadStoredSettings();
  if (s.userApiKey) document.getElementById('api-key').value = s.userApiKey;
  if (s.userName)   document.getElementById('user-name').value   = s.userName;
  if (s.userBio)    document.getElementById('user-bio').value    = s.userBio;

  // v3.1 stored the whole PDF as base64 and never used it. Convert once to text, then delete the blob.
  if (s.resumeBase64) {
    try {
      if (!s.resumeText) {
        const bin = atob(s.resumeBase64);
        const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
        const { text } = await Resume.extractPdfText(bytes);
        if (text.trim().length >= 40) await ingestResumeText(text, s.resumeFileName || 'Résumé', { quiet: true });
      }
    } catch (_) { /* fall through: the user can re-upload */ }
    await new Promise(r => chrome.storage.local.remove('resumeBase64', r));
    s = await loadStoredSettings();
  }

  senderProfile = s.senderProfile || null;
  if (senderProfile || s.resumeFileName) {
    fillMeCard(senderProfile || {});
    setResumeFileUi(s.resumeFileName);
    setResumeStatus(`${s.resumeFileName || 'Résumé'} read on this device ✓`, 'success');
  }
}

async function handleSaveSettings() {
  const userApiKey = document.getElementById('api-key').value.trim();
  const userName   = document.getElementById('user-name').value.trim();
  const userBio    = document.getElementById('user-bio').value.trim();

  await new Promise(resolve => chrome.storage.local.set({ userApiKey, userName, userBio }, resolve));
  await saveSenderFromCard({ quiet: true });
  showSettingsStatus('Settings saved!', 'success');
  await refreshModeBadge();
}

async function handleValidateKey() {
  const apiKey = document.getElementById('api-key').value.trim();
  if (!apiKey) return;

  const btn = document.getElementById('validate-btn');
  btn.textContent = '…';
  btn.disabled = true;

  const result = await new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'TEST_API_KEY', payload: { apiKey } }, resolve);
  });

  btn.textContent = 'Test';
  btn.disabled = false;

  const el = document.getElementById('key-validation-status');
  el.classList.remove('hidden');

  if (result && result.valid) {
    // "Test" only tests. Saving stays an explicit action (it used to silently save the key).
    el.textContent = '✓ Key works. Click Save Settings to turn AI Mode on.';
    el.className   = 'key-validation-status valid';
  } else {
    el.textContent = `✗ ${result?.reason || 'Key did not work'}`;
    el.className   = 'key-validation-status invalid';
  }
}

// ─── Pipeline UI ──────────────────────────────────────────────────────────────
function setLayerStatus(layer, status, text) {
  document.getElementById(`l${layer}-dot`).className = `status-dot ${status}`;
  document.getElementById(`l${layer}-text`).textContent = text;
}

function resetLayerStatuses() {
  [1,2].forEach(n => setLayerStatus(n, '', 'Ready'));
  setLayerStatus(3, '', 'Waiting');
}

function renderHooks(enrichmentJSON) {
  const panel = document.getElementById('hooks-panel');
  const list  = document.getElementById('hooks-list');
  list.innerHTML = '';
  const hooks = enrichmentJSON.topHooks?.length
    ? enrichmentJSON.topHooks
    : (enrichmentJSON.companyNews || []).map(n => n.relevance || n.headline).filter(Boolean);
  if (!hooks.length) return;
  hooks.slice(0, 3).forEach(hook => {
    const d = document.createElement('div');
    d.className   = 'hook-item';
    d.textContent = hook;
    list.appendChild(d);
  });
  panel.classList.remove('hidden');
}

// ─── UI helpers ───────────────────────────────────────────────────────────────
function renderProfileCard(data) {
  const section = document.getElementById('profile-section');
  section.classList.remove('hidden');
  const name = data.name || 'Unknown';
  document.getElementById('profile-avatar').textContent  = name.charAt(0).toUpperCase();
  document.getElementById('profile-name').textContent    = name;
  document.getElementById('profile-headline').textContent = data.headline || '';
  document.getElementById('profile-company').textContent  = data.currentCompany || '';
}

function renderMessage(text) {
  document.getElementById('generated-message').value = text;
  document.getElementById('message-section').classList.remove('hidden');
  updateCharCount();
}

function hideMessage() { document.getElementById('message-section').classList.add('hidden'); }
function updateCharCount() {
  document.getElementById('char-count').textContent = `${document.getElementById('generated-message').value.length} chars`;
}

async function handleCopy() {
  const text = document.getElementById('generated-message').value;
  if (!text) return;
  try { await navigator.clipboard.writeText(text); } catch(_) {
    const ta = document.getElementById('generated-message');
    ta.select(); document.execCommand('copy');
  }
  const btn = document.getElementById('copy-btn');
  btn.textContent = '✓ Copied!';
  btn.classList.add('btn-secondary'); btn.classList.remove('btn-primary');
  setTimeout(() => {
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" stroke-width="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" stroke-width="2"/></svg> Copy`;
    btn.classList.remove('btn-secondary'); btn.classList.add('btn-primary');
  }, 2200);
}

function showCurrentStatus(msg, type = '') {
  const el = document.getElementById('status-message');
  el.textContent = msg;
  el.className = `status-bar${type ? ' status-' + type : ''}`;
  el.classList.remove('hidden');
}

function clearCurrentStatus() {
  const el = document.getElementById('status-message');
  el.classList.add('hidden');
  el.textContent = '';
}

function showSettingsStatus(msg, type = '') {
  const el = document.getElementById('settings-status');
  el.textContent = msg;
  el.className = `status-bar${type ? ' status-' + type : ''}`;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 2500);
}

function setButtonLoading(btnId, labelId, spinnerId, loading, labelText) {
  document.getElementById(btnId).disabled = loading;
  document.getElementById(labelId).innerHTML = labelText;
  document.getElementById(spinnerId).classList.toggle('hidden', !loading);
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
  contacts.forEach((c, i) => listEl.appendChild(buildContactCard(c, i)));
}

function buildContactCard(contact, idx) {
  const card = document.createElement('div');
  card.className = 'contact-card';
  const date    = new Date(contact.timestamp).toLocaleDateString('en-US', { month:'short', day:'numeric' });
  const preview = (contact.message || '').substring(0, 110) + ((contact.message || '').length > 110 ? '…' : '');
  card.innerHTML = `
    <div class="contact-header">
      <div class="contact-info">
        <div class="contact-name">${esc(contact.name||'Unknown')}</div>
        <div class="contact-meta">${esc(contact.headline||contact.company||'')}</div>
      </div>
      <div class="contact-date">${esc(date)}</div>
    </div>
    <div class="contact-message-preview" id="prev-${idx}">${esc(preview)}</div>
    <div class="contact-message-full hidden" id="full-${idx}">${esc(contact.message||'')}</div>
    <div class="contact-actions">
      <button class="btn-link" id="expand-${idx}">Show full message</button>
      <button class="btn btn-sm btn-primary" id="copy-c-${idx}">Copy</button>
    </div>`;

  card.querySelector(`#expand-${idx}`).addEventListener('click', () => {
    const isHidden = card.querySelector(`#full-${idx}`).classList.contains('hidden');
    card.querySelector(`#prev-${idx}`).classList.toggle('hidden', isHidden);
    card.querySelector(`#full-${idx}`).classList.toggle('hidden', !isHidden);
    card.querySelector(`#expand-${idx}`).textContent = isHidden ? 'Show less' : 'Show full message';
  });

  card.querySelector(`#copy-c-${idx}`).addEventListener('click', async () => {
    await navigator.clipboard.writeText(contact.message || '').catch(() => {});
    const btn = card.querySelector(`#copy-c-${idx}`);
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy'; }, 2200);
  });

  return card;
}

// ─── Chrome messaging ─────────────────────────────────────────────────────────
function sendToBackground(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (response) => {
      if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
      if (!response) { reject(new Error('No response from background.')); return; }
      if (!response.success) { reject(new Error(response.error || 'Background returned an error.')); return; }
      if (response.data !== undefined) { resolve(response.data); return; }
      if (response.generatedMessage !== undefined) { resolve(response.generatedMessage); return; }
      reject(new Error('Unexpected response: ' + JSON.stringify(Object.keys(response))));
    });
  });
}

// ─── Résumé: PDF → text → editable profile (all on-device) ─────────────────────
const toList = (v) => String(v || '').split(/[,;\n]/).map(x => x.trim()).filter(Boolean);
const storageSet = (o) => new Promise(r => chrome.storage.local.set(o, r));

function setResumeStatus(msg, kind) {
  const el = document.getElementById('resume-status');
  el.textContent = msg;
  el.className = `resume-status ${kind || ''}`;
}

function setResumeFileUi(fileName) {
  document.getElementById('file-label').textContent = fileName || 'Click to upload or drag PDF here';
  document.getElementById('file-upload-area').classList.toggle('has-file', !!fileName);
}

function fillMeCard(sp) {
  document.getElementById('me-card').classList.remove('hidden');
  document.getElementById('me-intro').value     = sp.intro || '';
  document.getElementById('me-schools').value   = (sp.schools || []).join(', ');
  document.getElementById('me-employers').value = (sp.employers || []).join(', ');
  document.getElementById('me-skills').value    = (sp.skills || []).join(', ');
  document.getElementById('me-city').value      = sp.city || '';
}

function readMeCard() {
  return {
    intro:     document.getElementById('me-intro').value.trim(),
    schools:   toList(document.getElementById('me-schools').value),
    employers: toList(document.getElementById('me-employers').value),
    skills:    toList(document.getElementById('me-skills').value),
    city:      document.getElementById('me-city').value.trim()
  };
}

async function saveSenderFromCard() {
  senderProfile = readMeCard();
  await storageSet({ senderProfile });
  renderOverlaps(true);
}

async function ingestResumeText(text, fileName, opts = {}) {
  const parsed = Resume.parseResume(text);
  const prev = (await loadStoredSettings()).senderProfile || {};
  senderProfile = { intro: prev.intro || '', schools: parsed.schools, employers: parsed.employers, skills: parsed.skills, city: parsed.city || prev.city || '' };
  await storageSet({ resumeText: parsed.redactedText, resumeFileName: fileName, senderProfile });
  await new Promise(r => chrome.storage.local.remove('resumeBase64', r));

  fillMeCard(senderProfile);
  setResumeFileUi(fileName);
  const nameEl = document.getElementById('user-name');
  if (parsed.name && !nameEl.value.trim()) nameEl.value = parsed.name;

  if (!opts.quiet) {
    const found = [
      senderProfile.schools.length   && `${senderProfile.schools.length} school${senderProfile.schools.length > 1 ? 's' : ''}`,
      senderProfile.employers.length && `${senderProfile.employers.length} employer${senderProfile.employers.length > 1 ? 's' : ''}`,
      senderProfile.skills.length    && `${senderProfile.skills.length} skills`
    ].filter(Boolean);
    if (found.length) setResumeStatus(`Read on this device ✓ Found ${found.join(', ')}. Check them below.`, 'success');
    else setResumeStatus("I read your résumé but couldn't pick out schools, employers or skills. Add them below and I'll use those.", 'pending');
  }
  renderOverlaps(true);
}

async function processResumeFile(file) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (!isPdf)                  { setResumeStatus('Please upload a PDF file.', 'error'); return; }
  if (file.size > 4 * 1024 * 1024) { setResumeStatus('File too large. The limit is 4 MB.', 'error'); return; }

  setResumeStatus('Reading your résumé on this device…', 'pending');
  try {
    const { text, pages, truncated } = await Resume.extractPdfText(await file.arrayBuffer());
    if (text.trim().length < 40) {
      setResumeStatus('No text found. This looks like a scanned PDF. Paste your résumé text below instead.', 'error');
      document.getElementById('resume-paste-card').open = true;
      return;
    }
    await ingestResumeText(text, file.name);
    if (truncated) setResumeStatus(`Read the first 5 of ${pages} pages ✓ Check what I found below.`, 'success');
  } catch (err) {
    setResumeStatus(Resume.explainPdfError(err), 'error');
    document.getElementById('resume-paste-card').open = true;
  }
}

async function removeResume() {
  await new Promise(r => chrome.storage.local.remove(['resumeText', 'resumeFileName', 'senderProfile', 'resumeBase64'], r));
  senderProfile = null;
  document.getElementById('me-card').classList.add('hidden');
  document.getElementById('resume-paste').value = '';
  setResumeFileUi('');
  setResumeStatus('Résumé and extracted info removed from this device.', 'success');
  renderOverlaps(true);
}

// ─── Shared background: what you two have in common ───────────────────────────
let senderProfile = null;
let overlapAll    = [];
const overlapOff  = new Set();
const KIND_LABEL  = { school: 'School', employer: 'Employer', skills: 'Skills', city: 'City' };

const hasResumeInfo = (sp) => !!sp && ((sp.schools || []).length || (sp.employers || []).length || (sp.skills || []).length || sp.city);
const selectedOverlaps = () => overlapAll.filter(o => !overlapOff.has(o.id));
// What we hand to the drafter: the kept overlaps and a compact, contact-free summary of the sender.
const sharedContext = () => ({
  overlaps: selectedOverlaps().map(({ kind, label, detail, line }) => ({ kind, label, detail, line })),
  sender:   hasResumeInfo(senderProfile) ? Overlap.senderSummary(senderProfile) : null
});

function renderOverlaps(keepSelection = false) {
  const panel = document.getElementById('overlap-panel');
  const chips = document.getElementById('overlap-chips');
  const empty = document.getElementById('overlap-empty');
  const hint  = document.getElementById('overlap-hint');
  if (!keepSelection) overlapOff.clear();
  chips.innerHTML = '';
  hint.textContent = '';
  empty.classList.add('hidden');
  if (!currentProfile) { panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');

  if (!hasResumeInfo(senderProfile)) {
    overlapAll = [];
    empty.textContent = 'Add your résumé in Settings and I’ll find shared schools, employers and skills.';
    empty.classList.remove('hidden');
    return;
  }

  overlapAll = Overlap.findOverlaps(senderProfile, currentProfile);
  if (!overlapAll.length) {
    empty.textContent = 'No shared school, employer or skills found. That’s fine: the draft will lead with something from their profile.';
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
  const hasDraft = !document.getElementById('message-section').classList.contains('hidden');
  if (!hasDraft) return;
  const { userApiKey } = await loadStoredSettings();
  if (!(userApiKey || '').trim()) handleRegenerate();   // free drafts update instantly
  else document.getElementById('overlap-hint').textContent = 'Press Regenerate to apply (AI mode uses a request)';
}

function loadStoredSettings() {
  return new Promise(resolve => {
    chrome.storage.local.get(['userApiKey','userName','userBio','resumeText','resumeFileName','resumeBase64','senderProfile'], resolve);
  });
}

function esc(str) {
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
