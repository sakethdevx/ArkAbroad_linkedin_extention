'use strict';

// "Fill with my draft" on the LinkedIn page: this file only hands the CURRENT draft to the helper in the LinkedIn tab
// (utils/notefill.js, started by the background worker). The helper adds a button to LinkedIn's note box; pressing it
// types the draft there. Nothing is clicked or sent for you. Setting: Settings → On the LinkedIn page.

let pushTimer = null;
let pushedOnce = false;   // so an empty draft only clears the page when something was handed over before

const noteFillEnabled = async () => (await storageGet('noteFill')).noteFill !== false;   // on unless you turned it off

function pushDraftToPage() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(doPush, 400);   // typing in the draft box should not send a message per keystroke
}

async function doPush() {
  try {
    const enabled = await noteFillEnabled();
    const text = enabled && drafts.length ? currentDraftText() : '';
    if (!text && !pushedOnce) return;
    const tabId = await activeTabId();
    if (tabId === undefined) return;
    pushedOnce = !!text;
    chrome.runtime.sendMessage({ action: 'armNoteFill', tabId, text, format: currentFormat, enabled }, () => { void chrome.runtime.lastError; });
  } catch (err) { debug('push draft to page', err); }
}

async function refreshNoteFillCard() {
  const on = await noteFillEnabled();
  const box = document.getElementById('notefill-on');
  if (box) box.checked = on;
  const chip = document.getElementById('page-chip');
  if (chip) chip.textContent = on ? 'On' : 'Off';
}

function wireNoteFill() {
  const box = document.getElementById('notefill-on');
  if (!box) return;
  box.addEventListener('change', async () => {
    await storageSet({ noteFill: box.checked });
    await refreshNoteFillCard();
    pushedOnce = true;     // turning it off must also switch the helper off in the open tab
    pushDraftToPage();
  });
}
