'use strict';

// Resume: file or paste to an editable profile (and the AI / on-device read)
// Part of the side panel: plain scripts share one page scope (no build step); see popup.html for the load order.

// ─── Resume: PDF → text → editable profile (all on-device) ─────────────────────
const toList = (v) => String(v || '').split(/[,;\n]/).map(x => x.trim()).filter(Boolean);

function setResumeStatus(msg, kind) {
  const el = document.getElementById('resume-status');
  el.textContent = msg;
  el.className = `resume-status ${kind || ''}`;
}

function setResumeFileUi(fileName) {
  setTimeout(renderAboutSummary, 0);
  document.getElementById('file-label').textContent = fileName || 'Click to upload or drag PDF here';
  document.getElementById('file-upload-area').classList.toggle('has-file', !!fileName);
}

// Rows are edited as "a | b | c" lines and stored as objects.
const ROW_FIELDS = { education: ['school', 'degree', 'field', 'years'], experience: ['title', 'company', 'years', 'detail'], projects: ['name', 'summary'] };
const rowsToText = (rows, keys) => (rows || []).map(r => keys.map(k => (r && r[k]) || '').join(' | ').replace(/(?: \| )+$/, '')).join('\n');
const textToRows = (text, keys) => String(text || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => {
  const parts = l.split('|').map(x => x.trim());
  const o = {}; keys.forEach((k, i) => { o[k] = parts[i] || ''; });
  return o;
});

function fillMeCard(sp) {
  document.getElementById('me-card').classList.remove('hidden');
  document.getElementById('me-intro').value     = sp.intro || '';
  document.getElementById('me-goal').value      = sp.goal || '';
  document.getElementById('me-schools').value   = (sp.schools || []).join(', ');
  document.getElementById('me-employers').value = (sp.employers || []).join(', ');
  document.getElementById('me-skills').value    = (sp.skills || []).join(', ');
  document.getElementById('me-city').value      = sp.city || '';
  document.getElementById('me-education').value  = rowsToText(sp.education, ROW_FIELDS.education);
  document.getElementById('me-experience').value = rowsToText(sp.experience, ROW_FIELDS.experience);
  document.getElementById('me-projects').value   = rowsToText(sp.projects, ROW_FIELDS.projects);
  document.getElementById('me-certs').value      = (sp.certifications || []).join(', ');
  document.getElementById('me-languages').value  = (sp.languages || []).join(', ');
  renderMeSummary(sp);
  renderAboutSummary();
  refreshAiResumeBtn();
}

// Keeps fields the card does not show (summary, source, …) so a small edit never drops the rest of the profile.
function readMeCard() {
  const v = (id) => document.getElementById(id).value;
  return {
    ...(senderProfile || {}),
    intro:     v('me-intro').trim(),
    goal:      v('me-goal').trim(),
    schools:   toList(v('me-schools')),
    employers: toList(v('me-employers')),
    skills:    toList(v('me-skills')),
    city:      v('me-city').trim(),
    education:  textToRows(v('me-education'), ROW_FIELDS.education),
    experience: textToRows(v('me-experience'), ROW_FIELDS.experience),
    projects:   textToRows(v('me-projects'), ROW_FIELDS.projects),
    certifications: toList(v('me-certs')),
    languages:  toList(v('me-languages')),
    updatedAt: Date.now()
  };
}

function renderAboutSummary() {
  const name = document.getElementById('user-name').value.trim();
  const hasResume = document.getElementById('file-upload-area').classList.contains('has-file');
  const bits = [name, hasResume ? 'resume added' : ''].filter(Boolean);
  document.getElementById('about-summary').textContent = bits.length ? bits.join(' · ') : 'add your name and resume';
}

function renderMeSummary(sp) {
  const n = (a) => (Array.isArray(a) ? a.filter(Boolean).length : 0);
  const bits = [
    n(sp.schools) && `${n(sp.schools)} school${n(sp.schools) > 1 ? 's' : ''}`,
    n(sp.employers) && `${n(sp.employers)} employer${n(sp.employers) > 1 ? 's' : ''}`,
    n(sp.skills) && `${n(sp.skills)} skills`,
    sp.city
  ].filter(Boolean);
  document.getElementById('me-summary').textContent = bits.length ? bits.join(' · ') : 'tap to add details';
}

async function refreshAiResumeBtn() {
  const s = await storageGet(['resumeText']);
  const m = await getModeState();
  const local = !m.ai && (await onDeviceActive());
  const btn = document.getElementById('resume-ai-btn');
  btn.classList.toggle('hidden', !((m.ai || local) && s.resumeText));
  btn.textContent = local ? 'Re-read my resume with on-device AI' : 'Re-read my resume with AI';
}

async function saveSenderFromCard() {
  senderProfile = readMeCard();
  renderMeSummary(senderProfile);
  await storageSet({ senderProfile });
  renderOverlaps(true);
}

let autoName = '';   // a name we filled in ourselves (so a better one may replace it, but never one the user typed)
async function ingestResumeText(text, fileName, opts = {}) {
  const parsed = Resume.parseResume(text);
  const prev = (await loadStoredSettings()).senderProfile || {};
  senderProfile = { intro: prev.intro || '', schools: parsed.schools.map(Safety.normalizeLabel), employers: parsed.employers.map(Safety.normalizeLabel), skills: parsed.skills, city: parsed.city || prev.city || '', source: 'device', updatedAt: Date.now() };
  await storageSet({ resumeText: parsed.redactedText, resumeFileName: fileName, senderProfile });
  await storageRemove('resumeBase64');

  fillMeCard(senderProfile);
  setResumeFileUi(fileName);
  const nameEl = document.getElementById('user-name');
  const nice = Safety.normalizeName(parsed.name);
  if (nice && !nameEl.value.trim()) { nameEl.value = nice; autoName = nice; }

  if (!opts.quiet) {
    const found = [
      senderProfile.schools.length   && `${senderProfile.schools.length} school${senderProfile.schools.length > 1 ? 's' : ''}`,
      senderProfile.employers.length && `${senderProfile.employers.length} employer${senderProfile.employers.length > 1 ? 's' : ''}`,
      senderProfile.skills.length    && `${senderProfile.skills.length} skills`
    ].filter(Boolean);
    if (found.length) setResumeStatus(`Read on this device ✓ Found ${found.join(', ')}. Check them below.`, 'success');
    else setResumeStatus("I read your resume but couldn't pick out schools, employers or skills. Add them below and I'll use those.", 'pending');
  }
  if (!opts.quiet) document.getElementById('me-card').open = true;
  renderOverlaps(true);
  refreshResumeTip();
  if (!opts.quiet) {
    const cloud = await tryAiResume(parsed.redactedText, { afterDevice: true });
    if (!cloud && !(await getModeState()).ai) await tryOnDeviceResume(parsed.redactedText);
  }
}

// AI Mode: let the provider the user chose read the resume and fill in the whole profile.
// Runs by itself in AI Mode (you said yes when you turned AI on). Any failure leaves the on-device result in place.
async function tryAiResume(text, opts = {}) {
  const m = await getModeState();
  if (!m.ai) return false;                                  // Free Mode: the resume never leaves this device
  if (!(await ensureAiEnabled())) {                         // one-time yes (older installs said yes only to drafts)
    if (opts.afterDevice) setResumeStatus('Read on this device ✓ Check what I found below.', 'success');
    return false;
  }
  const prev = { providerName: m.provider.name };
  setResumeStatus(`Reading your resume with ${prev.providerName}…`, 'pending');
  const res = await new Promise(r => chrome.runtime.sendMessage({ type: 'PARSE_RESUME', payload: { text } }, r));
  if (!res || !res.ok) {
    setResumeStatus(`${(res && res.userMessage) || 'AI could not read the resume.'} Using what was read on this device.`, 'error');
    return false;
  }
  return applyResumeProfile(res.profile, `${prev.providerName}`, { source: 'ai', provider: res.provider, sawInjection: res.sawInjection });
}

// Shared by the cloud read and the on-device read: store the full profile, fill name/bio only where empty, show what was found.
async function applyResumeProfile(ai, label, { source, provider, sawInjection } = {}) {
  senderProfile = { ...ai, source, provider, updatedAt: Date.now() };
  const toStore = { senderProfile };

  // fill the other fields this profile belongs in, without overwriting what the user already typed
  const nameEl = document.getElementById('user-name'), bioEl = document.getElementById('user-bio');
  if (ai.name && (!nameEl.value.trim() || nameEl.value === autoName)) { nameEl.value = ai.name; toStore.userName = ai.name; }
  const bio = ai.summary || ai.intro;
  if (bio && !bioEl.value.trim()) { bioEl.value = bio; toStore.userBio = bio; }
  await storageSet(toStore);

  fillMeCard(senderProfile);
  const bits = [
    ai.education.length  && `${ai.education.length} education`,
    ai.experience.length && `${ai.experience.length} experience`,
    ai.projects.length   && `${ai.projects.length} project${ai.projects.length > 1 ? 's' : ''}`,
    ai.skills.length     && `${ai.skills.length} skills`
  ].filter(Boolean);
  setResumeStatus(`${label} read your resume ✓ Filled in ${bits.join(', ') || 'your profile'}. Check it below.${sawInjection ? ' Note: the resume contained text aimed at an AI; it was ignored.' : ''}`, 'success');
  document.getElementById('me-card').open = true;
  renderOverlaps(true);
  refreshResumeTip();
  return true;
}

// Free Mode + on-device AI: Chrome's built-in model reads the resume. Nothing leaves the computer. Its answer is held to the same
// rules as the cloud's (whitelist, caps, instruction screen, every school/employer/skill/project must appear in the resume text),
// and a read that finds nothing leaves the on-device heuristic result in place.
async function tryOnDeviceResume(text, opts = {}) {
  if (!(await onDeviceActive())) return false;
  setResumeStatus('Reading your resume with Chrome’s built-in AI… this can take a moment.', 'pending');
  const built = await sendMsg({ type: 'BUILD_RESUME_PROMPT', payload: { text } });
  if (!built || !built.success) { setResumeStatus(`${(built && built.error) || 'Could not prepare the resume.'} Using what was read on this device.`, 'error'); return false; }
  const obj = await OnDevice.extract({ system: built.system, user: built.user, schema: built.schema }, { timeoutMs: 90000 });
  const profile = obj ? Safety.sanitizeSenderProfile(obj, built.resume) : null;
  const found = profile ? profile.education.length + profile.experience.length + profile.skills.length + profile.projects.length : 0;
  if (!profile || (!found && !profile.intro)) {
    setResumeStatus('Chrome’s built-in AI couldn’t read this resume well, so I’m using what was read on this device. Edit anything below.', 'pending');
    return false;
  }
  return applyResumeProfile(profile, 'Chrome’s built-in AI', { source: 'ondevice', provider: 'ondevice', sawInjection: !!obj.saw_ai_instructions_in_data });
}

async function processResumeFile(file) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (!isPdf)                  { setResumeStatus('Please upload a PDF file.', 'error'); return; }
  if (file.size > 4 * 1024 * 1024) { setResumeStatus('File too large. The limit is 4 MB.', 'error'); return; }

  setResumeStatus('Reading your resume on this device…', 'pending');
  try {
    const { text, pages, truncated } = await Resume.extractPdfText(await file.arrayBuffer());
    if (text.trim().length < 40) {
      setResumeStatus('No text found. This looks like a scanned PDF. Paste your resume text below instead.', 'error');
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
  await storageRemove(['resumeText', 'resumeFileName', 'senderProfile', 'resumeBase64']);
  senderProfile = null;
  document.getElementById('me-card').classList.add('hidden');
  document.getElementById('resume-paste').value = '';
  setResumeFileUi('');
  setResumeStatus('Resume and extracted info removed from this device.', 'success');
  renderOverlaps(true);
  refreshResumeTip();
}

