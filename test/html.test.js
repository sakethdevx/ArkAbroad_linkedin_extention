'use strict';
// Static accessibility / integrity checks on popup.html. Needs jsdom (skips without it).
const assert = require('assert');
const fs = require('fs');
const path = require('path');

module.exports = (test) => {
  let JSDOM;
  try { ({ JSDOM } = require('jsdom')); } catch (_) { return; }
  const html = fs.readFileSync(path.join(__dirname, '../popup.html'), 'utf8');
  const doc = new JSDOM(html).window.document;
  const $$ = (sel) => Array.from(doc.querySelectorAll(sel));

  test('html: unique ids and every aria-labelledby / aria-describedby / label[for] resolves', () => {
    const ids = $$('[id]').map(e => e.id);
    assert.strictEqual(new Set(ids).size, ids.length, 'duplicate ids: ' + ids.filter((x, i) => ids.indexOf(x) !== i).join(','));
    const missing = [];
    $$('[aria-controls],[aria-labelledby],[aria-describedby]').forEach(e => ['aria-controls', 'aria-labelledby', 'aria-describedby'].forEach(a => {
      (e.getAttribute(a) || '').split(/\s+/).filter(Boolean).forEach(id => { if (!doc.getElementById(id)) missing.push(`${a}→${id}`); });
    }));
    $$('label[for]').forEach(l => { if (!doc.getElementById(l.getAttribute('for'))) missing.push('label for ' + l.getAttribute('for')); });
    assert.deepStrictEqual(missing, []);
  });

  test('html: every form control has an accessible name', () => {
    const bad = [];
    $$('input:not([type=file]):not([type=hidden]), textarea, select').forEach(e => {
      const named = e.getAttribute('aria-label') || e.getAttribute('aria-labelledby') || (e.id && doc.querySelector(`label[for="${e.id}"]`));
      if (!named) bad.push(e.id || e.outerHTML.slice(0, 60));
    });
    assert.deepStrictEqual(bad, []);
  });

  test('html: every button has text or an aria-label', () => {
    const bad = $$('button').filter(b => !(b.textContent.trim() || b.getAttribute('aria-label'))).map(b => b.id || b.outerHTML.slice(0, 60));
    assert.deepStrictEqual(bad, []);
  });

  test('html: tabs follow the ARIA tab pattern, live region + dialog present, lang set', () => {
    const tabs = $$('[role=tab].tab-btn');
    assert.strictEqual(tabs.length, 3);
    tabs.forEach(t => assert.strictEqual(doc.getElementById(t.getAttribute('aria-controls')).getAttribute('role'), 'tabpanel'));
    assert.ok(doc.querySelector('#status-message[aria-live]'));
    assert.strictEqual(doc.documentElement.lang, 'en');
    assert.ok(doc.querySelector('dialog#consent-dialog[aria-labelledby]'));
  });
};
