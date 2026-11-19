'use strict';
const assert = require('assert');

module.exports = (test, load) => {
  const F = load('utils/followup.js');
  const S = load('utils/safety.js');
  const D = 24 * 60 * 60 * 1000, T0 = 1_700_000_000_000;
  const sent = (over = {}) => ({ name: 'Priya Rao', sent: true, sentAt: T0, ...over });

  test('followup: due on day 4 for the first follow-up and not before (day 3 is too soon)', () => {
    assert.strictEqual(F.due(sent(), T0 + 3 * D + 23 * 3600e3), null);
    assert.deepStrictEqual(F.due(sent(), T0 + 4 * D), { stage: 1, days: 4 });
    assert.deepStrictEqual(F.due(sent(), T0 + 30 * D), { stage: 1, days: 30 });
  });

  test('followup: the second (last) one is due on day 10 only after the first was handled; never a third', () => {
    assert.strictEqual(F.due(sent({ followUps: 1 }), T0 + 9 * D), null);
    assert.deepStrictEqual(F.due(sent({ followUps: 1 }), T0 + 10 * D), { stage: 2, days: 10 });
    assert.strictEqual(F.due(sent({ followUps: 2 }), T0 + 99 * D), null);
  });

  test('followup: nothing is due when not sent, when they replied, or while snoozed; snooze ends on time; old entries fall back to the saved date', () => {
    assert.strictEqual(F.due({ ...sent(), sent: false }, T0 + 20 * D), null);
    assert.strictEqual(F.due(sent({ replied: true }), T0 + 20 * D), null);
    assert.strictEqual(F.due(sent({ snoozeUntil: T0 + 8 * D }), T0 + 7 * D), null);
    assert.ok(F.due(sent({ snoozeUntil: T0 + 8 * D }), T0 + 8 * D));
    assert.ok(F.due({ name: 'Old', sent: true, timestamp: T0 }, T0 + 5 * D));        // marked sent before sentAt existed
    assert.strictEqual(F.due({ sent: true }, T0), null);                              // no date at all: never guess
    assert.strictEqual(F.due(null), null);
  });

  test('followup: drafts are short, polite, signed with the full name, invent nothing, and pass the output checks', () => {
    for (const stage of [1, 2]) {
      const t = F.draft({ name: 'Priya Rao' }, stage, 'Saketh Jangala');
      assert.match(t, /^Hi Priya,\n/);
      assert.match(t, /\n\nBest regards,\nSaketh Jangala$/);
      assert.ok(t.length < 500, t.length);
      assert.ok(S.validateOutput(t, { maxChars: 500 }).ok, JSON.stringify(S.validateOutput(t, { maxChars: 500 })));
    }
    assert.match(F.draft({ name: 'Priya Rao' }, 2, 'A B'), /One last note/);
    assert.strictEqual(F.draft({}, 1, ''), 'Hi,\nI wanted to follow up on my earlier message in case it got buried. Even a one-line reply would mean a lot, and no pressure if it is not a fit.');
  });
};
