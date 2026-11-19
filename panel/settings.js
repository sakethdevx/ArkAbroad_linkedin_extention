'use strict';

// Settings: load, save and the folding cards
// Part of the side panel: plain scripts share one page scope (no build step); see popup.html for the load order.

// ─── Settings ─────────────────────────────────────────────────────────────────
async function loadSettings() {
  let s = await loadStoredSettings();
  if (!s.mode) { await storageSet({ mode: (await getModeState(s)).mode }); }   // remember the choice from now on
  if (s.userApiKey) document.getElementById('api-key').value = s.userApiKey;
  setProvider(resolveProvider(s.aiProvider, s.userApiKey).id);
  if (s.userName)   document.getElementById('user-name').value   = s.userName;
  if (s.userBio)    document.getElementById('user-bio').value    = s.userBio;

  // v3.1 stored the whole PDF as base64 and never used it. Convert once to text, then delete the blob.
  if (s.resumeBase64) {
    try {
      if (!s.resumeText) {
        const bin = atob(s.resumeBase64);
        const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
        const { text } = await Resume.extractPdfText(bytes);
        if (text.trim().length >= 40) await ingestResumeText(text, s.resumeFileName || 'Resume', { quiet: true });
      }
    } catch (_) { /* fall through: the user can re-upload */ }
    await new Promise(r => chrome.storage.local.remove('resumeBase64', r));
    s = await loadStoredSettings();
  }

  renderAboutSummary();
  document.getElementById('about-card').open = !s.userName || !s.resumeFileName;   // folds once you are set up
  document.getElementById('ai-setup').open = !(s.userApiKey || '').trim();   // folds to one line once a key is saved
  senderProfile = s.senderProfile || null;
  if (senderProfile || s.resumeFileName) {
    fillMeCard(senderProfile || {});
    setResumeFileUi(s.resumeFileName);
    setResumeStatus(`${s.resumeFileName || 'Resume'} read on this device ✓`, 'success');
  }
}

async function handleSaveSettings() {
  // Ask for any needed host permission FIRST: Chrome only allows the prompt directly from this click.
  const userApiKey = document.getElementById('api-key').value.trim();
  const userName   = document.getElementById('user-name').value.trim();
  const userBio    = document.getElementById('user-bio').value.trim();
  const provider   = userApiKey ? resolveProvider(AI_PROVIDERS[selectedProvider].prefix.test(userApiKey) ? selectedProvider : undefined, userApiKey) : AI_PROVIDERS[selectedProvider];

  const toSave = { userName, userBio };
  let keyDenied = false;
  if (!userApiKey) {
    toSave.userApiKey = '';                                  // empty = Free Mode
  } else if (await ensureProviderAccess(provider)) {
    toSave.userApiKey = userApiKey;
    toSave.aiProvider = provider.id;
    if (provider.id !== selectedProvider) setProvider(provider.id);
  } else {
    keyDenied = true;                                        // never keep a key we can't use
  }

  await new Promise(resolve => chrome.storage.local.set(toSave, resolve));
  await saveSenderFromCard({ quiet: true });

  // A key you just saved means you want AI: ask the one-time yes, then switch on. No key → Free.
  let msg = 'Settings saved!', kind = 'success', turnedOn = false;
  if (keyDenied) {
    msg = `Your key wasn't saved: ${provider.name} needs permission to contact ${provider.host}. Press Save again and choose Allow.`; kind = 'error';
  } else if (toSave.userApiKey) {
    if (await ensureAiEnabled()) { await setAiMode('ai'); msg = `Saved. AI is on (${provider.name}).`; turnedOn = true; }
    else { await setAiMode('free'); msg = 'Saved. AI stays off until you tap AI in the top bar.'; }
  } else if (!userApiKey) {
    await setAiMode('free');
  }
  showSettingsStatus(msg, kind, keyDenied ? 6000 : 3500);
  await refreshModeBadge();
  if (turnedOn) await autoReadResumeWithAi();
}

// After AI is switched on, an already-uploaded resume gets the same full read, so the student never has to ask.
// Turning on on-device AI with a resume already uploaded: give it the same full read, so nobody has to ask.
async function autoReadResumeOnDevice() {
  if ((await getModeState()).ai) return;
  const { resumeText } = await storageGet(['resumeText']);
  if (resumeText && (!senderProfile || !['ai', 'ondevice'].includes(senderProfile.source))) await tryOnDeviceResume(resumeText);
}

async function autoReadResumeWithAi() {
  const { resumeText } = await storageGet(['resumeText']);
  if (resumeText && (!senderProfile || senderProfile.source !== 'ai')) await tryAiResume(resumeText);
}

async function handleValidateKey() {
  const apiKey = document.getElementById('api-key').value.trim();
  if (!apiKey) return;

  const provider = resolveProvider(AI_PROVIDERS[selectedProvider].prefix.test(apiKey) ? selectedProvider : undefined, apiKey);
  if (provider.id !== selectedProvider) setProvider(provider.id);
  const el0 = document.getElementById('key-validation-status');
  if (!(await ensureProviderAccess(provider))) {
    el0.classList.remove('hidden');
    el0.textContent = `✗ Allow access to ${provider.host} to test this key.`;
    el0.className = 'key-validation-status invalid';
    return;
  }

  const btn = document.getElementById('validate-btn');
  btn.textContent = '…';
  btn.disabled = true;

  const result = await new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'TEST_API_KEY', payload: { apiKey, provider: provider.id } }, resolve);
  });

  btn.textContent = 'Connect';
  btn.disabled = false;

  const el = document.getElementById('key-validation-status');
  el.classList.remove('hidden');

  if (result && result.valid) {
    // A working key is all the setup there is: save it and go straight to the one-time yes. No second "Save" step.
    await storageSet({ userApiKey: apiKey, aiProvider: provider.id });
    const on = await ensureAiEnabled();
    await setAiMode(on ? 'ai' : 'free');
    el.textContent = on ? `✓ Connected. AI is on (${provider.name}).` : `✓ ${provider.name} key works and is saved. AI is off: tap AI in the top bar when you want it.`;
    el.className   = 'key-validation-status valid';
    if (on) await autoReadResumeWithAi();
  } else {
    el.textContent = `✗ ${result?.reason || 'Key did not work'}`;
    el.className   = 'key-validation-status invalid';
  }
}

