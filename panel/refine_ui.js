'use strict';

// "Want a change?": tell Outreach AI what to change in the draft you are looking at, and it is rewritten.
// The rules and engines live in utils/refine.js (AI Mode → your AI; Free Mode + on-device AI → Chrome's model; otherwise free rules).
// A rewrite replaces only the selected draft, keeps a version history for Undo, and never sends anything.

const refineStacks = new Map();   // draft index → the earlier texts of that draft (newest last)
let refineBusy = false;
let refineNote = '';
let refineEngineNow = 'free';   // last engine seen; lets the checklist offer "Fix it" only when the engine can follow free wording

function resetRefine() { refineStacks.clear(); refineBusy = false; refineNote = ''; setRefineStatus(''); }

async function refineEngine() {
  if ((await getModeState()).ai) return 'ai';
  return (await onDeviceActive()) ? 'ondevice' : 'free';
}

function setRefineStatus(text, kind = '') {
  const el = document.getElementById('refine-status');
  if (!el) return;
  el.textContent = text;
  el.className = `refine-status${kind ? ' ' + kind : ''}`;
}

// chips that match what the current engine can really do
async function refreshRefineUi() {
  const box = document.getElementById('refine');
  if (!box) return;
  const wrap = document.getElementById('refine-chips');
  const engine = await refineEngine();
  const changed = engine !== refineEngineNow; refineEngineNow = engine;
  wrap.textContent = '';
  Refine.chipsFor(engine).forEach(c => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'refine-chip'; b.textContent = c.label;
    b.addEventListener('click', () => runRefine(c.comment));
    wrap.appendChild(b);
  });
  const stack = refineStacks.get(activeDraft) || [];
  document.getElementById('refine-undo-row').classList.toggle('hidden', !stack.length);
  const who = engine === 'ai' ? 'Your AI rewrites it.' : engine === 'ondevice' ? 'Chrome’s on-device AI rewrites it; nothing leaves this computer.' : 'Free mode understands the quick options and simple requests, on this device.';
  document.getElementById('refine-engine').textContent = who;
  if (changed && typeof drafts !== 'undefined' && drafts.length) updateDraftMeta();
}

async function runRefine(comment) {
  if (refineBusy || !drafts[activeDraft]) return;
  const input = document.getElementById('refine-input');
  const text = (comment !== undefined ? comment : input.value);
  const engine = await refineEngine();
  const current = currentDraftText();
  refineBusy = true;
  setRefineBusy(true);
  setRefineStatus(engine === 'free' ? 'Rewriting…' : 'Rewriting with ' + (engine === 'ai' ? 'AI' : 'on-device AI') + '…');
  let res;
  try {
    res = await Refine.run({ send: sendMsg, OnDevice: typeof OnDevice !== 'undefined' ? OnDevice : null }, {
      comment: text, draft: current, data: await requestData(currentProfile), senderProfile,
      ai: engine === 'ai', onDevice: engine === 'ondevice'
    });
  } catch (err) { res = { ok: false, message: 'That did not work. Your draft is unchanged.' }; }
  refineBusy = false;
  setRefineBusy(false);
  if (!res.ok) { setRefineStatus(res.message, 'warn'); return; }

  const stack = refineStacks.get(activeDraft) || [];
  stack.push({ text: current, source: drafts[activeDraft].source });
  refineStacks.set(activeDraft, stack);
  drafts[activeDraft].text = res.text;
  drafts[activeDraft].source = res.source;
  drafts[activeDraft].edited = true;
  document.getElementById('generated-message').value = res.text;
  refineNote = 'Revised: ' + (res.applied && res.applied.length ? res.applied.join(', ') : 'from your comment');
  input.value = '';
  updateDraftMeta();
  setRefineStatus(refineNote + '. Read it, edit it if you like.', 'ok');
  await refreshRefineUi();
  saveToHistory();
}

function undoRefine() {
  const stack = refineStacks.get(activeDraft) || [];
  const prev = stack.pop();
  if (!prev) return;
  drafts[activeDraft].text = prev.text;
  drafts[activeDraft].source = prev.source;
  document.getElementById('generated-message').value = prev.text;
  updateDraftMeta();
  setRefineStatus('Back to the previous version.', '');
  refreshRefineUi();
  saveToHistory();
}

function setRefineBusy(on) {
  document.getElementById('refine-go').disabled = on;
  document.getElementById('refine-input').disabled = on;
  document.querySelectorAll('.refine-chip').forEach(b => { b.disabled = on; });
  document.getElementById('refine-go').textContent = on ? 'Rewriting…' : 'Rewrite';
}

function wireRefine() {
  const input = document.getElementById('refine-input');
  if (!input) return;
  document.getElementById('refine-go').addEventListener('click', () => runRefine());
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); runRefine(); } });
  document.getElementById('refine-undo').addEventListener('click', undoRefine);
}
