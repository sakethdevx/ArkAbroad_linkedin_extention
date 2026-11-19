# Changelog — LinkedIn Outreach AI (improvements on top of base v3.1.0)

Base: tag `base-v3.1.0`. Each entry: **what / why / tradeoff / how to demo**. This file is the Loom script.

## Unreleased
_Slices land below as they ship._

### Slice 1 — Trustworthy scraping (headline #3 foundation) · v3.2.0

**What**
- **Fixed the experience parser.** The base regex treated any line containing `mar|jun|dec|may…` as a date, so titles like *Marketing* Manager, *Jun*ior Developer, *Dec*ision Scientist were silently dropped and the company became the "title". Dates are now recognised by year ranges (`Jan 2021 – Present`, `2018 – 2022`), with non-English "present" words.
- **Multiple roles at one company** are now grouped (company header → child roles), via DOM structure (`<li>` nesting) with a flat-text fallback.
- **Language-independent section lookup** (`#experience` anchors first, multilingual headings second), duplicate visually-hidden text collapsed, every field wrapped so one failure can't crash the scrape.
- **"What I read" card**: shows what was understood, a confidence pill (*Read well / Partly read / Barely read*), exactly what's missing, and lets the user fix name / role / company inline before generating.
- **Paste fallback**: if the page can't be read (or you're not on a profile), paste the profile text; same parser, no scraping, nothing leaves the device.
- **Never a nonsense draft**: if nothing readable was found, we say so and offer paste instead of "Hi there… your work as your work".
- **Permissions trimmed**: removed `tabs` (no more "read your browsing history" install warning) and `activeTab`; the content script is no longer declared in the manifest, it is injected **only when you click** Generate, and restores your scroll position.
- Small: "Test key" no longer silently saves the key; removed licence leftovers and the dead `remaining` / `SAVE_RECENT` / `GET_RECENT` paths; fixed `<title>`.

**Why** Everything downstream (hooks, overlap, drafts) is only as good as the data. Students need to *see* and *fix* what the tool understood, and trust that it fails gracefully.

**Tradeoffs / honesty**
- LinkedIn's markup changes often and I couldn't inspect a live logged-in page while building; the DOM adapter is tested against a fixture modelled on the known structure (anchors, `<ul><li>`, hidden duplicate spans). The paste fallback exists precisely for this.
- LinkedIn's help centre says it does not permit browser extensions that scrape or automate. This tool only reads the page you are looking at, on your click, and never sends or clicks anything; the paste path avoids scraping entirely. See README.
- Headline parsing now only trusts an explicit "X **at** Y" (the base also read `Python | SQL` as title=Python, company=SQL).

**Demo** Open a profile with a title like "Marketing Intern" → old build mangles it, new build reads it right. Then a sparse / private profile → amber "Partly read" card with what's missing. Then a non-profile page → paste the profile text and get a draft.

**Verify** `node test/run.js` (16 tests; 19 with jsdom, see `test/dom.test.js`). Manual: load unpacked, open `/in/…` profile, click *Scrape & Generate*; check the manifest shows no `tabs` permission.

### Slice 2 — Résumé-powered "what you two have in common" (headline #1)

**What**
- **The résumé finally does something.** Upload a PDF in Settings → it is read **on the device** (Mozilla pdf.js, Apache-2.0, vendored in `lib/`, no network) → I pull out schools, employers, skills and city and show them in an editable **"What I found about you"** card. The edited card is the source of truth, not the parser's guess.
- **Overlap engine** (`utils/overlap.js`): compares your background with the profile you're viewing and returns ranked, toggleable chips: shared **current employer** > **school** > past employer > **skills** > **city**. Alias-aware (*IIT Madras* = *Indian Institute of Technology, Madras*; *JS* = *JavaScript*; *Société Générale* = *Societe Generale*) and deliberately conservative: *University of Madras* ≠ *IIT Madras*, *National University of Singapore* ≠ *Singapore Management University*, a shared country is not a shared city.
- **Draft leads with the shared ground**; tapping a chip off removes it (free drafts update instantly; in AI mode you press Regenerate so a toggle doesn't silently spend an API call).
- **Privacy**: the PDF is never stored (v3.1 saved a 4 MB base64 blob it never used → migrated once, then deleted); emails, phone numbers and URLs are stripped from the extracted text; only a compact summary (schools/employers/skills/city/intro) ever goes into an AI prompt, and only if you've added your own key.
- **PDFs are untrusted input**: 5-page cap, 20 s timeout, image-size cap, no `eval`, password-protected / corrupt / scanned PDFs give a friendly message and open a **paste-your-résumé-text** fallback.
- **Deep Mode → Review Mode** with honest steps (*Read the profile → Find common ground → Write the draft*). The fake "OpenAI — Web Enrichment" layer and 300 ms artificial delay are gone.
- Résumé info saves as soon as it's read (the old "click Save to confirm" meant tab-switchers saw no résumé).

**Why** A specific, checkable connection ("we both studied at …") is what separates a reply from an ignore, and it's exactly the thing a student has and a template doesn't. It also makes the previously dead résumé upload worth doing.

**Tradeoffs / honesty**
- Résumé layouts vary wildly; the heuristics are good on common single-column résumés and approximate on creative ones. That's why the result is editable and why a paste path exists.
- Skills are matched by exact/alias equality (plus a text scan of the headline/About for ≥3-letter skills): fewer matches, fewer wrong ones.
- pdf.js adds ~1.8 MB to the package (parser + worker) but it's never loaded unless you upload a résumé.

**Demo** Settings → upload résumé → show the card it built (and that nothing was uploaded) → open a profile → chips light up ("School · IIT Madras", "Skills · Python and SQL") → untick one → draft changes. Then: a scanned PDF → friendly fallback.

**Verify** `node test/run.js` (35 tests incl. a real PDF through the vendored pdf.js). Manual: load unpacked → Settings → upload a text-based PDF résumé → confirm the card, then a profile page → chips.

### Slice 3 — Free Mode that doesn't read like a template, and fits LinkedIn (headline #2)

**What**
- **A composer instead of one fixed template** (`utils/compose.js`). Each draft is built from slots: greeting → **hook** (best shared background → their post → their role) → **one line on who you are** (your résumé intro) → **one ask** → **easy out** → sign-off. It produces **3 distinct drafts** (A/B/C); "New drafts" really gives new ones (the base version's *Regenerate* returned identical text in Free Mode).
- **Format switch: Connection note (200) vs Message (~500)**, with a live counter that turns red over the limit. Notes are fitted by dropping the least valuable slot first (easy-out → 2nd shared point → who-I-am → short-form hook/ask); the 200-char limit is enforced by a fuzz test over 1,100+ combinations of type × tone × format × awkward inputs (long company names, long titles, long intros).
- **"Reply-ready" checklist**, live on whatever you type: *specific to them · one clear ask · fits the limit · no stock phrases · uses their name*. It teaches *why* a message works and re-checks your edits.
- **Writing choices backed by the research brief**: short, specific hook, a single small ask, no "I hope this finds you well". A cold 200-char note asks for advice, not a referral. Formal tone expands contractions; it never claims things the sender may not be able to stand behind ("I've been following…" was cut during review).
- **Warm-first tip** when they have recent posts (labelled directional, from a single vendor dataset).
- **Remembers** your format / tone / type. Free drafts update instantly when you toggle a chip, format or tone; in AI mode it asks you to press the button so a toggle never silently spends a request.
- **Claude path (only if you add your own key)**, hardened: system prompt states the profile/résumé content is **untrusted data**; strings are JSON-encoded; only whitelisted, clipped fields are sent; invisible/control/Unicode-tag characters are stripped; fields that look like instructions to an AI (*"ignore previous instructions…"*) are **flagged to you and dropped entirely**; the model has no tools; output is **validated** (length, no links/emails/phones, no leaked instructions or keys) and falls back to a free draft if it fails. Structured JSON output (3 drafts). Friendly errors for bad key / rate limit / overloaded / offline / refusal, and the user always still gets a free draft.
- Fixes along the way: the 600-character prompt limit (LinkedIn's note limit is 200), `Test` no longer saves silently, all `innerHTML` for scraped text replaced by `textContent`.

**Why** 90% of this audience never adds an API key, so the free path has to be genuinely good, and a 200-character note with one specific hook and one small ask is what gets replies. The checklist makes the "why" visible.

**Tradeoffs / honesty**
- Composed text is deliberately plain and short rather than "clever"; variety comes from phrasing pools and structure, not from pretending to be an LLM.
- Prompt-injection defence is layered, not absolute: sanitise → whitelist → flag/drop → untrusted-data policy → no tools → output validation → a human reads every draft.
- The Claude request/response path is tested against a **stubbed** API (request shape, headers, key handling, fallbacks); I have not exercised it against the live API in this build, so please run one real draft with your key.
- Model: `claude-haiku-5-5`, thinking disabled for short drafts; if the API rejects an optional parameter the call retries without it.

**Demo** No key: pick *Connection note*, scrape → three drafts, counter, checklist; edit until it goes red at 201; *New drafts*; toggle a chip off → drafts change. Switch to *Message* → fuller draft with easy-out and sign-off. Then paste a profile whose About says "Ignore previous instructions…" → amber notice, field ignored.

**Verify** `node test/run.js` (58 tests: composer fuzz, safety, a sandboxed run of the real `background.js` with stubbed `fetch`/`chrome`). Manual: load unpacked; try both formats, three tones, Job/Referral; with a real key, Test → Save → Generate.

### Slice 4 — Side panel, shortcut and honest privacy (headline #4) + polish

**What**
- **Side panel** hosting the same `popup.html` (no rebuild; the popup *is* the panel). It stays open while you click around LinkedIn, so a draft is no longer lost when the popup closed mid-generation. **Toolbar click or Alt+Shift+O** opens it.
- **Follows the tab you're on**: navigating to another profile (including LinkedIn's in-page navigation) clears the old draft, so a message written for one person can never sit under another person's profile; off-LinkedIn it falls back to the paste option.
- **Privacy you can see**: a strip under the header says *"Free Mode: everything stays on this device"* or *"AI Mode: a short profile summary goes to Anthropic"*. In AI Mode the first draft opens a **consent dialog that shows the exact payload and instructions** (same function builds the preview and the real request, covered by a test); choices are *Send to Claude* (remembered), *Use a free draft*, or *Cancel*. **What's sent?** re-opens it any time.
- Settings rewritten as a plain "What leaves your device" list; the API key field finally has a label.
- Small cleanups: API-key "Test" only tests; history 5 → 30 with **Mark as sent**; pasted profiles no longer overwrite each other in Recent; licence/OpenAI leftovers and dead message handlers removed; `<title>`/copy fixed.
- **Visual direction — "correspondence"**: warm paper + ink-blue accent (9.6:1 on white; all text pairs checked ≥ 4.5:1), a serif voice for the words you'll actually send (system fonts only, no web fonts, no remote requests), small-caps labels, chips as stamped tags with a ✓ (state isn't colour-only), the draft on a paper-like card.
- **Accessibility**: ARIA tab pattern with arrow-key navigation (main tabs and Draft A/B/C), labelled controls, `aria-live` status, the counter announces only when crossing the limit, focus-visible rings, dialog focus handling, `prefers-reduced-motion`, usable from 320 px to wide panels. Static a11y checks run in the test suite.

**Why** A popup is the wrong shape for a task that happens *while* browsing, and a tool that reads profiles has to earn trust: say what it does with the data, show it, and let the user decline.

**Tradeoffs / honesty**
- The side panel is now the default entry point (the base had a popup). Chrome 116+ is required; I set `minimum_chrome_version`.
- I did **not** build the on-device Gemini Nano polish I'd listed as a stretch: Chrome's Prompt API needs ~22 GB free disk, a capable GPU/16 GB RAM and only supports 5 languages, so it can't be the foundation for most students, and I can't verify it on target machines. Free drafts are composed deterministically instead. It's the first "next" item.
- Everything visual was checked in real Chrome via screenshots of the actual UI with a stubbed extension API; the extension itself still needs a real load-unpacked pass on live LinkedIn (see Phase 5 checklist).

**Demo** Click the icon → panel opens → click through LinkedIn while it stays → switch to a new profile and watch the draft clear → add an API key → *What's sent?* shows the exact payload → *Use a free draft*.

**Verify** `node test/run.js` (67 tests incl. manifest/permission/network-origin/secret guards and HTML a11y). Manual: load unpacked; press Alt+Shift+O; Settings → add a key → generate → consent dialog.

### Self-review pass (two reviews, then fixes)

**As a skeptical hiring manager:** is there taste, judgment, a finished scope? → Four coherent headlines on top of one audit; deliberate cuts with reasons (insert-into-LinkedIn, Gemini Nano, company-news "enrichment"); claims backed by tests (79) and by checking the numbers (e.g. I measured the contrast ratios and found one pair at 4.22:1 and a changelog figure that was off → fixed both). Things I'd flag myself: live-LinkedIn DOM and the live Claude call weren't testable in my environment (see `LOOM_OUTLINE.md` checklist); pdf.js adds ~1.8 MB (loaded only when a résumé is uploaded).

**As a first-time student with no API key:** is it clear within a minute? → Found and fixed: the draft was below the fold (now scrolls into view); the résumé was never suggested on first run (one-time tip, dismissible); no nudge to write a one-line intro (draft note); "Not now" was styled like a destructive action; **"Scrape & Generate" is developer jargon → "Read profile & write draft"**; textarea too tall for a 200-char note.

**Real defects the review surfaced:** scraping targeted `currentWindow` rather than the panel's tab (wrong with several windows) → the panel now passes its tab id; opening LinkedIn's *Contact info* overlay changed the URL and would have wiped the draft → page identity is now the profile slug; quoting a post from *Activity* can attribute a repost to the wrong person → explicit "check it's theirs" notice; `…”.` punctuation pile-up in quoted hooks; contrast on warning text.

### Fix: description text used as a job title (found on a real profile)
**What happened** On a real creator profile, the draft read *"Your work as This essay was originally published here. The keys my employee had just thrown at me ricocheted off of my left shoulder… stood out to me."* A description / "see more" block inside the Experience list had no date line, and the parser accepted *any* undated block as a role, using its first line as the title; with no job marked current, it won.

**Fix (three layers)**
- **Parser:** an undated block only counts as a role if it still reads like *Title / Company* (two short labels); titles/companies must pass `plausibleLabel` (short, no truncation "…", no sentence break; abbreviations like *Dr.*, *Inc.*, *U.S.* are fine).
- **Profile builder:** the chosen current title/company and past companies are validated the same way; entries with neither are skipped.
- **Composer:** even if bad text reaches it, a paragraph is never spliced into "Your work as …"; it falls back to the generic opener.

**Tradeoff** In that case the draft is now generic ("I came across your profile…") rather than wrong. With a résumé overlap, a recent post, or a clean role it's still specific. A headline-based opener is the obvious next improvement.

**Tests** Regression tests reproduce the exact text, plus abbreviation false-positives (my first version wrongly rejected "Dr. Smith Dental Clinic"; the new test caught it).

### Fix: lower sections not loading before the read (reported on a signed-in profile)
**What happened** The profile was read before LinkedIn had rendered Experience / Education / Skills, so the "What I read" card was thin and the draft generic. The base logic (kept in my first pass) jumped to fixed offsets (800 / 1600 / 2400 px) with fixed 450 ms waits and only scrolled `window`; LinkedIn renders sections as they approach the viewport, and a long profile is taller than 2400 px.

**Fix** `utils/page_scroll.js`: finds the element that actually scrolls (document, else the tallest scrollable container), steps down one viewport at a time, waits for the page to grow, stops as soon as Experience + Education (+ Skills) exist, or when the bottom is stable, or after a 9 s cap, then **always restores the reader's scroll position**. Scrolling only; it never clicks "see more".
- The reader now reports how it went (`load.steps / reachedBottom / container`).
- The injected script is **version-checked**, so after an extension update an open tab gets the new code instead of silently running the old one.

**Verified** 7 simulated-page tests (lazy sections, window vs container, early stop, growing page, no-scroll page, time cap) **and a run in real headless Chrome** on a lazy-loading page in both layouts: all 6 sections rendered in 9 steps (~3 s) and the position was restored.

**Tradeoff** Reading now takes a few seconds on long profiles (it's scrolling the page for you). Not yet confirmed against LinkedIn's live markup.

### Fix: a profile's headline quoted as "your recent post" (reported with screenshots)
**What happened** Draft C said *I enjoyed your recent post: "Amazon ML Summer School ’26 Mentee | AI/ML Intern | Google…"*. That is the author's **headline** printed at the top of every post card, not the post. The Activity reader took any long text fragment, and LinkedIn splits a post's inline link ("Selected for **Amazon ML Summer School** 2026!") into separate fragments.
**Fix** Each post card is now read as *lines* (Chrome `innerText`, with a block-level fallback) and `extractPostText` drops the card chrome: author name, "• You", the author's headline (also when truncated), "4mo • Edited", reaction/impression counts, "View analytics", "…more", leading emoji. A headline-looking line ("A | B | C") is never used, and the composer refuses to quote one even if it arrives. Result for the screenshots: *"Selected for Amazon ML Summer School 2026!"* and *"Proud to have contributed behind the scenes as a Volunteer while learning and growing as a Participant at Microsoft"*.
**Tests** The exact strings from the screenshots, a DOM fixture with an inline link, and negative cases (header only, counts only, pipe-headline).
**Tradeoff** If a post card has only an image/document and no text, there is no quote and the draft falls back to the role/generic opener (better than quoting something wrong). Reposts are still ambiguous, hence the existing "check it's their own post" note.

### Fix: header and tab bar disappearing after a draft is generated (side panel)
**What happened** After a draft appeared, the title bar and CURRENT / RECENT / SETTINGS tabs slid off the top and couldn't be reached. I reproduced it in real Chrome: the **`<html>` element itself was scrolled (110 px)**, putting the header at y = −110 and the tab bar off-screen. Cause: after drawing a draft I called `element.scrollIntoView()` to bring it into view, which scrolls *every* ancestor that can scroll, including ones styled `overflow: hidden`. (Same class of problem: the "What's sent?" and résumé-tip links used scrolling/focus the same way.)

**Fix (belt and braces)**
- **No more `scrollIntoView`.** A helper scrolls only the panel's own content area (`.tab-content`).
- **The shell can't scroll at all:** `html` is `overflow: hidden` and the body is pinned to the viewport (`position: fixed; inset: 0`), so there is nothing for the page to scroll. `overflow: clip` alone wasn't enough (on `<html>` it's treated as `hidden` and stays scrollable by script), which I found by testing.
- A scroll listener resets the shell to 0 as a last safety net; header, privacy strip and tabs never shrink.

**Verified in real Chrome** at 420 / 650 / 900 px panel heights: after a draft, header y = 0 and tab bar visible. I also forced the old `scrollIntoView` call as a stress test, and the header still doesn't move. Settings still scrolls to the bottom. A test now fails if `.scrollIntoView(` is reintroduced or the body is unpinned.

### Feature: Groq as a second AI provider (bring your own key)
**Why** Most students don't have an Anthropic key. Groq offers a free plan (with usage limits) and an OpenAI-style API, so it's the easiest way for a student to get AI-written drafts without paying.

**What**
- **Settings → provider switch (Anthropic / Groq)** with the right placeholder and a link to get a key. Pasting a key auto-selects its provider (`gsk_…` → Groq, `sk-ant-…` → Anthropic).
- **One provider layer, not a copy-paste**: both providers go through the same `callModel()`, so everything from the earlier slices applies unchanged: sanitising, the untrusted-data system prompt, field dropping on injection, output validation (length / links / emails / phones / leaks), the free-draft fallback, and the "exact payload" preview. Groq uses `llama-3.3-70b-versatile` (falls back to `llama-3.1-8b-instant` if that model is unavailable) in JSON mode with the JSON shape described in the instructions (JSON mode only guarantees valid JSON, not a schema), and retries as plain text if a model rejects JSON mode.
- **Minimum permissions**: `api.groq.com` is an **optional** host permission. Chrome asks for it when the user presses Save/Test with Groq selected (it must come from a click); people who never use Groq never grant it. If they decline, the key is **not saved** and they're told what to do; if it's ever missing, nothing is sent and a clear message appears.
- **Consent is per provider**: the dialog names the provider, host and model; an existing Anthropic user isn't re-asked, but switching to Groq asks once.
- Labels and messages are provider-aware ("AI Mode · Groq", "Written by Llama via Groq", provider-specific errors: bad key, rate limit, busy, offline).

**Tradeoffs / honesty**
- Groq's free plan has low rate limits; hitting one gives a friendly message and free drafts, never an error. I did not confirm the exact free-tier limits or whether a card is required; the UI only says "free plan with usage limits".
- Llama models follow the "one specific hook, one ask" instructions less reliably than Claude, which is why every Groq draft still passes the same validation and the checklist re-checks your edits.
- **Not tested against the live Groq API** (no key in my environment): the request shape comes from Groq's API reference and is covered by sandbox tests with a stubbed `fetch`. Please run one real draft with a Groq key.
- What leaves the device in Groq mode is the same short profile summary, sent to `api.groq.com`; I did not review Groq's data-retention terms, so Settings says what we send, not how Groq handles it.

**Tests** 15 new (109 total): Groq request shape (Bearer only, key never in the body), prefix detection vs explicit choice, validation and malformed-JSON fallback, every error class, model fallback / JSON-mode retry / no retry on auth errors, missing-permission behavior, preview parity, permission request and denial in the popup, per-provider consent. A new guard also asserts that only the background worker can make network calls.

### Fix: "The Llama model is not available to this key" (first real Groq key test)
**What happened** Groq refused both models I hard-coded (`llama-3.3-70b-versatile`, then `llama-3.1-8b-instant`) for a real key, and my error text hid Groq's own explanation. Model availability differs per account (models are retired, and organizations can restrict which models a key may use), so fixed names were the wrong design.
**Fix** If the defaults are refused, ask Groq what *this key* can use (`GET /openai/v1/models`), drop non-chat models (speech, TTS, guard, embeddings), try the best remaining ones (preference order, up to 3), and remember what worked for that key. If nothing works, the message now quotes Groq's own words and the model it tried (and says plainly when the key has no chat models, or when the key itself is rejected). Anthropic behaviour is unchanged.
**Tests** Discovery path (skips non-chat models, remembers the working one), empty list, failing list, rejected key; 111 total.
**Honesty** I still can't call Groq from here, so I haven't seen the real refusal text; the new message will show it.
