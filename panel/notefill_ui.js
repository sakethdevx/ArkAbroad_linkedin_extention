'use strict';

// "Fill with my draft" on the LinkedIn page: this file only hands the CURRENT draft to the helper in the LinkedIn tab
// (utils/notefill.js, started by the background worker). The helper adds a button to LinkedIn's note box; pressing it
// types the draft there. Nothing is clicked or sent for you. Setting: Settings → On the LinkedIn page.

let pushTimer = null;
let pushedOnce = false;   // so an empty draft only clears the page when something was handed over before

// how Outreach AI helps on the LinkedIn page: 'smart' (default) | 'button' | 'off'. Older installs only had an on/off switch.
const PAGE_MODES = { smart: 'Smart composer', button: 'Fill button only', off: 'Off' };
async function pageMode() {
  const r = await storageGet(['pageMode', 'noteFill']);
  return PAGE_MODES[r.pageMode] ? r.pageMode : (r.noteFill === false ? 'off' : 'smart');
}
const noteFillEnabled = async () => (await pageMode()) !== 'off';

function pushDraftToPage() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(doPush, 400);   // typing in the draft box should not send a message per keystroke
}

async function doPush() {
  try {
    const enabled = await noteFillEnabled();
    const text = enabled && drafts.length ? currentDraftText() : '';
    if (!enabled && !pushedOnce) return;      // switched off and never on: nothing to tell the page
    const tabId = await activeTabId();
    if (tabId === undefined) return;
    pushedOnce = true;
    chrome.runtime.sendMessage({ action: 'armNoteFill', tabId, text, format: currentFormat, enabled }, () => { void chrome.runtime.lastError; });
  } catch (err) { debug('push draft to page', err); }
}

async function refreshNoteFillCard() {
  const mode = await pageMode();
  document.querySelectorAll('input[name="pagemode"]').forEach(r => { r.checked = r.value === mode; });
  const chip = document.getElementById('page-chip');
  if (chip) chip.textContent = PAGE_MODES[mode];
}

function wireNoteFill() {
  document.querySelectorAll('input[name="pagemode"]').forEach(r => r.addEventListener('change', async () => {
    if (!r.checked) return;
    await storageSet({ pageMode: r.value });   // the helper in the LinkedIn tab watches this and switches by itself
    await refreshNoteFillCard();
    pushedOnce = true;
    pushDraftToPage();
  }));
}
