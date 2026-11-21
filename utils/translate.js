'use strict';

// translate.js — write to someone in THEIR language, on this device (Chrome's built-in Translator + Language Detector).
// Panel page only. No network of our own: Chrome downloads and runs the models.
//   Translate.supported()                      → boolean
//   Translate.detect(text)                     → { lang, confidence } | null   (null = English, unsure, or not possible; silent)
//   Translate.translate(text, target, onProg)  → { ok, text } | { ok:false, reason }   (call from a CLICK: first use downloads a model)
//   Translate.back(text, from)                 → same shape, into English: lets the writer check what the translation says
// Translations are never trusted blindly: the panel always shows the English back-translation next to the result.

(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Translate = api;
})(typeof self !== 'undefined' ? self : globalThis, function (root) {

  // languages Chrome's Translator lists as supported (English is the source of our drafts)
  const LANGS = ['ar', 'bn', 'de', 'es', 'fr', 'hi', 'id', 'it', 'ja', 'ko', 'nl', 'pl', 'pt', 'ru', 'sv', 'th', 'tr', 'uk', 'vi', 'zh'];
  const MIN_CONFIDENCE = 0.8;
  const MIN_CHARS = 40;

  const T = () => (typeof root.Translator !== 'undefined' && root.Translator && typeof root.Translator.create === 'function' ? root.Translator : null);
  const D = () => (typeof root.LanguageDetector !== 'undefined' && root.LanguageDetector && typeof root.LanguageDetector.create === 'function' ? root.LanguageDetector : null);
  const supported = () => !!T();

  const base = (tag) => String(tag || '').toLowerCase().split('-')[0];

  // Never triggers a download by itself (that needs a click): only runs if the detector model is already on the computer.
  async function detect(text) {
    const L = D();
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!L || t.length < MIN_CHARS || !T()) return null;
    let det;
    try {
      if (typeof L.availability === 'function' && (await L.availability()) !== 'available') return null;
      det = await L.create();
      const res = await det.detect(t.slice(0, 1500));
      const top = Array.isArray(res) ? res[0] : null;
      const lang = top && base(top.detectedLanguage);
      if (!top || !lang || lang === 'en' || lang === 'und' || !LANGS.includes(lang) || !(Number(top.confidence) >= MIN_CONFIDENCE)) return null;
      return { lang, confidence: Number(top.confidence) };
    } catch (_) {
      return null;
    } finally {
      try { det && det.destroy && det.destroy(); } catch (_) { /* nothing to free */ }
    }
  }

  async function availability(source, target) {
    const X = T();
    if (!X || typeof X.availability !== 'function') return X ? 'downloadable' : 'unavailable';
    try { return await X.availability({ sourceLanguage: source, targetLanguage: target }); } catch (_) { return 'unavailable'; }
  }

  async function run(text, source, target, onProgress) {
    const X = T();
    if (!X) return { ok: false, reason: 'unsupported' };
    if ((await availability(source, target)) === 'unavailable') return { ok: false, reason: 'pair-unavailable' };
    let tr;
    try {
      tr = await X.create({
        sourceLanguage: source, targetLanguage: target,
        monitor(m) { try { m.addEventListener('downloadprogress', (e) => { if (typeof onProgress === 'function') onProgress(Math.max(0, Math.min(1, Number(e.loaded) || 0))); }); } catch (_) { /* cosmetic */ } }
      });
      const out = await tr.translate(String(text || ''));
      return typeof out === 'string' && out.trim() ? { ok: true, text: out.trim() } : { ok: false, reason: 'empty' };
    } catch (err) {
      return { ok: false, reason: String((err && err.name) || 'error') };
    } finally {
      try { tr && tr.destroy && tr.destroy(); } catch (_) { /* nothing to free */ }
    }
  }

  const translate = (text, target, onProgress) => run(text, 'en', base(target), onProgress);
  const back = (text, from, onProgress) => run(text, base(from), 'en', onProgress);

  return { supported, detect, availability, translate, back, LANGS, MIN_CONFIDENCE };
});
