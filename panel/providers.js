'use strict';

// AI providers (bring your own key) and the Free | AI switch
// Part of the side panel: plain scripts share one page scope (no build step); see popup.html for the load order.

// ─── AI providers (bring your own key) ───────────────────────────────────────
// Keep in sync with PROVIDERS in background.js. Groq's host is an OPTIONAL permission, requested only when it's chosen.
const AI_PROVIDERS = {
  anthropic: { id: 'anthropic', name: 'Anthropic', host: 'api.anthropic.com', model: 'claude-haiku-5-5', origin: null, placeholder: 'sk-ant-…', prefix: /^sk-ant-/, badge: 'Written by Claude · using your key',
    help: 'Get a key at console.anthropic.com. Pay as you go.', link: 'https://console.anthropic.com/settings/keys', linkText: 'Open Anthropic Console' },
  groq:      { id: 'groq', name: 'Groq', host: 'api.groq.com', model: 'llama-3.3-70b-versatile', origin: 'https://api.groq.com/*', placeholder: 'gsk_…', prefix: /^gsk_/, badge: 'Written by Llama via Groq · using your key',
    help: 'Groq has a free plan with usage limits. Saving asks Chrome to allow access to api.groq.com.', link: 'https://console.groq.com/keys', linkText: 'Get a Groq key' }
};
let selectedProvider = 'anthropic';

// explicit choice → key prefix → Anthropic (the original behaviour)
function resolveProvider(chosen, key) {
  if (AI_PROVIDERS[chosen]) return AI_PROVIDERS[chosen];
  const k = String(key || '').trim();
  return Object.values(AI_PROVIDERS).find(p => p.prefix.test(k)) || AI_PROVIDERS.anthropic;
}

function setProvider(id) {
  selectedProvider = AI_PROVIDERS[id] ? id : 'anthropic';
  const p = AI_PROVIDERS[selectedProvider];
  document.querySelectorAll('.provider-btn').forEach(b => {
    const on = b.dataset.provider === p.id;
    b.classList.toggle('active', on);
    b.setAttribute('aria-checked', String(on));
  });
  document.getElementById('api-key').placeholder = p.placeholder;
  const help = document.getElementById('provider-help');
  help.textContent = p.help + ' ';
  const a = document.createElement('a');
  a.href = p.link; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = p.linkText;
  help.appendChild(a);
}

// Optional host permissions can only be requested from a user gesture, so call this FIRST in a click handler.
async function ensureProviderAccess(p) {
  if (!p.origin) return true;
  try {
    if (await chrome.permissions.contains({ origins: [p.origin] })) return true;
    return await chrome.permissions.request({ origins: [p.origin] });
  } catch (err) { debug('host permission check', err); return false; }
}

function wireProviderUi() {
  document.querySelectorAll('.provider-btn').forEach(b => b.addEventListener('click', () => setProvider(b.dataset.provider)));
  // pasting a key picks the matching provider for you (gsk_… → Groq, sk-ant-… → Anthropic)
  document.getElementById('api-key').addEventListener('input', (e) => {
    const hit = Object.values(AI_PROVIDERS).find(p => p.prefix.test(e.target.value.trim()));
    if (hit && hit.id !== selectedProvider) setProvider(hit.id);
  });
  setProvider(selectedProvider);
}

// ─── Mode: Free ⇄ AI (one switch in the header; the choice is remembered) ─────
// mode 'ai' only takes effect while a key is saved; the key stays saved when you switch back to Free.
async function getModeState(s) {
  s = s || await loadStoredSettings();
  const key = (s.userApiKey || '').trim();
  const provider = resolveProvider(s.aiProvider, key);
  const consentOk = !!s.aiConsent && (s.aiConsent.provider || 'anthropic') === provider.id;
  const mode = s.mode || (key && consentOk ? 'ai' : 'free');   // before the switch existed: a key with consent meant AI
  return { key, provider, mode, ai: mode === 'ai' && !!key, hasKey: !!key, consent: s.aiConsent };
}

async function refreshModeBadge() {
  const m = await getModeState();
  document.getElementById('mode-free').setAttribute('aria-pressed', String(!m.ai));
  document.getElementById('mode-ai').setAttribute('aria-pressed', String(m.ai));
  document.getElementById('key-status').textContent = m.ai ? `AI Mode · ${m.provider.name}` : 'Free Mode';
  document.getElementById('privacy-text').textContent = m.ai
    ? `AI Mode: a short profile summary goes to ${m.provider.name} (your key).`
    : `Free Mode: everything stays on this device.${m.hasKey ? ' AI is ready. Tap AI to use it.' : ''}`;
  const chip = document.getElementById('ai-setup-status');
  chip.textContent = m.hasKey ? `${m.ai ? 'On' : 'Saved'} · ${m.provider.name}` : 'Not set up';
  chip.classList.toggle('ok', m.ai);
  refreshAiResumeBtn();
}

async function setAiMode(mode) {
  await storageSet({ mode });
  await refreshModeBadge();
}

// The one-time "yes, use my key" step. Covers drafts AND resume reading, so nothing asks again afterwards.
async function ensureAiEnabled() {
  const m = await getModeState();
  if (!m.hasKey) return false;
  if (m.consent && m.consent.version >= CONSENT_VERSION && (m.consent.provider || 'anthropic') === m.provider.id) return true;
  return (await showConsentDialog(null, false, { kind: 'enable', provider: m.provider })) === 'send';
}

async function turnOnAi() {
  const m = await getModeState();
  if (!m.hasKey) {
    switchTab('settings');
    document.getElementById('api-key').focus();
    showSettingsStatus('Add your API key below and press Save. That turns AI on.', '', 8000);
    return;
  }
  if (!(await ensureAiEnabled())) { showCurrentStatus('AI stays off. Free Mode still works.', ''); return; }
  await setAiMode('ai');
  showCurrentStatus(`AI is on (${m.provider.name}). Your next draft is written by AI.`, 'success');
  await autoReadResumeWithAi();
}

async function turnOffAi() {
  await setAiMode('free');
  showCurrentStatus('Free Mode: drafts are written on this device and nothing is sent.', 'success');
}

function wireModeSwitch() {
  document.getElementById('mode-free').addEventListener('click', turnOffAi);
  document.getElementById('mode-ai').addEventListener('click', turnOnAi);
}

