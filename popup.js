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
  document.getElementById('privacy-details-btn').addEventListener('click', showPrivacyDetails);
  document.getElementById('resume-tip-go').addEventListener('click', () => { switchTab('settings'); document.getElementById('file-upload-area').focus(); });
  document.getElementById('resume-tip-dismiss').addEventListener('click', async () => { await storageSet({ resumeTipDismissed: true }); refreshResumeTip(); });
  wireConsentDialog();
  await checkCurrentPage();
  await loadSettings();
  await loadPrefs();
  await renderRecentContacts();
  await refreshModeBadge();
  await refreshResumeTip();
  await onTabContextChanged();
  watchTabs();
});

// ─── Mode badge in header (Free vs AI) ───────────────────────────────────────
async function refreshModeBadge() {
  const s   = await loadStoredSettings();
  const key = (s.userApiKey || '').trim();
  const el  = document.getElementById('key-status');
  el.textContent = key ? '● AI Mode' : '● Free Mode';
  el.className   = 'key-status active';
  document.getElementById('privacy-text').textContent = key
    ? 'AI Mode: a short profile summary goes to Anthropic (your key).'
    : 'Free Mode: everything stays on this device.';
}

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
  document.getElementById('regenerate-btn').addEventListener('click', () => regenerate(true));
  document.getElementById('copy-btn').addEventListener('click', handleCopy);
  document.getElementById('generated-message').addEventListener('input', onDraftInput);
  document.querySelectorAll('.format-btn').forEach(b => b.addEventListener('click', () => setFormat(b.dataset.format)));
  ['message-type', 'tone'].forEach(id => document.getElementById(id).addEventListener('change', () => { savePrefs(); applyChangeLive(); }));
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
    const profile = await sendToBackground({ action: 'scrapeProfile', tabId: await activeTabId() });
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

  seed = 0;
  setBusy('Writing your draft…');
  const resp = await callQuickGenerate(currentProfile);
  renderDrafts(resp);
  await saveToHistory();

  if (confidence !== 'high') showCurrentStatus('Draft ready. I only read part of this profile, so check “What I read” above.', 'warning');
  else if (resp.warnings && resp.warnings.length) showCurrentStatus(resp.warnings[0], 'warning');
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
    if (currentMode === 'deep') await runEnrich(profile);
    else await generateFromProfile(profile, (t) => setButtonLoading('paste-btn', 'paste-label', 'paste-spinner', true, t));
  } catch (err) {
    showCurrentStatus(err.message, 'error');
  } finally {
    isGenerating = false;
    setButtonLoading('paste-btn', 'paste-label', 'paste-spinner', false, 'Use pasted text');
  }
}

async function requestData(profile) {
  const stored = await loadStoredSettings();
  return {
    profileData: profile,
    settings: { userName: stored.userName || '', userBio: stored.userBio || '' },   // not the key, not the résumé text
    messageType: document.getElementById('message-type').value,
    tone: document.getElementById('tone').value,
    format: currentFormat,
    seed,
    ...sharedContext()
  };
}

async function callQuickGenerate(profile) {
  const data = await requestData(profile);
  const choice = await ensureAiConsent(data);
  if (choice === 'cancel') throw new Error('Cancelled. Nothing was sent.');
  if (choice === 'free') data.forceFree = true;
  return sendToBackground({ action: 'generateMessage', data });
}

// bump = true → "Regenerate" (new wording); false → same drafts re-made after a setting changed
async function regenerate(bump) {
  if (isGenerating || !currentProfile) return;
  if (bump) seed += 3;
  if (currentMode === 'deep') { handleDeepGenerate(); return; }

  isGenerating = true;
  setButtonLoading('scrape-btn', 'btn-label', 'btn-spinner', true, 'Writing…');
  try {
    const resp = await callQuickGenerate(currentProfile);
    renderDrafts(resp);
    showCurrentStatus(bump ? 'New drafts ready.' : 'Drafts updated.', 'success');
  } catch (err) {
    showCurrentStatus(err.message, 'error');
  } finally {
    isGenerating = false;
    setButtonLoading('scrape-btn', 'btn-label', 'btn-spinner', false, 'Scrape &amp; Generate');
  }
}

// Free drafts update instantly when you change a chip / format / tone. AI drafts cost a request, so ask first.
async function applyChangeLive() {
  const hasDraft = !document.getElementById('message-section').classList.contains('hidden');
  if (!hasDraft) return;
  const { userApiKey } = await loadStoredSettings();
  if (!(userApiKey || '').trim()) regenerate(false);
  else showCurrentStatus('Press Regenerate to apply this (AI mode uses a request).', '');
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
    const raw = await sendToBackground({ action: 'scrapeProfile', tabId: await activeTabId() });
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
  setButtonLoading('deep-generate-btn', 'deep-gen-label', 'deep-gen-spinner', true, 'Writing draft…');
  setLayerStatus(3, 'running', 'Writing…');
  showCurrentStatus('Writing your draft…');
  hideMessage();

  try {
    const data = await requestData(deepProfileJSON);
    const choice = await ensureAiConsent(data);
    if (choice === 'cancel') throw new Error('Cancelled. Nothing was sent.');
    if (choice === 'free') data.forceFree = true;

    const { profileData, ...rest } = data;
    const response = await new Promise(resolve =>
      chrome.runtime.sendMessage({ type: 'RUN_GENERATE', payload: { profileJSON: profileData, enrichmentJSON: deepEnrichmentJSON, ...rest } }, resolve));

    if (chrome.runtime.lastError || !response) throw new Error('Generation failed. Please try again.');
    if (response.status === 'error') throw new Error(response.error);

    setLayerStatus(3, 'done', 'Done');
    renderDrafts(response);
    const warn = response.warnings && response.warnings.length ? response.warnings[0] : '';
    showCurrentStatus(warn || 'Draft ready. Read it, make it yours, then send it yourself.', warn ? 'warning' : 'success');
    await saveToHistory();
  } catch (err) {
    setLayerStatus(3, 'error', 'Stopped');
    showCurrentStatus(err.message, 'error');
  } finally {
    isGenerating = false;
    setButtonLoading('deep-generate-btn', 'deep-gen-label', 'deep-gen-spinner', false, 'Write Draft');
  }
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

// ─── Drafts: tabs, counter, checklist ─────────────────────────────────────────
let drafts = [];
let activeDraft = 0;
let seed = 0;
let currentFormat = 'note';
let wasOver = false;

const FORMAT_TIP = {
  note:    'LinkedIn limits connection notes to 200 characters, and free accounts get only a few per month. Over 200? Use “Message” after they accept.',
  message: 'For people you’re already connected with. Shorter still gets more replies: aim for under 400 characters.'
};
const SOURCE_LABEL = { template: 'Free draft · made on your device', ai: 'Written by Claude · using your key' };

const currentDraftText = () => document.getElementById('generated-message').value;

function draftCtx() {
  const name = (currentProfile && currentProfile.name || '').trim();
  return { format: currentFormat, firstName: name.split(/\s+/)[0] || '', mentions: Compose.mentionsFor(currentProfile, selectedOverlaps()) };
}

function renderDrafts(resp) {
  const wasHidden = document.getElementById('message-section').classList.contains('hidden');
  const list = resp.variants && resp.variants.length ? resp.variants : [{ text: resp.generatedMessage || '', source: 'template' }];
  drafts = list.map(v => ({ text: v.text, source: v.source, hookKind: v.hookKind }));
  document.getElementById('message-section').classList.remove('hidden');
  buildDraftTabs();
  selectDraft(0);
  renderDraftNotes(resp);
  if (wasHidden) scrollIntoViewSoft(document.getElementById('message-section'));   // the draft is the point: bring it into view
}

function scrollIntoViewSoft(el) {
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  try { el.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' }); } catch (_) { /* older engines */ }
}

function buildDraftTabs() {
  const wrap = document.getElementById('draft-tabs');
  wrap.innerHTML = '';
  drafts.forEach((d, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'draft-tab';
    b.id = `draft-tab-${i}`;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-controls', 'generated-message');
    b.textContent = `Draft ${String.fromCharCode(65 + i)}`;
    b.addEventListener('click', () => selectDraft(i));
    b.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const n = (i + (e.key === 'ArrowRight' ? 1 : drafts.length - 1)) % drafts.length;
      selectDraft(n);
      document.getElementById(`draft-tab-${n}`).focus();
    });
    wrap.appendChild(b);
  });
  wrap.classList.toggle('hidden', drafts.length < 2);
}

function selectDraft(i) {
  activeDraft = i;
  document.getElementById('generated-message').value = drafts[i].text;
  document.querySelectorAll('.draft-tab').forEach((b, k) => {
    b.setAttribute('aria-selected', String(k === i));
    b.tabIndex = k === i ? 0 : -1;
  });
  wasOver = false;
  updateDraftMeta();
}

function onDraftInput() {
  if (drafts[activeDraft]) drafts[activeDraft].text = currentDraftText();
  updateDraftMeta();
}

function updateDraftMeta() {
  const text  = currentDraftText();
  const limit = Compose.LIMITS[currentFormat];
  const over  = text.length > limit;
  const count = document.getElementById('char-count');
  count.textContent = `${text.length} / ${limit}`;
  count.classList.toggle('over', over);
  document.getElementById('generated-message').classList.toggle('over', over);
  if (over !== wasOver) {          // announce only when crossing the limit, not on every keystroke
    document.getElementById('count-live').textContent = over ? `Over the limit by ${text.length - limit} characters.` : 'Back within the limit.';
    wasOver = over;
  }

  // A quoted post comes from their Activity section, which can include things they only reposted or liked.
  document.getElementById('post-note').classList.toggle('hidden', !(drafts[activeDraft] && drafts[activeDraft].hookKind === 'post' && /[“"]/.test(text)));

  const badge = document.getElementById('source-badge');
  badge.textContent = (drafts[activeDraft] && SOURCE_LABEL[drafts[activeDraft].source]) || '';

  const ul = document.getElementById('draft-checklist');
  ul.innerHTML = '';
  Compose.checklist(text, draftCtx()).forEach(item => {
    const li = document.createElement('li');
    li.className = item.ok ? 'ok' : 'todo';
    const mark = document.createElement('span'); mark.className = 'check-mark'; mark.setAttribute('aria-hidden', 'true'); mark.textContent = item.ok ? '✓' : '○';
    const sr = document.createElement('span'); sr.className = 'sr-only'; sr.textContent = item.ok ? 'Done: ' : 'To improve: ';
    const label = document.createElement('span'); label.className = 'check-label'; label.textContent = item.label;
    li.append(mark, sr, label);
    if (item.detail) { const d = document.createElement('span'); d.className = 'check-detail'; d.textContent = item.detail; li.appendChild(d); }
    ul.appendChild(li);
  });
}

// First-run nudge: the résumé is what makes drafts specific, but it's optional, so ask once and let it go.
async function refreshResumeTip() {
  const { resumeTipDismissed } = await storageGet(['resumeTipDismissed']);
  document.getElementById('resume-tip').classList.toggle('hidden', !!resumeTipDismissed || hasResumeInfo(senderProfile));
}

function renderDraftNotes(resp) {
  const box = document.getElementById('draft-notes');
  box.innerHTML = '';
  const add = (text, kind) => { const p = document.createElement('p'); p.className = `draft-note ${kind || ''}`; p.textContent = text; box.appendChild(p); };
  (resp.warnings || []).forEach(w => add(w, 'warn'));
  if ((resp.injection && resp.injection.length) || resp.aiSawInjection) {
    add('This profile contains text that looks like instructions to an AI. I ignored it and only used the facts.', 'warn');
  }
  const hasIntro = (senderProfile && senderProfile.intro) || document.getElementById('user-bio').value.trim();
  if (!hasIntro) add('Tip: add a one-line intro in Settings (e.g. “final-year CS student at …”) so your draft can say who you are.', 'tip');
  if (currentProfile && (currentProfile.recentPosts || []).length) {
    add('Tip: like or comment on one of their posts first. In one vendor dataset, warm messages got about 4× the replies (directional, not a guarantee).', 'tip');
  }
}

function hideMessage() {
  document.getElementById('message-section').classList.add('hidden');
  drafts = [];
}

async function saveToHistory() {
  const text = currentDraftText();
  if (!currentProfile || !text) return;
  await Cache.addContact({
    profileUrl: currentProfile.profileUrl || '',
    name:       currentProfile.name || 'Unknown',
    headline:   currentProfile.headline || '',
    company:    currentProfile.currentCompany || '',
    message:    text,
    timestamp:  Date.now()
  });
}

// ─── Format (note vs message) + remembered preferences ─────────────────────────
function setFormat(f, { silent = false } = {}) {
  currentFormat = f === 'message' ? 'message' : 'note';
  document.querySelectorAll('.format-btn').forEach(b => {
    const on = b.dataset.format === currentFormat;
    b.classList.toggle('active', on);
    b.setAttribute('aria-checked', String(on));
  });
  document.getElementById('format-tip').textContent = FORMAT_TIP[currentFormat];
  document.getElementById('generated-message').rows = currentFormat === 'note' ? 5 : 10;
  if (silent) return;
  savePrefs();
  applyChangeLive();
}

async function loadPrefs() {
  const { prefs } = await loadStoredSettings();
  if (prefs) {
    if (prefs.messageType) document.getElementById('message-type').value = prefs.messageType;
    if (prefs.tone)        document.getElementById('tone').value = prefs.tone;
  }
  setFormat(prefs && prefs.format, { silent: true });
}

function savePrefs() {
  storageSet({ prefs: { format: currentFormat, messageType: document.getElementById('message-type').value, tone: document.getElementById('tone').value } });
}

async function handleCopy() {
  const text = currentDraftText();
  if (!text) return;
  try { await navigator.clipboard.writeText(text); } catch(_) {
    const ta = document.getElementById('generated-message');
    ta.select(); document.execCommand('copy');
  }
  saveToHistory();   // keep what you actually copied (with your edits) in Recent
  const btn = document.getElementById('copy-btn');
  btn.textContent = '✓ Copied';
  btn.classList.add('btn-secondary'); btn.classList.remove('btn-primary');
  setTimeout(() => {
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" stroke-width="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" stroke-width="2"/></svg> Copy`;
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
  document.getElementById('recent-subtitle').textContent = `${contacts.length} recent draft${contacts.length > 1 ? 's' : ''}`;
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
      <button class="btn-link" id="sent-${idx}" aria-pressed="${contact.sent ? 'true' : 'false'}">${contact.sent ? '✓ Sent' : 'Mark as sent'}</button>
      <button class="btn btn-sm btn-primary" id="copy-c-${idx}">Copy</button>
    </div>`;

  card.querySelector(`#expand-${idx}`).addEventListener('click', () => {
    const isHidden = card.querySelector(`#full-${idx}`).classList.contains('hidden');
    card.querySelector(`#prev-${idx}`).classList.toggle('hidden', isHidden);
    card.querySelector(`#full-${idx}`).classList.toggle('hidden', !isHidden);
    card.querySelector(`#expand-${idx}`).textContent = isHidden ? 'Show less' : 'Show full message';
  });

  const sentBtn = card.querySelector(`#sent-${idx}`);
  sentBtn.addEventListener('click', async () => {
    const next = !contact.sent;
    contact.sent = next;
    await Cache.setSent(contact, next);
    sentBtn.textContent = next ? '✓ Sent' : 'Mark as sent';
    sentBtn.setAttribute('aria-pressed', String(next));
  });

  card.querySelector(`#copy-c-${idx}`).addEventListener('click', async () => {
    await navigator.clipboard.writeText(contact.message || '').catch(() => {});
    const btn = card.querySelector(`#copy-c-${idx}`);
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy'; }, 2200);
  });

  return card;
}

// ─── Consent: show exactly what AI Mode sends ─────────────────────────────────
const CONSENT_VERSION = 1;
let consentResolve = null;

async function previewPayload(data) {
  return new Promise(resolve => chrome.runtime.sendMessage({ type: 'PREVIEW_PAYLOAD', payload: data }, resolve));
}

function openDialog(dlg) {
  if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
}
function closeDialog(dlg) {
  if (typeof dlg.close === 'function') dlg.close(); else dlg.removeAttribute('open');
}

function wireConsentDialog() {
  const dlg = document.getElementById('consent-dialog');
  const done = (choice) => {
    closeDialog(dlg);
    const r = consentResolve; consentResolve = null;
    if (r) r(choice);
  };
  document.getElementById('consent-send').addEventListener('click', async () => {
    await storageSet({ aiConsent: { ackAt: Date.now(), version: CONSENT_VERSION } });
    done('send');
  });
  document.getElementById('consent-free').addEventListener('click', () => done('free'));
  document.getElementById('consent-cancel').addEventListener('click', () => done('cancel'));
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); done('cancel'); });   // Esc
}

// 'send' | 'free' | 'cancel'. Asked once per consent version, only when an API key is saved.
async function ensureAiConsent(data) {
  const s = await loadStoredSettings();
  if (!(s.userApiKey || '').trim()) return 'send';
  if (s.aiConsent && s.aiConsent.version === CONSENT_VERSION) return 'send';
  return showConsentDialog(data, false);
}

async function showConsentDialog(data, viewOnly) {
  const prev = await previewPayload(data);
  const dlg = document.getElementById('consent-dialog');
  document.getElementById('consent-desc').textContent = viewOnly
    ? 'This is what AI Mode sends for the current profile. In Free Mode nothing is sent.'
    : 'You added your own Anthropic key, so Claude writes the draft. Please check what it will receive. You’ll only be asked once.';
  document.getElementById('consent-model').textContent = (prev && prev.model) || '';
  document.getElementById('consent-payload').textContent = (prev && prev.success) ? prev.user : (prev && prev.error) || 'Could not build a preview.';
  document.getElementById('consent-system').textContent = (prev && prev.system) || '';
  document.getElementById('consent-send').classList.toggle('hidden', viewOnly);
  document.getElementById('consent-free').classList.toggle('hidden', viewOnly);
  document.getElementById('consent-cancel').textContent = viewOnly ? 'Close' : 'Cancel';
  openDialog(dlg);
  document.getElementById(viewOnly ? 'consent-cancel' : 'consent-send').focus();
  return new Promise(resolve => { consentResolve = resolve; });
}

async function showPrivacyDetails() {
  if (currentProfile) {
    const { userApiKey } = await loadStoredSettings();
    if ((userApiKey || '').trim()) { await showConsentDialog(await requestData(currentProfile), true); return; }
  }
  switchTab('settings');
  document.querySelector('.settings-note').scrollIntoView({ block: 'center' });
  document.querySelector('.settings-note').focus?.();
}

async function activeTabId() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] ? tabs[0].id : undefined;
}

// Identity of "the page I'm on". Same profile ⇒ same key, even when LinkedIn adds #hash, ?query or opens
// /overlay/contact-info/ (which changes the URL but not the person).
function pageKey(url) {
  const m = String(url || '').match(/linkedin\.com\/in\/([^/?#]+)/i);
  return m ? `in/${decodeURIComponent(m[1]).toLowerCase()}` : String(url || '').split(/[?#]/)[0];
}

// ─── Follow the active tab (the side panel stays open while you browse) ───────
let lastPageUrl = null;

async function onTabContextChanged() {
  await checkCurrentPage();
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const key = pageKey(tabs[0] && tabs[0].url);
  if (lastPageUrl !== null && key !== lastPageUrl) resetForNewPage();
  lastPageUrl = key;
}

// A draft written for one person must never sit under another person's profile.
function resetForNewPage() {
  if (isGenerating || isEnriching) return;
  if (!currentProfile && !drafts.length) return;
  currentProfile = null; deepProfileJSON = null; deepEnrichmentJSON = null;
  overlapAll = []; overlapOff.clear(); seed = 0;
  ['profile-section', 'read-card', 'overlap-panel'].forEach(id => document.getElementById(id).classList.add('hidden'));
  document.getElementById('hooks-panel').classList.add('hidden');
  document.getElementById('deep-generate-btn').disabled = true;
  resetLayerStatuses();
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

// ─── Résumé: PDF → text → editable profile (all on-device) ─────────────────────
const toList = (v) => String(v || '').split(/[,;\n]/).map(x => x.trim()).filter(Boolean);
const storageSet = (o) => new Promise(r => chrome.storage.local.set(o, r));
const storageGet = (keys) => new Promise(r => chrome.storage.local.get(keys, r));

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
  refreshResumeTip();
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
  refreshResumeTip();
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
  applyChangeLive();
}

function loadStoredSettings() {
  return new Promise(resolve => {
    chrome.storage.local.get(['userApiKey','userName','userBio','resumeText','resumeFileName','resumeBase64','senderProfile','prefs','aiConsent','resumeTipDismissed'], resolve);
  });
}

function esc(str) {
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
