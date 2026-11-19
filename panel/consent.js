'use strict';

// Consent dialog: shows exactly what AI Mode sends
// Part of the side panel: plain scripts share one page scope (no build step); see popup.html for the load order.

// ─── Consent: show exactly what AI Mode sends ─────────────────────────────────
const CONSENT_VERSION = 2;   // 2 = one consent for drafts and resume reading
let consentResolve = null;
let consentKind = 'view';

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
    const { userApiKey, aiProvider } = await loadStoredSettings();
    await storageSet({ aiConsent: { ackAt: Date.now(), version: CONSENT_VERSION, provider: resolveProvider(aiProvider, userApiKey).id } });
    done('send');
  });
  document.getElementById('consent-free').addEventListener('click', () => done('free'));
  document.getElementById('consent-cancel').addEventListener('click', () => done('cancel'));
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); done('cancel'); });   // Esc
}

const ENABLE_SUMMARY = [
  'When you press "Read profile & write draft":',
  '  • a short, cleaned-up summary of the LinkedIn profile you are viewing (name, headline, role, about, a few posts, skills, education)',
  '  • what you two have in common, your name and bio, and your profile details',
  '',
  'When you upload a resume:',
  '  • the resume text, with emails and phone numbers already removed',
  '',
  'Never sent: the PDF itself, emails, phone numbers, anything else on the page.',
  'Your key goes only in the request header, to this provider.'
].join('\n');

async function showConsentDialog(data, viewOnly, opts = {}) {
  consentKind = opts.kind || 'view';
  const isEnable = consentKind === 'enable';
  const prev = isEnable
    ? { success: true, providerName: opts.provider.name, host: opts.provider.host, model: opts.provider.model || '', user: ENABLE_SUMMARY, system: '' }
    : await previewPayload(data);
  const dlg = document.getElementById('consent-dialog');
  const pname = (prev && prev.providerName) || 'your AI provider';
  document.getElementById('consent-title').textContent = isEnable ? `Turn on AI with ${pname}?` : `What AI Mode sends to ${pname}`;
  document.getElementById('consent-desc').textContent = isEnable
    ? `${pname} will write your drafts and read your resume using your own key. You say yes once; after that nothing asks again. Switch back to Free any time from the top bar.`
    : 'This is what AI Mode sends for the current profile. In Free Mode nothing is sent.';
  document.getElementById('consent-host').textContent = (prev && prev.host) || '';
  document.getElementById('consent-model').textContent = (prev && prev.model) || '';
  document.getElementById('consent-what').textContent = isEnable ? 'when you use AI:' : 'for this draft:';
  document.getElementById('consent-instr').classList.toggle('hidden', isEnable);
  document.getElementById('consent-notsent').classList.toggle('hidden', isEnable);
  document.getElementById('consent-payload').textContent = (prev && prev.success) ? prev.user : (prev && prev.error) || 'Could not build a preview.';
  document.getElementById('consent-system').textContent = (prev && prev.system) || '';
  document.getElementById('consent-send').classList.toggle('hidden', !isEnable);
  document.getElementById('consent-free').classList.add('hidden');
  document.getElementById('consent-send').textContent = 'Turn on AI';
  document.getElementById('consent-cancel').textContent = isEnable ? 'Not now' : 'Close';
  openDialog(dlg);
  document.getElementById(isEnable ? 'consent-send' : 'consent-cancel').focus();
  return new Promise(resolve => { consentResolve = resolve; });
}

async function showPrivacyDetails() {
  if (currentProfile) {
    if ((await getModeState()).ai) { await showConsentDialog(await requestData(currentProfile), true); return; }
  }
  switchTab('settings');
  document.getElementById('privacy-note').open = true;
  scrollIntoViewSoft(document.querySelector('.settings-note'));
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

