'use strict';

// On-device AI (Free+) and write-in-their-language (translation) controls
// Part of the side panel: plain scripts share one page scope (no build step); see popup.html for the load order.

// ─── On-device AI (Chrome's built-in model): a free "Free+" for people with no key ─────────
// Hardware-gated (desktop, ~22 GB free disk, 16 GB RAM or a 4 GB GPU), so the card only appears where Chrome has the API,
// and says plainly when this computer does not qualify. Turning it on starts Chrome's one-time model download from a click.
async function refreshOnDeviceCard() {
  const card = document.getElementById('ondevice-card');
  if (typeof OnDevice === 'undefined') return;
  const st = await OnDevice.status();
  const { onDevice } = await storageGet(['onDevice']);
  const chip = document.getElementById('ondevice-status'), hint = document.getElementById('od-hint');
  const on = document.getElementById('od-enable'), off = document.getElementById('od-disable');
  const hasApi = typeof LanguageModel !== 'undefined';
  card.classList.toggle('hidden', !hasApi);
  if (!hasApi) return;
  const active = !!onDevice && st === 'available';
  on.classList.toggle('hidden', active || st === 'unsupported' || st === 'downloading');
  off.classList.toggle('hidden', !active);
  chip.classList.toggle('ok', active);
  if (st === 'unsupported') {
    chip.textContent = 'Not available here';
    hint.textContent = 'This computer doesn’t meet Chrome’s requirements for built-in AI (desktop Chrome 138 or newer, about 22 GB free disk, and 16 GB of memory or a graphics card with 4 GB+). Everything else works as usual.';
  } else if (st === 'downloading') {
    chip.textContent = 'Downloading…';
    hint.textContent = 'Chrome is downloading its AI model. You can keep working.';
  } else if (st === 'downloadable') {
    chip.textContent = 'Ready to set up';
    on.textContent = 'Turn on (one-time download)';
    hint.textContent = 'Chrome downloads its AI model once; it is large, so use a good connection. Your drafts and your profile never leave your computer.';
  } else if (active) {
    chip.textContent = 'On';
    hint.textContent = 'In Free Mode your drafts appear instantly, then get polished on this device. Turn the switch to AI for your own key instead.';
  } else {
    chip.textContent = 'Off';
    on.textContent = 'Turn on';
    hint.textContent = 'The model is ready on this computer. Turn it on to polish your free drafts.';
  }
}

async function onDeviceActive() {
  if (typeof OnDevice === 'undefined') return false;
  const { onDevice } = await storageGet(['onDevice']);
  return !!onDevice && (await OnDevice.status()) === 'available';
}

function wireOnDevice() {
  const bar = document.getElementById('od-bar'), wrap = document.getElementById('od-progress');
  document.getElementById('od-enable').addEventListener('click', async () => {
    const btn = document.getElementById('od-enable');
    btn.disabled = true;
    wrap.classList.remove('hidden');
    document.getElementById('od-hint').textContent = 'Setting up… this can take a few minutes the first time.';
    const res = await OnDevice.enable((f) => { bar.style.width = `${Math.round(f * 100)}%`; wrap.setAttribute('aria-valuenow', String(Math.round(f * 100))); });
    btn.disabled = false;
    wrap.classList.add('hidden');
    bar.style.width = '0';
    if (res.ok) await storageSet({ onDevice: true });
    await refreshOnDeviceCard();
    if (res.ok) { await refreshAiResumeBtn(); await autoReadResumeOnDevice(); }
    if (!res.ok) document.getElementById('od-hint').textContent = res.reason === 'NotAllowedError'
      ? 'Chrome needs a click to start the download. Press Turn on again.'
      : 'Chrome couldn’t set up its AI model on this computer. Your free drafts still work as before.';
  });
  document.getElementById('od-disable').addEventListener('click', async () => { await storageSet({ onDevice: false }); await refreshOnDeviceCard(); });
}

// ─── Write in another language (on-device Translator + Language Detector) ──────────────────────────────────────────
// The English draft stays the source of truth. The translation is shown next to a back-translation into English, so you
// can see what you are about to send even if you do not speak the language. Nothing is sent anywhere.
const trEl = (id) => document.getElementById(id);
let trBack = '';
const langName = (code) => { try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) || code; } catch (_) { return code; } };

function setupTranslateCard() {
  const card = trEl('translate-card');
  const ok = typeof Translate !== 'undefined' && Translate.supported();
  card.classList.toggle('hidden', !ok);
  if (!ok) return false;
  const sel = trEl('tr-lang');
  if (!sel.options.length) Translate.LANGS.forEach(c => { const o = document.createElement('option'); o.value = c; o.textContent = langName(c); sel.appendChild(o); });
  return true;
}

function resetTranslate() {
  trBack = '';
  if (!trEl('tr-result')) return;
  trEl('tr-result').classList.add('hidden');
  trEl('tr-out').value = '';
  trEl('tr-back').textContent = '';
  trEl('tr-msg').textContent = '';
  trEl('tr-hint').textContent = '';
  trEl('tr-check').classList.add('hidden');
  trEl('translate-card').open = false;
}

// After a profile is read: if their text is clearly in another language, say so and pre-select it. Silent when unsure.
async function suggestTranslation(profile) {
  if (!setupTranslateCard()) return;
  resetTranslate();
  const text = [profile.about, profile.headline, ...(profile.recentPosts || [])].filter(Boolean).join('. ');
  const det = await Translate.detect(text);
  if (!det || currentProfile !== profile) return;
  trEl('tr-lang').value = det.lang;
  trEl('tr-hint').textContent = `Their profile looks ${langName(det.lang)}`;
  trEl('translate-card').open = true;
}

function showTrLength() {
  const n = trEl('tr-out').value.length, limit = Compose.LIMITS[currentFormat];
  const el = trEl('tr-count');
  el.textContent = `${n} characters` + (currentFormat === 'note' ? ` (LinkedIn notes allow ${limit})` : '');
  el.classList.toggle('over', n > limit);
}

async function checkInEnglish(lang, text) {
  trEl('tr-check').classList.add('hidden');
  trEl('tr-back').textContent = 'Checking what it says…';
  const b = await Translate.back(text, lang, (f) => setTrProgress(f));
  setTrProgress(null);
  if (b.ok) { trBack = b.text; trEl('tr-back').textContent = b.text; trEl('tr-msg').textContent = ''; return; }
  trEl('tr-back').textContent = 'Not checked yet.';
  trEl('tr-check').classList.remove('hidden');
  trEl('tr-msg').textContent = b.reason === 'NotAllowedError' ? 'Press “Check it in English” so Chrome can set up the checker.' : 'The English check isn’t available for this language on this computer.';
}

function setTrProgress(f) {
  const wrap = trEl('tr-progress');
  if (f === null) { wrap.classList.add('hidden'); trEl('tr-bar').style.width = '0'; return; }
  wrap.classList.remove('hidden');
  trEl('tr-bar').style.width = `${Math.round(f * 100)}%`;
  wrap.setAttribute('aria-valuenow', String(Math.round(f * 100)));
}

function wireTranslate() {
  trEl('tr-go').addEventListener('click', async () => {
    const lang = trEl('tr-lang').value, text = currentDraftText();
    if (!text.trim()) { trEl('tr-msg').textContent = 'Write or generate a draft first.'; return; }
    const btn = trEl('tr-go');
    btn.disabled = true;
    trEl('tr-msg').textContent = `Translating into ${langName(lang)}… the first time Chrome may download a small model.`;
    const r = await Translate.translate(text, lang, (f) => setTrProgress(f));
    setTrProgress(null);
    btn.disabled = false;
    if (!r.ok) {
      trEl('tr-msg').textContent = r.reason === 'pair-unavailable' ? `Chrome can’t translate English to ${langName(lang)} on this computer.`
        : r.reason === 'NotAllowedError' ? 'Chrome needs a click to start the download. Press Translate again.'
        : 'The translation didn’t work this time. Your English draft is unchanged.';
      return;
    }
    trEl('tr-msg').textContent = '';
    trEl('tr-result').classList.remove('hidden');
    trEl('tr-out').value = r.text;
    showTrLength();
    await checkInEnglish(lang, r.text);
  });
  trEl('tr-out').addEventListener('input', showTrLength);
  trEl('tr-check').addEventListener('click', () => checkInEnglish(trEl('tr-lang').value, trEl('tr-out').value));
  trEl('tr-copy').addEventListener('click', async () => {
    await navigator.clipboard.writeText(trEl('tr-out').value).catch(() => {});
    const b = trEl('tr-copy'); b.textContent = 'Copied!';
    setTimeout(() => { b.textContent = 'Copy translation'; }, 2200);
  });
}

