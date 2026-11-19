'use strict';
const assert = require('assert');

module.exports = (test, load) => {
  const OD = load('utils/ondevice.js');
  const tick = (n = 5) => new Promise(r => setTimeout(r, n));
  const withLM = async (lm, fn) => { const prev = globalThis.LanguageModel; if (lm === undefined) delete globalThis.LanguageModel; else globalThis.LanguageModel = lm; try { return await fn(); } finally { if (prev === undefined) delete globalThis.LanguageModel; else globalThis.LanguageModel = prev; } };
  const session = (reply, log = {}) => ({ prompt: async (u, o) => { log.prompted = { u, o }; if (reply instanceof Error) throw reply; return typeof reply === 'function' ? reply(o) : reply; }, destroy: () => { log.destroyed = (log.destroyed || 0) + 1; } });

  test('ondevice: status maps Chrome\'s availability strings; missing or throwing API is "unsupported"', async () => {
    for (const [given, want] of [['available', 'available'], ['downloadable', 'downloadable'], ['downloading', 'downloading'], ['unavailable', 'unsupported'], ['weird', 'unsupported']]) {
      assert.strictEqual(await withLM({ availability: async () => given }, () => OD.status()), want, given);
    }
    assert.strictEqual(await withLM(undefined, () => OD.status()), 'unsupported');
    assert.strictEqual(await withLM({ availability: async () => { throw new Error('boom'); } }, () => OD.status()), 'unsupported');
    // asks about English text in and out, the language our drafts are written in
    let asked;
    await withLM({ availability: async (o) => { asked = o; return 'available'; } }, () => OD.status());
    assert.deepStrictEqual(JSON.parse(JSON.stringify(asked)), { expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] });
  });

  test('ondevice: enable() reports download progress, frees its session, and turns errors into { ok:false }', async () => {
    const log = {}; const seen = [];
    const ok = await withLM({ availability: async () => 'downloadable', create: async (o) => { const l = {}; o.monitor({ addEventListener: (n, f) => { l[n] = f; } }); l.downloadprogress({ loaded: 0.25 }); l.downloadprogress({ loaded: 1.7 }); return session('', log); } }, () => OD.enable(p => seen.push(p)));
    assert.deepStrictEqual(ok, { ok: true });
    assert.deepStrictEqual(seen, [0.25, 1]);
    assert.strictEqual(log.destroyed, 1);
    const bad = await withLM({ availability: async () => 'downloadable', create: async () => { const e = new Error('x'); e.name = 'NotAllowedError'; throw e; } }, () => OD.enable());
    assert.deepStrictEqual(bad, { ok: false, reason: 'NotAllowedError' });
    assert.deepStrictEqual(await withLM(undefined, () => OD.enable()), { ok: false, reason: 'unsupported' });
  });

  test('ondevice: polish() passes the system prompt and schema, parses variants, always destroys the session', async () => {
    const log = {};
    const out = await withLM({ availability: async () => 'available', create: async (o) => { log.create = o; return session(JSON.stringify({ variants: ['a', 'b', 5, 'c'] }), log); } },
      () => OD.polish({ system: 'SYS', user: 'USER', schema: { type: 'object' } }));
    assert.deepStrictEqual(out, ['a', 'b', 'c']);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(log.create.initialPrompts)), [{ role: 'system', content: 'SYS' }]);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(log.prompted.o.responseConstraint)), { type: 'object' });
    assert.strictEqual(log.prompted.u, 'USER');
    assert.strictEqual(log.destroyed, 1);
    // JSON inside prose is still recovered
    assert.deepStrictEqual(await withLM({ availability: async () => 'available', create: async () => session('Here you go: {"variants":["x"]} done') }, () => OD.polish({ user: 'u' })), ['x']);
  });

  test('ondevice: polish() returns null (never throws) on bad JSON, empty list, API errors, missing API', async () => {
    const mk = (reply) => ({ availability: async () => 'available', create: async () => session(reply) });
    assert.strictEqual(await withLM(mk('not json'), () => OD.polish({ user: 'u' })), null);
    assert.strictEqual(await withLM(mk('{"variants":[]}'), () => OD.polish({ user: 'u' })), null);
    assert.strictEqual(await withLM(mk(new Error('quota')), () => OD.polish({ user: 'u' })), null);
    assert.strictEqual(await withLM({ availability: async () => 'available', create: async () => { throw new Error('no model'); } }, () => OD.polish({ user: 'u' })), null);
    assert.strictEqual(await withLM(undefined, () => OD.polish({ user: 'u' })), null);
    assert.strictEqual(await withLM(mk('{}'), () => OD.polish(null)), null);
  });

  test('ondevice: polish() gives up after the timeout and when the caller aborts, and still cleans up', async () => {
    const log = {};
    const hang = { availability: async () => 'available', create: async () => ({ prompt: (u, o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(new Error('aborted')))), destroy: () => { log.destroyed = 1; } }) };
    const t0 = Date.now();
    assert.strictEqual(await withLM(hang, () => OD.polish({ user: 'u' }, { timeoutMs: 1000 })), null);
    assert.ok(Date.now() - t0 < 2500, 'returned soon after the timeout');
    assert.strictEqual(log.destroyed, 1);
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 20);
    log.destroyed = 0;
    assert.strictEqual(await withLM(hang, () => OD.polish({ user: 'u' }, { timeoutMs: 20000, signal: ctl.signal })), null);
    assert.strictEqual(log.destroyed, 1);
  });

  test('ondevice: extract() returns a JSON object (even wrapped in prose), passes the schema, and is null on anything else', async () => {
    const log = {};
    const mk = (reply) => ({ availability: async () => 'available', create: async () => session(reply, log) });
    assert.deepStrictEqual(await withLM(mk('{"name":"Asha","skills":["Python"]}'), () => OD.extract({ system: 'S', user: 'U', schema: { type: 'object' } })), { name: 'Asha', skills: ['Python'] });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(log.prompted.o.responseConstraint)), { type: 'object' });
    assert.strictEqual(log.destroyed, 1);
    assert.deepStrictEqual(await withLM(mk('Sure!\n```json\n{"name":"B"}\n```'), () => OD.extract({ user: 'u' })), { name: 'B' });
    assert.strictEqual(await withLM(mk('[1,2,3]'), () => OD.extract({ user: 'u' })), null, 'arrays are not objects');
    assert.strictEqual(await withLM(mk('nope'), () => OD.extract({ user: 'u' })), null);
    assert.strictEqual(await withLM(mk(new Error('quota')), () => OD.extract({ user: 'u' })), null);
    assert.strictEqual(await withLM(undefined, () => OD.extract({ user: 'u' })), null);
  });
};
