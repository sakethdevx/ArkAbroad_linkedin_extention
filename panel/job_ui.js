'use strict';

// "Check a job description": paste a job description from any site and see the same Job fit card the LinkedIn job pages get.
// The text goes only to this extension's background worker, which compares it with your resume and profile on this device.
// Nothing is sent anywhere and no AI is used. Nothing here touches LinkedIn.

function wireJobCheck() {
  const btn = document.getElementById('job-check-btn');
  if (!btn || typeof JobCard === 'undefined') return;
  const area = document.getElementById('job-paste'), out = document.getElementById('job-check-result');
  let ui = null;
  btn.addEventListener('click', () => {
    const text = (area.value || '').trim();
    out.textContent = '';
    ui = null;
    if (text.length < 40) { out.textContent = 'Paste the job description first (a few lines at least).'; out.className = 'field-hint'; return; }
    out.className = '';
    ui = JobCard.create(window, { onPanel: () => {}, details: true });   // the panel has the room: show everything
    out.appendChild(ui.host);
    ui.render({ phase: 'loading' });
    const mine = ui;
    btn.disabled = true;
    sendMsg({ action: 'analyzeJob', pasted: text }).then((r) => {
      btn.disabled = false;
      if (ui !== mine) return;
      if (r && r.success) ui.render({ phase: 'result', data: r });
      else ui.render({ phase: 'error', message: (r && r.error) || 'I could not check this job. Nothing was changed.' });
    });
  });
}
