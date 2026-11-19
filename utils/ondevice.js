'use strict';

// ondevice.js — Chrome's built-in model (Gemini Nano, the "Prompt API") behind a small, forgiving wrapper.
// Runs in the panel page only (the API is not available in service workers or web workers).
//   OnDevice.status()          → 'unsupported' | 'downloadable' | 'downloading' | 'available'
//   OnDevice.enable(onProgress) must be called from a CLICK (Chrome requires user activation to start the model download)
//   OnDevice.polish(req, opts) → string[] | null      never throws; null means "keep the template drafts"
// Nothing here uses the network: the model is downloaded and run by Chrome, and no text leaves the computer.

(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OnDevice = api;
})(typeof self !== 'undefined' ? self : globalThis, function (root) {

  // English only for now: that is what our drafts are written in, and the model's supported output languages are en/ja/es/de/fr
  const EXPECT = { expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] };
  const lm = () => (typeof root.LanguageModel !== 'undefined' && root.LanguageModel && typeof root.LanguageModel.availability === 'function' ? root.LanguageModel : null);

  async function status() {
    const L = lm();
    if (!L) return 'unsupported';
    try {
      const a = await L.availability(EXPECT);
      return a === 'available' ? 'available' : a === 'downloadable' ? 'downloadable' : a === 'downloading' ? 'downloading' : 'unsupported';
    } catch (_) { return 'unsupported'; }
  }

  // Starts (and waits for) the one-time model download. onProgress gets a fraction 0..1.
  async function enable(onProgress) {
    const L = lm();
    if (!L) return { ok: false, reason: 'unsupported' };
    let session;
    try {
      session = await L.create({
        ...EXPECT,
        monitor(m) { try { m.addEventListener('downloadprogress', (e) => { if (typeof onProgress === 'function') onProgress(Math.max(0, Math.min(1, Number(e.loaded) || 0))); }); } catch (_) { /* progress is cosmetic */ } }
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: String((err && err.name) || 'error') };
    } finally {
      try { session && session.destroy && session.destroy(); } catch (_) { /* nothing to free */ }
    }
  }

  const tryJson = (t) => { try { return JSON.parse(t); } catch (_) { return null; } };
  // JSON object from a reply, recovering one that is wrapped in prose or code fences
  function parseObject(text) {
    const o = tryJson(text);
    if (o && typeof o === 'object' && !Array.isArray(o)) return o;
    const m = String(text || '').match(/\{[\s\S]*\}/);
    const r = m ? tryJson(m[0]) : null;
    return r && typeof r === 'object' && !Array.isArray(r) ? r : null;
  }
  function parseVariants(text) {
    const o = parseObject(text);
    return o && Array.isArray(o.variants) ? o.variants.filter(v => typeof v === 'string') : null;
  }

  // One prompt, one reply, always cleaned up. req = { system, user, schema }.  opts = { timeoutMs, signal }.  → text | null
  async function run(req, opts = {}) {
    const L = lm();
    if (!L || !req || !req.user) return null;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), Math.max(1000, opts.timeoutMs || 25000));
    const onAbort = () => ctl.abort();
    if (opts.signal) { if (opts.signal.aborted) ctl.abort(); else opts.signal.addEventListener('abort', onAbort, { once: true }); }
    let session;
    try {
      session = await L.create({ ...EXPECT, signal: ctl.signal, initialPrompts: req.system ? [{ role: 'system', content: req.system }] : undefined });
      const text = await session.prompt(req.user, { signal: ctl.signal, ...(req.schema ? { responseConstraint: req.schema } : {}) });
      return typeof text === 'string' ? text : null;
    } catch (_) {
      return null;
    } finally {
      clearTimeout(timer);
      if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
      try { session && session.destroy && session.destroy(); } catch (_) { /* nothing to free */ }
    }
  }

  // drafts: { variants: [...] } → string[] | null.   Never throws.
  async function polish(req, opts = {}) {
    const variants = parseVariants(await run(req, opts));
    return variants && variants.length ? variants : null;
  }

  // anything structured (e.g. a resume): a JSON object | null.   Never throws.
  async function extract(req, opts = {}) {
    return parseObject(await run(req, opts));
  }

  return { status, enable, polish, extract, parseVariants, parseObject, EXPECT };
});
