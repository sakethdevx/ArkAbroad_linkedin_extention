'use strict';
const assert = require('assert');

module.exports = (test, load) => {
  const R = load('utils/rules.js');
  const C = load('utils/compose.js');
  const cloud = R.systemPrompt('cloud'), small = R.systemPrompt('ondevice');

  test('rules: both prompts carry every sign-off exactly as the templates use them', () => {
    for (const s of Object.values(C.SIGNOFF)) {
      assert.ok(cloud.includes(`"${s}"`), 'cloud prompt is missing ' + s);
      assert.ok(small.includes(`"${s}"`), 'on-device prompt is missing ' + s);
    }
  });

  test('rules: both prompts tell the model to follow task.ask, and ask() gives a referral ask', () => {
    assert.ok(/task\.ask/.test(cloud) && /task\.ask/.test(small));
    assert.ok(/referring/.test(R.ask('Referral', '')));
    assert.ok(/Internships/.test(R.ask('Job', 'Internships')));
    assert.ok(/chat|question/i.test(R.ask('Networking', '')));
  });

  test('rules: every rule is in the cloud prompt, and in the on-device prompt unless it was deliberately left out', () => {
    for (const r of R.RULES) {
      assert.ok(r.full || r.short, r.id + ' has no text');
      if (r.full) assert.ok(cloud.includes(r.full), r.id + ' missing from cloud');
      if (r.short) assert.ok(small.includes(r.short), r.id + ' missing from on-device');
    }
    // the rules that protect the recipient must never be cloud-only: facts, voice, plain text and untrusted data
    for (const id of ['plain', 'facts', 'voice', 'format', 'data']) assert.ok(R.RULES.find(r => r.id === id).short, id + ' must be in the on-device prompt');
  });

  test('rules: the cloud prompt keeps the untrusted-data policy', () => {
    assert.match(cloud, /untrusted_content_policy/);
    assert.match(cloud, /saw_ai_instructions_in_data/);
  });
};
