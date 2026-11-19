'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

module.exports = (test) => {
  const root = path.join(__dirname, '..');
  const m = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

  test('manifest: minimum permissions, no static content scripts, only two hosts', () => {
    assert.deepStrictEqual([...m.permissions].sort(), ['scripting', 'sidePanel', 'storage']);
    assert.deepStrictEqual([...m.host_permissions].sort(), ['https://api.anthropic.com/*', 'https://www.linkedin.com/*']);
    assert.deepStrictEqual(m.optional_host_permissions, ['https://api.groq.com/*'], 'Groq is optional: requested only when the user picks it');
    assert.strictEqual(m.content_scripts, undefined, 'content script must be injected on demand');
    assert.ok(!m.permissions.includes('tabs') && !m.permissions.includes('activeTab'));
    assert.ok(!('web_accessible_resources' in m) && !('externally_connectable' in m));
  });

  test('manifest: every referenced file exists', () => {
    const files = [m.background.service_worker, m.side_panel.default_path, ...Object.values(m.icons)];
    files.forEach(f => assert.ok(fs.existsSync(path.join(root, f)), f));
  });

  test('network: the only remote origins in extension code are api.anthropic.com and linkedin.com', () => {
    const code = ['background.js', 'popup.js', 'panel/providers.js', 'panel/ondevice_ui.js', 'panel/overlap_ui.js', 'panel/settings.js', 'panel/resume_ui.js', 'panel/consent.js', 'panel/drafts.js', 'utils/rules.js', 'utils/person.js', 'utils/approach.js', 'utils/followup.js', 'panel/followup_ui.js', 'content_script.js', 'utils/compose.js', 'utils/overlap.js', 'utils/resume.js', 'utils/safety.js', 'utils/profile_parse.js', 'utils/page_scroll.js', 'utils/spotlight.js', 'utils/draftcheck.js', 'utils/ondevice.js', 'utils/translate.js', 'popup.html']
      .map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
    const origins = [...new Set((code.match(/https?:\/\/[a-z0-9.-]+/gi) || []).map(x => x.toLowerCase()))];
    // API hosts we talk to, plus two documentation links shown in Settings (never fetched)
    const allowed = ['https://api.anthropic.com', 'https://api.groq.com', 'https://www.linkedin.com', 'https://console.anthropic.com', 'https://console.groq.com'];
    const extra = origins.filter(o => !allowed.some(a => o.startsWith(a)));
    assert.deepStrictEqual(extra, [], 'unexpected origins: ' + extra.join(', '));
    // only the background worker may make network requests
    ['popup.js', 'panel/providers.js', 'panel/ondevice_ui.js', 'panel/overlap_ui.js', 'panel/settings.js', 'panel/resume_ui.js', 'panel/consent.js', 'panel/drafts.js', 'utils/rules.js', 'utils/person.js', 'content_script.js', 'utils/compose.js', 'utils/overlap.js', 'utils/resume.js', 'utils/safety.js', 'utils/profile_parse.js', 'utils/page_scroll.js', 'utils/spotlight.js', 'utils/draftcheck.js', 'utils/ondevice.js', 'utils/translate.js']
      .forEach(f => assert.ok(!/\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket/.test(fs.readFileSync(path.join(root, f), 'utf8')), f + ' must not make network calls'));
  });

  test('secrets: nothing key-like is committed', () => {
    const files = execSync('git ls-files', { cwd: root }).toString().split('\n').filter(f => f && !/\.(png|pdf|mjs)$/.test(f) && !f.startsWith('lib/'));
    for (const f of files) {
      const t = fs.readFileSync(path.join(root, f), 'utf8');
      const hits = (t.match(/sk-ant-[A-Za-z0-9_-]{20,}/g) || []);   // short fake keys in tests are fine
      assert.deepStrictEqual(hits, [], `${f} contains a key-like string`);
    }
  });

  test('css: the consent dialog centres itself (the global margin reset must not pin it top-left)', () => {
    const css = fs.readFileSync(path.join(root, 'popup.css'), 'utf8');
    const rule = css.match(/dialog#consent-dialog\s*\{[^}]*\}/)[0];
    assert.ok(/margin:\s*auto/.test(rule) && /inset:\s*0/.test(rule));
  });
};
