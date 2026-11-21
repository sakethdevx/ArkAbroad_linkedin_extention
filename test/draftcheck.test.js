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

  test('a connection note never ends with a sign-off word, even with no name after it (the "Kind regards," bug)', () => {
    ['Kind regards,', 'Cheers,', 'Best regards,', 'Warmly,', 'Best,'].forEach(sign => {
      const r = fin(['Hi Priya,\nWe both studied at IIT Madras. Would you be open to a quick chat? ' + sign]);
      assert.strictEqual(r.good.length, 1, sign);
      assert.ok(!/regards|cheers|warmly|best,?$/i.test(r.good[0].replace(/best/i, 'x').slice(-12)) && r.good[0].endsWith('chat?'), sign + ' → ' + r.good[0]);
    });
    assert.strictEqual(fin(['Hi Priya,\nSaw we both studied at IIT Madras. Open to a quick chat?\nCheers,']).good[0].endsWith('chat?'), true);
    const msg = fin(['Hi Priya,\nWould you be open to a chat?\nBest regards,\nAsha Menon'], { format: 'message', maxChars: 500 }).good[0];
    assert.ok(msg.endsWith('Asha Menon'), 'a message keeps its sign-off');
    assert.ok(/Best|best/.test(fin(['Hi Priya,\nI use the best tools. Would you chat?']).good[0]), 'the word best inside a sentence is untouched');
  });

  test('requireAsk can be several requirements; a draft with no question is rejected with a plain reason', () => {
    const ask = [{ re: /\?/, problem: 'does not end with a question' }];
    const r = fin(['Hi Priya,\nI saw your work at Globex. I am a student exploring cloud hosting.', 'Hi Priya,\nI saw your work at Globex. Would you be open to a quick chat?'], { requireAsk: ask, facts: 'Globex' });
    assert.strictEqual(r.good.length, 1); assert.deepStrictEqual(r.bad[0].problems, ['does not end with a question']);
    const both = fin(['Hi Priya,\nWould you chat with me?'], { requireAsk: ask.concat([{ re: /\brefer/i, problem: 'does not ask for a referral' }]) });
    assert.deepStrictEqual(both.bad[0].problems, ['does not ask for a referral']);
  });

  test('a message that ends with a bare sign-off gets the sender\'s full name after it', () => {
    const r = fin(['Hi Priya,\nCould we chat?\nKind regards,'], { format: 'message', maxChars: 500 }).good[0];
    assert.ok(r.endsWith('Kind regards,\nAsha Menon'), r);
  });
};
