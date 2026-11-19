'use strict';

// Drafts: Free+ polish, tabs, counter, checklist, format (note vs message)
// Part of the side panel: plain scripts share one page scope (no build step); see popup.html for the load order.

// ─── Free+: instant template drafts first, then Chrome's built-in AI polishes them in place ─────────────────────────
// Guards: only in Free mode, only when the model is ready, only if you are still on the same person and no newer request
// started, and a draft you have already edited is never replaced. Any failure leaves the template drafts exactly as they were.
let polishToken = 0;
let polishAbort = null;
const sendMsg = (msg) => new Promise(r => chrome.runtime.sendMessage(msg, (x) => r(chrome.runtime.lastError ? null : x)));

function cancelPolish() {
  polishToken++;
  if (polishAbort) { try { polishAbort.abort(); } catch (_) { /* already done */ } polishAbort = null; }
  if (polishing) { polishing = false; if (drafts.length) updateDraftMeta(); }
}

async function maybePolishOnDevice(data, resp, profile) {
  cancelPolish();
  if (!resp || resp.source !== 'template' || data.forceFree) return;
  if ((await getModeState()).ai || !(await onDeviceActive())) return;
  const token = polishToken;
  const stale = () => token !== polishToken || currentProfile !== profile;
  const giveUp = (why) => {
    if (token !== polishToken) return;
    polishing = false;
    polishAbort = null;
    if (drafts.length) { updateDraftMeta(); if (why) { const p = document.createElement('p'); p.className = 'draft-note tip'; p.textContent = why; document.getElementById('draft-notes').appendChild(p); } }
  };
  polishing = true;
  if (drafts.length) updateDraftMeta();
  polishAbort = new AbortController();
  const signal = polishAbort.signal;

  const built = await sendMsg({ type: 'BUILD_PROMPT', payload: data });
  if (stale()) return;
  if (!built || !built.success) { giveUp(''); return; }
  const raw = await OnDevice.polish({ system: built.system, user: built.user, schema: built.schema }, { timeoutMs: 25000, signal });
  if (stale()) return;
  if (!raw) { giveUp('On-device AI couldn’t improve these drafts this time, so you’re seeing the free ones.'); return; }
  const fin = await sendMsg({ type: 'FINISH_DRAFTS', payload: { data, raw } });
  if (stale()) return;
  if (!fin || !fin.success || !fin.polished) { giveUp('On-device AI couldn’t improve these drafts this time, so you’re seeing the free ones.'); return; }

  // merge: your edits win; everything else becomes the polished version
  const given = givenSummary();
  const merged = fin.variants.map((v, i) => (drafts[i] && drafts[i].edited ? { ...drafts[i] } : { ...v, given }));
  const keep = activeDraft;
  polishing = false;
  polishAbort = null;
  renderDrafts({ ...fin, variants: merged });
  if (keep > 0 && keep < drafts.length) selectDraft(keep);
  await saveToHistory();
}

// bump = true → "Regenerate" (new wording); false → same drafts re-made after a setting changed
async function regenerate(bump) {
  if (isGenerating || !currentProfile) return;
  if (bump) seed += 3;

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
    setButtonLoading('scrape-btn', 'btn-label', 'btn-spinner', false, 'Read profile &amp; write draft');
  }
}

// Free drafts update instantly when you change a chip / format / tone. AI drafts cost a request, so ask first.
async function applyChangeLive() {
  const hasDraft = !document.getElementById('message-section').classList.contains('hidden');
  if (!hasDraft) return;
  if (!(await getModeState()).ai) regenerate(false);
  else showCurrentStatus('Press Regenerate to apply this (AI mode uses a request).', '');
}

// ─── Drafts: tabs, counter, checklist ─────────────────────────────────────────
let drafts = [];
let activeDraft = 0;
let seed = 0;
let currentFormat = 'note';
let formatByUser = false;    // once you pick a format yourself, we stop choosing for you
let formatAutoNote = '';
let wasOver = false;

const FORMAT_TIP = {
  note:    'For someone you are not connected with yet: this is the note that goes with your connection request. LinkedIn limits it to 200 characters, and free accounts get only a few per month.',
  message: 'For someone you are already connected with: a normal LinkedIn message, up to about 500 characters. Shorter still gets more replies.'
};
let polishing = false;   // on-device AI is working on the instant drafts right now
const sourceLabel = (d) => !d ? '' : d.source === 'ai' ? (AI_PROVIDERS[d.provider] || AI_PROVIDERS.anthropic).badge
  : d.source === 'ondevice' ? 'Written on your device · Chrome’s built-in AI'
  : (polishing ? 'Free draft · polishing on your device…' : 'Free draft · made on your device');

const currentDraftText = () => document.getElementById('generated-message').value;

function draftCtx() {
  const name = (currentProfile && currentProfile.name || '').trim();
  return { format: currentFormat, firstName: name.split(/\s+/)[0] || '', mentions: Compose.mentionsFor(currentProfile, selectedOverlaps()) };
}

function renderDrafts(resp) {
  const wasHidden = document.getElementById('message-section').classList.contains('hidden');
  const list = resp.variants && resp.variants.length ? resp.variants : [{ text: resp.generatedMessage || '', source: 'template' }];
  drafts = list.map(v => ({ text: v.text, source: v.source, hookKind: v.hookKind, provider: v.provider || resp.provider, because: v.because || null, given: v.given || givenSummary(), edited: !!v.edited }));
  document.getElementById('message-section').classList.remove('hidden');
  buildDraftTabs();
  selectDraft(0);
  renderDraftNotes(resp);
  if (wasHidden) scrollIntoViewSoft(document.getElementById('message-section'));   // the draft is the point: bring it into view
}

// Scroll ONLY the panel's content area. Never element.scrollIntoView(): it also scrolls ancestors (even overflow:hidden
// ones, including <html>), which slid the header and tab bar off-screen with no way back.
function scrollIntoViewSoft(el) {
  const box = el && el.closest('.tab-content');
  if (!box) return;
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const top = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - 8;
  try { box.scrollTo({ top: Math.max(0, top), behavior: reduce ? 'auto' : 'smooth' }); } catch (_) { box.scrollTop = Math.max(0, top); }
}

// Safety net: if anything ever scrolls the shell, put it back so the header and tabs are always reachable.
function pinShell() {
  [document.documentElement, document.body, document.querySelector('.app')].forEach(el => { if (el && el.scrollTop) el.scrollTop = 0; });
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
  renderBecause(drafts[i]);
}

function onDraftInput() {
  if (drafts[activeDraft]) { drafts[activeDraft].text = currentDraftText(); drafts[activeDraft].edited = true; }
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
  badge.textContent = sourceLabel(drafts[activeDraft]);

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

// First-run nudge: the resume is what makes drafts specific, but it's optional, so ask once and let it go.
async function refreshResumeTip() {
  const { resumeTipDismissed } = await storageGet(['resumeTipDismissed']);
  document.getElementById('resume-tip').classList.toggle('hidden', !!resumeTipDismissed || hasResumeInfo(senderProfile));
}

// "Built on: …": every draft says what it is made of, so nothing about it is a mystery.
const HOOK_WORD = { school: 'shared school', employer: 'shared employer', skills: 'shared skills', city: 'shared city', post: 'their recent post', role: 'their role' };
function describeBecause(b) {
  const bits = [];
  if (b && b.hook && b.hook.kind && HOOK_WORD[b.hook.kind]) bits.push(b.hook.kind === 'post' || b.hook.kind === 'role' ? HOOK_WORD[b.hook.kind] : `${HOOK_WORD[b.hook.kind]} ${b.hook.label}`);
  const c = b && b.credential;
  if (c && c.kind === 'spotlight') bits.push(`your work “${c.label}”${c.matches && c.matches.length ? ' (' + c.matches.join(', ') + ')' : ''}`);
  else if (c && c.kind === 'intro') bits.push('your intro');
  return bits.join(' · ');
}
// For AI drafts we cannot see inside the model, so we state what we GAVE it.
function givenSummary() {
  const bits = selectedOverlaps().slice(0, 2).map(o => `${HOOK_WORD[o.kind] || o.kind} ${o.label}`);
  const sp = keptSpotlight();
  if (sp) bits.push(`your work “${sp.title}”`);
  if (!bits.length) bits.push('their role and headline');
  bits.push(senderProfile && senderProfile.intro ? 'your intro' : 'your bio');
  return bits.join(' · ');
}
function renderBecause(d) {
  const el = document.getElementById('draft-because');
  const text = d && (d.source === 'ai' || d.source === 'ondevice') ? (d.given ? d.given : '') : (d && d.because ? describeBecause(d.because) : '');
  el.textContent = !text ? '' : d.source === 'ai' ? `Given to the AI: ${text}` : d.source === 'ondevice' ? `Polished on your device from: ${text}` : `Built on: ${text}`;
  el.classList.toggle('hidden', !el.textContent);
}

function renderDraftNotes(resp) {
  const box = document.getElementById('draft-notes');
  box.innerHTML = '';
  const add = (text, kind) => { const p = document.createElement('p'); p.className = `draft-note ${kind || ''}`; p.textContent = text; box.appendChild(p); };
  (resp.warnings || []).forEach(w => add(w, 'warn'));
  if ((resp.injection && resp.injection.length) || resp.aiSawInjection) {
    add('This profile contains text that looks like instructions to an AI. I ignored it and only used the facts.', 'warn');
  }
  if (typeof Approach !== 'undefined' && currentProfile) {
    const move = Approach.approach({
      isConnection: currentProfile.isConnection, overlaps: selectedOverlaps(), recentPosts: currentProfile.recentPosts,
      purpose: document.getElementById('message-type').value
    });
    if (move) add(move, 'tip move');
  }
  if (Spotlight.adviceFor) {
    const pt = document.getElementById('message-type').value;
    Spotlight.adviceFor(pt, { overlaps: selectedOverlaps(), spotlight: keptSpotlight(), sender: senderProfile }).forEach(t => add(t, 'tip'));
  }
  const hasIntro = (senderProfile && senderProfile.intro) || document.getElementById('user-bio').value.trim();
  if (!hasIntro) add('Tip: add a one-line intro in Settings (e.g. “final-year CS student at …”) so your draft can say who you are.', 'tip');
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
// The page tells us whether you are connected (1st-degree badge, or a Connect / Pending button). Pick the matching format
// unless you have chosen one yourself, and always say what we decided and why, so it never feels like magic.
function maybeAutoFormat(profile, { applyLive = false } = {}) {
  if (formatByUser) return;
  const c = profile && profile.isConnection;
  const deg = profile && profile.connectionDegree;
  let want = currentFormat;
  if (c === true)       { want = 'message'; formatAutoNote = 'You are already connected, so I chose “Already connected”.'; }
  else if (c === false) { want = 'note';    formatAutoNote = `You are not connected yet${deg ? ' (' + deg + ' degree)' : ''}, so I chose “New connection”.`; }
  else if (/so I chose/.test(formatAutoNote)) return;   // an earlier, clearer reading of this page stands
  else if (profile && profile.source !== 'pasted') { formatAutoNote = 'I couldn’t tell if you are connected. Choose the right option above.'; }
  else formatAutoNote = '';
  const changed = want !== currentFormat;
  setFormat(want, { silent: true });
  // if a draft is already showing and the format just changed under it, rebuild it (free drafts are instant)
  if (applyLive && changed) applyChangeLive();
}

function setFormat(f, { silent = false } = {}) {
  currentFormat = f === 'message' ? 'message' : 'note';
  document.querySelectorAll('.format-btn').forEach(b => {
    const on = b.dataset.format === currentFormat;
    b.classList.toggle('active', on);
    b.setAttribute('aria-checked', String(on));
  });
  document.getElementById('format-tip').textContent = FORMAT_TIP[currentFormat] + (formatAutoNote ? ' ' + formatAutoNote : '');
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
  if (!/so I chose/.test(formatAutoNote)) setFormat(prefs && prefs.format, { silent: true });   // the page's answer beats a saved preference
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

// Copy, then open LinkedIn's own box for you. It never types or sends: you paste and press Send yourself.
async function handleCopyAndOpen() {
  if (!currentDraftText()) return;
  await handleCopy();
  const want = currentFormat;
  const res = await new Promise(async (resolve) => {
    try { chrome.runtime.sendMessage({ action: 'openComposer', tabId: await activeTabId(), want }, resolve); } catch (_) { resolve(null); }
  });
  const box = want === 'message' ? 'message box' : 'note box';
  if (res && res.success && res.opened === 'connect') {
    showCurrentStatus('Copied. LinkedIn’s connect box is open: click “Add a note”, paste, and press Send yourself.', 'success');
  } else if (res && res.success) {
    showCurrentStatus(`Copied. LinkedIn’s ${box} is open: paste (Ctrl/Cmd+V) and press Send yourself.`, 'success');
  } else if (res && res.reason === 'not-profile') {
    showCurrentStatus(`Copied. Open the person’s LinkedIn profile, click ${want === 'message' ? '“Message”' : '“Connect” → “Add a note”'} and paste.`);
  } else {
    showCurrentStatus(`Copied. I couldn’t find the ${want === 'message' ? '“Message”' : '“Connect”'} button on this page, so click it yourself and paste.`);
  }
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

function showSettingsStatus(msg, type = '', ms = 2500) {
  const el = document.getElementById('settings-status');
  el.textContent = msg;
  el.className = `status-bar${type ? ' status-' + type : ''}`;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), ms);
}

function setButtonLoading(btnId, labelId, spinnerId, loading, labelText) {
  document.getElementById(btnId).disabled = loading;
  document.getElementById(labelId).innerHTML = labelText;
  document.getElementById(spinnerId).classList.toggle('hidden', !loading);
}

