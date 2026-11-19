'use strict';
const assert = require('assert');

module.exports = (test, load) => {
  let JSDOM; try { ({ JSDOM } = require('jsdom')); } catch (_) { /* jsdom missing: skipped like the popup tests */ }
  if (!JSDOM) return;
  const C = load('utils/composer.js');
  const page = (html) => new JSDOM(`<body><nav><a href="/messaging/" aria-label="Messaging">Messaging</a></nav><main><section><h1>Priya Rao</h1>${html}</section></main></body>`).window.document;
  const track = (doc) => { const clicked = []; doc.querySelectorAll('button, a').forEach(el => el.addEventListener('click', () => clicked.push((el.getAttribute('aria-label') || el.textContent).trim()))); return clicked; };

  test('composer: a connection → clicks "Message" (not the Messaging nav) and nothing else', async () => {
    const d = page('<button aria-label="Send profile in a message">Send profile</button><button aria-label="Message Priya">Message</button><button>More</button>'); const clicked = track(d);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(await C.open('message', d))), { ok: true, opened: 'message' });
    assert.deepStrictEqual(clicked, ['Message Priya']);
  });

  test('composer: a new connection → clicks Connect, then only "Add a note" in the dialog; never Send', async () => {
    const d = page('<button aria-label="Invite Priya Rao to connect">Connect</button>'); const clicked = track(d);
    d.querySelector('button').addEventListener('click', () => setTimeout(() => {
      const dlg = d.createElement('div'); dlg.setAttribute('role', 'dialog');
      dlg.innerHTML = '<button aria-label="Add a note">Add a note</button><button aria-label="Send without a note">Send without a note</button><button aria-label="Send">Send</button>';
      d.body.appendChild(dlg); dlg.querySelectorAll('button').forEach(b => b.addEventListener('click', () => clicked.push(b.getAttribute('aria-label'))));
    }, 30));
    const r = await C.open('note', d);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(r)), { ok: true, opened: 'note' });
    assert.deepStrictEqual(clicked, ['Invite Priya Rao to connect', 'Add a note']);
  });

  test('composer: nothing found → { ok:false } and nothing is clicked; a dialog without "Add a note" is reported, never forced', async () => {
    const d = page('<button>Follow</button><button aria-label="Send">Send</button>'); const clicked = track(d);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(await C.open('message', d))), { ok: false, opened: null, reason: 'not-found' });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(await C.open('note', d))), { ok: false, opened: null, reason: 'not-found' });
    assert.deepStrictEqual(clicked, []);
    const e = page('<button>Connect</button>');
    const r = await C.open('note', e);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(r)), { ok: true, opened: 'connect' });
  });
};
