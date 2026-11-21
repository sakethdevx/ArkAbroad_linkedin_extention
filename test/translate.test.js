'use strict';
const assert = require('assert');

module.exports = (test, load) => {
  const TR = load('utils/translate.js');
  const set = async (stubs, fn) => {
    const prev = { T: globalThis.Translator, D: globalThis.LanguageDetector };
    for (const k of ['Translator', 'LanguageDetector']) { if (stubs[k] === undefined) delete globalThis[k]; else globalThis[k] = stubs[k]; }
    try { return await fn(); } finally { for (const [k, v] of [['Translator', prev.T], ['LanguageDetector', prev.D]]) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; } }
  };
  const detector = (res, avail = 'available', log = {}) => ({ availability: async () => avail, create: async () => ({ detect: async (t) => { log.text = t; return res; }, destroy: () => { log.destroyed = 1; } }) });
  const translator = (fn, log = {}, avail = 'available') => ({ availability: async (o) => { log.avail = o; return typeof avail === 'function' ? avail(o) : avail; },
    create: async (o) => { log.created = o; if (o.monitor) { const l = {}; o.monitor({ addEventListener: (n, f) => { l[n] = f; } }); l.downloadprogress && l.downloadprogress({ loaded: 0.4 }); } return { translate: async (t) => fn(t, o), destroy: () => { log.destroyed = (log.destroyed || 0) + 1; } }; } });
  const GERMAN = 'Ich leite ein Team für Datenplattformen und schreibe gern über Softwarearchitektur und Cloud.';

  test('translate: supported() follows the Translator API; detect() accepts only confident, supported, non-English text', async () => {
    assert.strictEqual(await set({}, async () => TR.supported()), false);
    assert.strictEqual(await set({ Translator: translator(t => t) }, async () => TR.supported()), true);
    const run = (res, avail, text = GERMAN) => set({ Translator: translator(t => t), LanguageDetector: detector(res, avail) }, () => TR.detect(text));
    assert.deepStrictEqual(await run([{ detectedLanguage: 'de', confidence: 0.97 }]), { lang: 'de', confidence: 0.97 });
    assert.deepStrictEqual(await run([{ detectedLanguage: 'pt-BR', confidence: 0.9 }]), { lang: 'pt', confidence: 0.9 }, 'regional tags are reduced to the language');
    assert.strictEqual(await run([{ detectedLanguage: 'en', confidence: 0.99 }]), null, 'English needs no translation');
    assert.strictEqual(await run([{ detectedLanguage: 'de', confidence: 0.5 }]), null, 'unsure → silent');
    assert.strictEqual(await run([{ detectedLanguage: 'xx', confidence: 0.99 }]), null, 'unsupported language → silent');
    assert.strictEqual(await run([{ detectedLanguage: 'de', confidence: 0.99 }], 'downloadable'), null, 'never triggers a model download by itself');
    assert.strictEqual(await run([{ detectedLanguage: 'de', confidence: 0.99 }], 'available', 'Hallo'), null, 'too little text');
    assert.strictEqual(await run(null), null);
    assert.strictEqual(await set({ Translator: translator(t => t) }, () => TR.detect(GERMAN)), null, 'no detector → null');
  });

  test('translate: translate() and back() use the right language pairs, report progress, and always clean up', async () => {
    const log = {}; const seen = [];
    const out = await set({ Translator: translator((t, o) => `[${o.sourceLanguage}>${o.targetLanguage}] ${t}`, log) }, () => TR.translate('Hi Anna', 'de-AT', p => seen.push(p)));
    assert.deepStrictEqual(out, { ok: true, text: '[en>de] Hi Anna' });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(log.avail)), { sourceLanguage: 'en', targetLanguage: 'de' });
    assert.deepStrictEqual(seen, [0.4]);
    assert.strictEqual(log.destroyed, 1);
    const b = await set({ Translator: translator((t, o) => `[${o.sourceLanguage}>${o.targetLanguage}] ${t}`, {}) }, () => TR.back('Hallo Anna', 'de'));
    assert.deepStrictEqual(b, { ok: true, text: '[de>en] Hallo Anna' });
  });

  test('translate: failures become { ok:false, reason } and never throw (no API, unavailable pair, refused download, empty result)', async () => {
    assert.deepStrictEqual(await set({}, () => TR.translate('x', 'de')), { ok: false, reason: 'unsupported' });
    assert.deepStrictEqual(await set({ Translator: translator(t => t, {}, 'unavailable') }, () => TR.translate('x', 'de')), { ok: false, reason: 'pair-unavailable' });
    const refused = { availability: async () => 'downloadable', create: async () => { const e = new Error('x'); e.name = 'NotAllowedError'; throw e; } };
    assert.deepStrictEqual(await set({ Translator: refused }, () => TR.translate('x', 'de')), { ok: false, reason: 'NotAllowedError' });
    assert.deepStrictEqual(await set({ Translator: translator(() => '   ') }, () => TR.translate('x', 'de')), { ok: false, reason: 'empty' });
    assert.deepStrictEqual(await set({ Translator: translator(() => { throw new Error('boom'); }) }, () => TR.translate('x', 'de')), { ok: false, reason: 'Error' });
  });
};
