'use strict';
const assert = require('assert');

module.exports = (test, load) => {
  const R = load('utils/refine.js');
  const Spotlight = load('utils/spotlight.js');
  const J = (x) => JSON.parse(JSON.stringify(x));

  const SENDER = { skills: ['Python', 'SQL', 'React'], projects: [{ name: 'CampusMap', summary: 'route planner built with Python' }, { name: 'Expense Bot', summary: 'Telegram bot in SQL' }],
    experience: [{ title: 'Software Intern', company: 'Globex', detail: 'built a forecasting API in Python' }], schools: ['VIT'], employers: [] };

  test('refine: the comment is cleaned (control characters, spaces, 300 characters) and never empty-handed', () => {
    assert.strictEqual(R.cleanComment('  make   it\u0000 shorter​ \n please '), 'make it shorter please');
    assert.strictEqual(R.cleanComment('x'.repeat(900)).length, 300);
    assert.strictEqual(R.cleanComment(null), '');
  });

  test('refine: parseIntent understands tone, length, the ask, what to leave out, and which of YOUR items to mention', () => {
    const p = (c) => J(R.parseIntent(c, SENDER));
    assert.strictEqual(p('Make it shorter').shorter, true);
    assert.strictEqual(p('make it warmer and more casual').tone, 'Casual');
    assert.strictEqual(p('less formal please').tone, 'Casual', 'a negation flips the tone');
    assert.strictEqual(p('make it more formal').tone, 'Formal');
    assert.strictEqual(p('ask for a referral instead').purpose, 'Referral');
    assert.strictEqual(p('ask about internships').purpose, 'Job');
    assert.strictEqual(p('ask about collaborating').purpose, 'Collaboration');
    assert.deepStrictEqual(p("don't mention my school").omit, ['school']);
    assert.deepStrictEqual(p('remove the company and skills').omit.sort(), ['employer'], 'only what the pattern names; one removal per phrase is fine');
    assert.deepStrictEqual(p('mention my CampusMap project').mention, { kind: 'project', name: 'CampusMap' });
    assert.deepStrictEqual(p('highlight Python').mention, { kind: 'skill', name: 'Python' });
    assert.deepStrictEqual(p('Mention one of my projects').mention, { kind: 'project', name: '' });
    assert.strictEqual(p('mention my startup at Google').mention, null, 'an item that is not in YOUR profile is never invented');
    const multi = p('make it shorter and warmer');
    assert.ok(multi.shorter && multi.tone === 'Casual' && multi.applied.join(',') === 'warmer,shorter');
    assert.strictEqual(p('mention my internship at Globex').purpose, null, 'a role you mention is not a request to ask for a job');
  });

  test('refine: wording free mode cannot follow is reported as unmatched (never guessed); "longer" is recognised as unsupported', () => {
    assert.strictEqual(R.parseIntent('make it sound like Shakespeare', SENDER).unmatched, true);
    assert.strictEqual(R.parseIntent('', SENDER).unmatched, true);
    const l = R.parseIntent('make it longer', SENDER);
    assert.ok(l.longer && l.unmatched);
    assert.strictEqual(R.hasFreeEffect(R.parseIntent('shorter', SENDER)), true);
    assert.strictEqual(R.hasFreeEffect(R.parseIntent('sparkle', SENDER)), false);
  });

  test('refine: dataFor applies the choices to the drafting request, only ever with YOUR own items; the original is untouched', () => {
    const base = { tone: 'Neutral', messageType: 'Networking', overlaps: [{ kind: 'school', label: 'VIT' }, { kind: 'skills', label: 'Python' }], spotlight: null, profileData: { name: 'A', recentPosts: ['x'] } };
    const keep = J(base);
    const d = J(R.dataFor(base, R.parseIntent("make it formal, ask for a referral, don't mention the school, skip their post, mention CampusMap", SENDER), SENDER));
    assert.strictEqual(d.tone, 'Formal'); assert.strictEqual(d.messageType, 'Referral');
    assert.deepStrictEqual(d.overlaps.map(o => o.kind), ['skills']);
    assert.deepStrictEqual(d.profileData.recentPosts, []);
    assert.deepStrictEqual(J(base), keep, 'the input is not mutated');
    const mention = J(R.dataFor(base, R.parseIntent('mention my CampusMap project', SENDER), SENDER));
    assert.strictEqual(mention.spotlight.title, 'CampusMap'); assert.match(mention.spotlight.text, /^I built CampusMap/);
    const skill = J(R.dataFor(base, R.parseIntent('highlight SQL', SENDER), SENDER));
    assert.ok(/Expense Bot|Globex|Software Intern/.test(skill.spotlight.title), 'a skill is shown through YOUR item that uses it');
    const none = R.parseIntent('mention my startup at Google', SENDER);
    assert.strictEqual(J(R.dataFor(base, none, SENDER)).spotlight, null);
    assert.ok(Spotlight.named(SENDER, 'nonexistent thing') === null);
    assert.strictEqual(Spotlight.named(SENDER, '').title, 'CampusMap', 'no name = the first project');
  });

  const deps = (replies, OnDevice) => { const sent = []; return { sent, OnDevice, send: async (m) => { sent.push(m); return replies(m); } }; };
  const draft = 'Hi Priya,\nWe both studied at VIT. I work with Python and SQL. Would you be open to a quick chat?';

  test('refine: AI Mode → your AI rewrites (the comment travels in its own field); a failure leaves the draft unchanged with the reason', async () => {
    const d = deps(() => ({ success: true, text: 'Hi Priya,\nShort one. Open to a chat?', applied: ['shorter'] }));
    const r = await R.run(d, { comment: 'make it shorter', draft, data: { tone: 'Neutral' }, senderProfile: SENDER, ai: true });
    assert.deepStrictEqual(J(r), { ok: true, text: 'Hi Priya,\nShort one. Open to a chat?', source: 'ai', applied: ['shorter'] });
    assert.strictEqual(d.sent.length, 1);
    assert.strictEqual(d.sent[0].action, 'refineDraft');
    assert.strictEqual(d.sent[0].comment, 'make it shorter'); assert.strictEqual(d.sent[0].draft, draft);
    assert.ok(!d.sent[0].data.forceFree, 'AI Mode asks the AI');
    const bad = await R.run(deps(() => ({ success: false, error: 'Groq is busy.' })), { comment: 'shorter', draft, data: {}, senderProfile: SENDER, ai: true });
    assert.deepStrictEqual(J(bad), { ok: false, message: 'Groq is busy.' });
    assert.deepStrictEqual(J(await R.run(deps(() => null), { comment: 'x', draft, data: {}, senderProfile: SENDER, ai: true })).ok, false);
  });

  test('refine: Free Mode + on-device AI → the built-in model rewrites with the comment as allowed facts; if it fails, an understood request still works through the free rules', async () => {
    const OnDevice = { polish: async () => ['Hi Priya,\nLocal rewrite. Open to a chat?'] };
    const ok = deps((m) => (m.type === 'BUILD_REFINE_PROMPT' ? { success: true, system: 'S', user: 'U', schema: {} } : { success: true, polished: 1, variants: [{ text: 'Hi Priya,\nLocal rewrite. Open to a chat?', source: 'ondevice' }] }), OnDevice);
    const r = await R.run(ok, { comment: 'mention my Python project', draft, data: {}, senderProfile: SENDER, onDevice: true });
    assert.strictEqual(r.source, 'ondevice'); assert.strictEqual(r.text, 'Hi Priya,\nLocal rewrite. Open to a chat?');
    assert.deepStrictEqual(ok.sent.map(m => m.type || m.action), ['BUILD_REFINE_PROMPT', 'FINISH_DRAFTS']);
    assert.strictEqual(ok.sent[1].payload.comment, 'mention my Python project');
    const fall = deps((m) => (m.type ? { success: false } : { success: true, text: 'free text', applied: ['shorter'] }), { polish: async () => null });
    const f = await R.run(fall, { comment: 'make it shorter', draft, data: {}, senderProfile: SENDER, onDevice: true });
    assert.strictEqual(f.ok, true); assert.strictEqual(f.source, 'template');
    const odd = await R.run(deps(() => ({ success: false }), { polish: async () => null }), { comment: 'sound like Shakespeare', draft, data: {}, senderProfile: SENDER, onDevice: true });
    assert.strictEqual(odd.ok, false); assert.match(odd.message, /On-device AI could not make that change/);
  });

  test('refine: Free Mode follows what its rules understand (forced free, no AI) and says so plainly for anything else; an empty comment asks for one', async () => {
    const d = deps(() => ({ success: true, text: 'Hi Priya,\nCasual. Chat?', applied: ['warmer'] }));
    const r = await R.run(d, { comment: 'make it warmer', draft, data: { tone: 'Neutral' }, senderProfile: SENDER });
    assert.strictEqual(r.ok, true); assert.strictEqual(r.source, 'template');
    assert.strictEqual(d.sent[0].data.forceFree, true); assert.strictEqual(d.sent[0].data.tone, 'Casual'); assert.deepStrictEqual(J(d.sent[0].intent.applied), ['warmer']);
    const odd = deps(() => { throw new Error('must not be called'); });
    const u = await R.run(odd, { comment: 'sound like Shakespeare', draft, data: {}, senderProfile: SENDER });
    assert.deepStrictEqual(J(u), { ok: false, message: R.FREE_LIMIT });
    assert.match((await R.run(odd, { comment: 'make it longer', draft, data: {}, senderProfile: SENDER })).message, /can.t make a draft longer/);
    assert.match((await R.run(odd, { comment: '   ', draft, data: {}, senderProfile: SENDER })).message, /Write what you would like changed/);
    assert.strictEqual(odd.sent.length, 0);
  });

  test('refine: quick chips are each understood by the parser; free mode offers only chips its rules can do', () => {
    R.CHIPS.forEach(c => assert.strictEqual(R.parseIntent(c.comment, SENDER).unmatched, false, c.label));
    assert.deepStrictEqual(R.chipsFor('free').map(c => c.label), ['Shorter', 'Warmer', 'More formal', 'Mention a project']);
    assert.ok(R.chipsFor('ai').some(c => c.label === 'Add a question') && R.chipsFor('ondevice').length === 6);
  });
};
