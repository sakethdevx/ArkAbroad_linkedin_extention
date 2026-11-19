'use strict';
const assert = require('assert');

module.exports = (test, load) => {
  const D = load('utils/draftcheck.js');
  const base = { format: 'note', maxChars: 200, firstName: 'Priya', senderName: 'Asha Menon', allowedText: '', facts: '' };
  const fin = (raw, o) => JSON.parse(JSON.stringify(D.finishDrafts(raw, { ...base, ...o })));

  test('draftcheck: greeting is added, "you both" becomes "we both", and a note loses a stray name sign-off', () => {
    const r = fin(['I noticed you both work with Python. Open to a chat?\nMENON', 'Hi Priya, fellow IIT Madras person. Open to a chat?']);
    assert.strictEqual(r.bad.length, 0);
    assert.strictEqual(r.good[0], 'Hi Priya,\nI noticed we both work with Python. Open to a chat?');
    assert.strictEqual(r.good[1], 'Hi Priya, fellow IIT Madras person. Open to a chat?');
  });

  test('draftcheck: a message sign-off is completed to the full name; a note is shortened by dropping middle sentences', () => {
    const msg = fin(['Hi Priya,\nWe both studied at IIT Madras. Open to a chat?\n\nBest,\nMENON'], { format: 'message', maxChars: 500 });
    assert.ok(/\nAsha Menon$/.test(msg.good[0]), msg.good[0]);
    const long = 'Hi Priya, we both studied at IIT Madras. ' + 'I like building data tools and shipping side projects on weekends with friends. '.repeat(2) + 'Would you be open to a quick chat?';
    const r = fin([long]);
    assert.ok(r.good[0].length <= 200 && /^Hi Priya, we both studied at IIT Madras\./.test(r.good[0]) && /quick chat\?$/.test(r.good[0]), JSON.stringify(r));
  });

  test('draftcheck: unsafe drafts (links, emails, over-length that cannot be trimmed) land in `bad` with reasons', () => {
    const r = fin(['Hi Priya, see https://evil.example now', 'x'.repeat(260)]);
    assert.strictEqual(r.good.length, 0);
    assert.strictEqual(r.bad.length, 2);
    assert.ok(r.bad[0].problems.some(p => /link/.test(p)));
    assert.ok(r.bad[1].problems.some(p => /too long/.test(p)));
  });

  test('draftcheck: groundedness rejects names and numbers that are not in the facts (small-model hallucinations)', () => {
    const facts = 'Priya Rao Data Scientist Globex Chennai IIT Madras Python I noticed we both studied at IIT Madras. Safety Monitor object detection';
    const okDraft = 'Hi Priya, I noticed we both studied at IIT Madras. I built Safety Monitor. Would you be open to a quick chat?';
    const r = fin([okDraft, 'Hi Priya, I interned at Google for 3 years. Would you be open to a chat?', 'Hi Priya, I loved your talk at PyCon. Open to a chat?'], { requireGrounded: true, facts });
    assert.deepStrictEqual(r.good, [okDraft]);
    assert.strictEqual(r.bad.length, 2);
    assert.ok(r.bad[0].problems[0].includes('"Google"') || r.bad[0].problems[0].includes('"3"'), r.bad[0].problems[0]);
    assert.ok(r.bad[1].problems[0].includes('"PyCon"'));
    // not enforced unless asked (cloud path keeps today's behaviour)
    assert.strictEqual(fin(['Hi Priya, I interned at Google. Open to a chat?'], { requireGrounded: false }).good.length, 1);
  });

  test('draftcheck: groundedness lets ordinary sentence-opening words and accented names through', () => {
    const facts = 'María García Madrid Universidad Politécnica de Madrid';
    const r = fin(['Hi María,\nFellow Madrid person here. Would you be open to a quick chat on LinkedIn?'], { firstName: 'María', requireGrounded: true, facts });
    assert.strictEqual(r.good.length, 1, JSON.stringify(r));
    assert.deepStrictEqual(D.groundedness('', facts), []);
  });

  test('draftcheck: never throws on odd input', () => {
    assert.deepStrictEqual(JSON.parse(JSON.stringify(D.finishDrafts(null))), { good: [], bad: [] });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(D.finishDrafts([5, null, {}]))), { good: [], bad: [] });
    D.groundedness(undefined, undefined);
  });
};
