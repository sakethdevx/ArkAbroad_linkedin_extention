'use strict';
const assert = require('assert');

module.exports = (test, load) => {
  const A = load('utils/approach.js').approach;
  const shared = [{ label: 'IIT Madras' }, { label: 'Python' }, { label: 'Chennai' }];

  test('approach: already connected → just message; the rest never overrides it', () => {
    assert.match(A({ isConnection: true, overlaps: shared, recentPosts: ['x'], purpose: 'Referral' }), /already connected.*No note needed/);
  });

  test('approach: a referral with no shared ground asks for advice first; with a shared school it does not', () => {
    assert.match(A({ purpose: 'Referral' }), /ask for advice first/);
    assert.doesNotMatch(A({ purpose: 'Referral', overlaps: shared }) || '', /advice first/);
  });

  test('approach: a recent post → warm up first (labelled directional); else shared ground → lead with it; else nothing', () => {
    assert.match(A({ recentPosts: ['Shipped a model'], overlaps: shared }), /like or comment.*directional/);
    assert.match(A({ overlaps: shared }), /open with what you share \(IIT Madras, Python\)/);
    assert.strictEqual(A({}), null);
    assert.strictEqual(A({ overlaps: [{ detail: 'no label' }], recentPosts: [null, ''] }), null);
    assert.strictEqual(A(), null);
  });
};
