'use strict';
const assert = require('assert');

module.exports = (test, load) => {
  const P = load('utils/person.js');

  test('person: the handle comes from the profile address, however it is written', () => {
    assert.strictEqual(P.handleOf('https://www.linkedin.com/in/Jane-Doe/'), 'jane-doe');
    assert.strictEqual(P.handleOf('https://www.linkedin.com/in/jane-doe?utm_source=share&trk=x'), 'jane-doe');
    assert.strictEqual(P.handleOf('https://in.linkedin.com/in/jane-doe/details/experience/'), 'jane-doe');
    assert.strictEqual(P.handleOf('https://www.linkedin.com/fr/in/jane-doe/'), 'jane-doe');
    assert.strictEqual(P.handleOf('https://www.linkedin.com/in/j%C3%BCrgen-m%C3%BCller-12a/'), 'jürgen-müller-12a');
  });

  test('person: anything that is not a profile address has no handle (and no link)', () => {
    for (const u of ['', null, undefined, 'https://www.linkedin.com/feed/', 'https://www.linkedin.com/company/acme/', 'https://evil.example/in/jane', 'https://notlinkedin.com/in/jane', 'javascript:alert(1)', 'https://www.linkedin.com/in/', 'https://www.linkedin.com/in/%E0%A4%A']) {
      assert.strictEqual(P.handleOf(u), null, String(u));
      assert.strictEqual(P.profileLink(u), null, String(u));
    }
  });

  test('person: a link is built only from a clean handle or a profile address, always on www.linkedin.com', () => {
    assert.strictEqual(P.profileLink('jane-doe'), 'https://www.linkedin.com/in/jane-doe/');
    assert.strictEqual(P.profileLink('https://in.linkedin.com/in/Jane-Doe/?x=1'), 'https://www.linkedin.com/in/jane-doe/');
    assert.strictEqual(P.profileLink('jürgen'), 'https://www.linkedin.com/in/j%C3%BCrgen/');
    for (const bad of ['a/b', '../x', 'jane doe', 'jane?x=1', 'a#b', '<script>', 'x'.repeat(101)]) assert.strictEqual(P.profileLink(bad), null, bad);
  });
};
