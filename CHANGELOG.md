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

### Slice 2 — Resume-powered "what you two have in common" (headline #1)

**What**
- **The resume finally does something.** Upload a PDF in Settings → it is read **on the device** (Mozilla pdf.js, Apache-2.0, vendored in `lib/`, no network) → I pull out schools, employers, skills and city and show them in an editable **"What I found about you"** card. The edited card is the source of truth, not the parser's guess.
- **Overlap engine** (`utils/overlap.js`): compares your background with the profile you're viewing and returns ranked, toggleable chips: shared **current employer** > **school** > past employer > **skills** > **city**. Alias-aware (*IIT Madras* = *Indian Institute of Technology, Madras*; *JS* = *JavaScript*; *Société Générale* = *Societe Generale*) and deliberately conservative: *University of Madras* ≠ *IIT Madras*, *National University of Singapore* ≠ *Singapore Management University*, a shared country is not a shared city.
- **Draft leads with the shared ground**; tapping a chip off removes it (free drafts update instantly; in AI mode you press Regenerate so a toggle doesn't silently spend an API call).
- **Privacy**: the PDF is never stored (v3.1 saved a 4 MB base64 blob it never used → migrated once, then deleted); emails, phone numbers and URLs are stripped from the extracted text; only a compact summary (schools/employers/skills/city/intro) ever goes into an AI prompt, and only if you've added your own key.
- **PDFs are untrusted input**: 5-page cap, 20 s timeout, image-size cap, no `eval`, password-protected / corrupt / scanned PDFs give a friendly message and open a **paste-your-resume-text** fallback.
- **Deep Mode → Review Mode** with honest steps (*Read the profile → Find common ground → Write the draft*). The fake "OpenAI — Web Enrichment" layer and 300 ms artificial delay are gone.
- Resume info saves as soon as it's read (the old "click Save to confirm" meant tab-switchers saw no resume).

**Why** A specific, checkable connection ("we both studied at …") is what separates a reply from an ignore, and it's exactly the thing a student has and a template doesn't. It also makes the previously dead resume upload worth doing.

**Tradeoffs / honesty**
- Resume layouts vary wildly; the heuristics are good on common single-column resumes and approximate on creative ones. That's why the result is editable and why a paste path exists.
- Skills are matched by exact/alias equality (plus a text scan of the headline/About for ≥3-letter skills): fewer matches, fewer wrong ones.
- pdf.js adds ~1.8 MB to the package (parser + worker) but it's never loaded unless you upload a resume.

**Demo** Settings → upload resume → show the card it built (and that nothing was uploaded) → open a profile → chips light up ("School · IIT Madras", "Skills · Python and SQL") → untick one → draft changes. Then: a scanned PDF → friendly fallback.

**Verify** `node test/run.js` (35 tests incl. a real PDF through the vendored pdf.js). Manual: load unpacked → Settings → upload a text-based PDF resume → confirm the card, then a profile page → chips.

### Slice 3 — Free Mode that doesn't read like a template, and fits LinkedIn (headline #2)

**What**
- **A composer instead of one fixed template** (`utils/compose.js`). Each draft is built from slots: greeting → **hook** (best shared background → their post → their role) → **one line on who you are** (your resume intro) → **one ask** → **easy out** → sign-off. It produces **3 distinct drafts** (A/B/C); "New drafts" really gives new ones (the base version's *Regenerate* returned identical text in Free Mode).
- **Format switch: Connection note (200) vs Message (~500)**, with a live counter that turns red over the limit. Notes are fitted by dropping the least valuable slot first (easy-out → 2nd shared point → who-I-am → short-form hook/ask); the 200-char limit is enforced by a fuzz test over 1,100+ combinations of type × tone × format × awkward inputs (long company names, long titles, long intros).
- **"Reply-ready" checklist**, live on whatever you type: *specific to them · one clear ask · fits the limit · no stock phrases · uses their name*. It teaches *why* a message works and re-checks your edits.
- **Writing choices backed by the research brief**: short, specific hook, a single small ask, no "I hope this finds you well". A cold 200-char note asks for advice, not a referral. Formal tone expands contractions; it never claims things the sender may not be able to stand behind ("I've been following…" was cut during review).
- **Warm-first tip** when they have recent posts (labelled directional, from a single vendor dataset).
- **Remembers** your format / tone / type. Free drafts update instantly when you toggle a chip, format or tone; in AI mode it asks you to press the button so a toggle never silently spends a request.
- **Claude path (only if you add your own key)**, hardened: system prompt states the profile/resume content is **untrusted data**; strings are JSON-encoded; only whitelisted, clipped fields are sent; invisible/control/Unicode-tag characters are stripped; fields that look like instructions to an AI (*"ignore previous instructions…"*) are **flagged to you and dropped entirely**; the model has no tools; output is **validated** (length, no links/emails/phones, no leaked instructions or keys) and falls back to a free draft if it fails. Structured JSON output (3 drafts). Friendly errors for bad key / rate limit / overloaded / offline / refusal, and the user always still gets a free draft.
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

**As a skeptical hiring manager:** is there taste, judgment, a finished scope? → Four coherent headlines on top of one audit; deliberate cuts with reasons (insert-into-LinkedIn, Gemini Nano, company-news "enrichment"); claims backed by tests (79) and by checking the numbers (e.g. I measured the contrast ratios and found one pair at 4.22:1 and a changelog figure that was off → fixed both). Things I'd flag myself: live-LinkedIn DOM and the live Claude call weren't testable in my environment (see `LOOM_OUTLINE.md` checklist); pdf.js adds ~1.8 MB (loaded only when a resume is uploaded).

**As a first-time student with no API key:** is it clear within a minute? → Found and fixed: the draft was below the fold (now scrolls into view); the resume was never suggested on first run (one-time tip, dismissible); no nudge to write a one-line intro (draft note); "Not now" was styled like a destructive action; **"Scrape & Generate" is developer jargon → "Read profile & write draft"**; textarea too tall for a 200-char note.

**Real defects the review surfaced:** scraping targeted `currentWindow` rather than the panel's tab (wrong with several windows) → the panel now passes its tab id; opening LinkedIn's *Contact info* overlay changed the URL and would have wiped the draft → page identity is now the profile slug; quoting a post from *Activity* can attribute a repost to the wrong person → explicit "check it's theirs" notice; `…”.` punctuation pile-up in quoted hooks; contrast on warning text.

### Fix: description text used as a job title (found on a real profile)
**What happened** On a real creator profile, the draft read *"Your work as This essay was originally published here. The keys my employee had just thrown at me ricocheted off of my left shoulder… stood out to me."* A description / "see more" block inside the Experience list had no date line, and the parser accepted *any* undated block as a role, using its first line as the title; with no job marked current, it won.

**Fix (three layers)**
- **Parser:** an undated block only counts as a role if it still reads like *Title / Company* (two short labels); titles/companies must pass `plausibleLabel` (short, no truncation "…", no sentence break; abbreviations like *Dr.*, *Inc.*, *U.S.* are fine).
- **Profile builder:** the chosen current title/company and past companies are validated the same way; entries with neither are skipped.
- **Composer:** even if bad text reaches it, a paragraph is never spliced into "Your work as …"; it falls back to the generic opener.

**Tradeoff** In that case the draft is now generic ("I came across your profile…") rather than wrong. With a resume overlap, a recent post, or a clean role it's still specific. A headline-based opener is the obvious next improvement.

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
**What happened** After a draft appeared, the title bar and CURRENT / RECENT / SETTINGS tabs slid off the top and couldn't be reached. I reproduced it in real Chrome: the **`<html>` element itself was scrolled (110 px)**, putting the header at y = −110 and the tab bar off-screen. Cause: after drawing a draft I called `element.scrollIntoView()` to bring it into view, which scrolls *every* ancestor that can scroll, including ones styled `overflow: hidden`. (Same class of problem: the "What's sent?" and resume-tip links used scrolling/focus the same way.)

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

### Fix: "Groq returned an empty reply" (second real Groq key test)
**What happened** Model discovery worked, but the model it picked was a *reasoning* model (e.g. `openai/gpt-oss-*`). Those think first, and that hidden thinking counts against `max_completion_tokens`; the key test allowed only 16 tokens, so the reply came back HTTP 200 with no text.
**Fix** Reasoning models get a bigger budget (≥ 1024) and `reasoning_effort: low`; if a reply is empty because it hit the limit (`finish_reason: length`) it's retried once with 4× the budget; any other empty reply moves on to the next model; if every model is empty the message names the model instead of a misleading "no chat models". Non-reasoning models are untouched.
**Tests** Budget/effort for reasoning models, the length-retry, empty-reply fall-through and the final message (113 total).
**Still unverified live** I can't call Groq from here; the behaviour is modelled on how reasoning models are documented to work.

### Feature: AI Mode reads your resume and fills your whole profile
**Why** In AI Mode the student still had to type schools, employers and skills by hand, and the heuristic reader misses things (projects, roles, one-line intro).
**What** After a resume upload (or paste), if a key is saved, the extension shows the exact text it would send, and once you approve, the chosen provider returns a structured profile: name, one-line intro, summary, city, education, experience (title, company, years, highlight), projects, skills, certifications, languages. It fills the Settings card, your name and bio (only if empty, or if I had auto-filled the name), and is stored in `chrome.storage.local` as `senderProfile` (`source: 'ai'`). The drafting prompt now carries a compact version (education, experience, projects, summary), and the system prompt tells the model to use at most one of them, only if relevant. "Re-read my resume with AI" re-runs it any time.
**Safety** Resume text is data, in the same untrusted-content framing; the model's answer is whitelisted, length-capped, checked for instruction-like text and emails, and every school, employer, skill, project and certification must actually appear in the resume text (invented ones are dropped). Approval is asked on every upload and never remembered. Free Mode never opens the dialog or sends anything. If the AI fails, the on-device result stays and the message says so. Editing one field no longer drops the rest of the profile.
**Tests** Anthropic and Groq routes, grounding and injection drops, preview sends nothing, error/junk fallbacks, popup flow (consent first, fills every field, name not overwritten, decline path, Free Mode); 122 total.
**Unverified live** I can't call either provider from here; the schema and prompts follow their documented JSON modes.

### UX: one Free ⇄ AI switch, one yes, no more repeated questions
**Problem** Whether you were in AI mode depended on a hidden fact (is a key saved?). The only way back to Free was deleting the key, a dialog interrupted every draft, and every resume upload asked again. Confusing and stressful for a non-technical student.
**Change**
- A **Free | AI** switch in the header, always visible, remembered (`mode` in `chrome.storage.local`). The key stays saved when you switch to Free, so flipping back is one tap.
- **One consent**, shown the first time you turn AI on for a provider (v2): it lists what is sent for drafts and for resume uploads. After that nothing asks again: no per-draft dialog, no per-resume dialog. "What's sent?" still shows the exact live data any time.
- Saving a key in Settings turns AI on (after that one yes). Tapping AI with no key takes you to the key field. "Not now" leaves everything as it was.
- Turning AI on with a resume already uploaded reads it with AI automatically; uploading in AI Mode does the same.
- Existing users: a key with a prior consent for the same provider stays in AI mode; a key without consent (or a different provider) starts in Free and shows "AI is ready. Tap AI to use it."
- Background honours the switch: in Free the key is never used and no request is made.
**Also** Fixed the test harness firing the page's init twice (it hid double-binding).
**Tests** Switch flow, remembered choice, no per-draft dialog, key-less AI tap, resume auto-read, Free never sends, legacy consent; 125 total.

### Fix: the "Turn on AI" dialog opened in the top-left corner
**Cause** The stylesheet's global `* { margin: 0 }` reset removed the `margin: auto` that centres a modal `<dialog>`. **Fix** The dialog sets `margin: auto; inset: 0` itself (checked in real Chrome), and a test guards it. Also tidied the enable dialog: no empty "Instructions" section, no duplicated "Not sent" line, and the sentence now reads "Sent to … when you use AI:".

### UX: "Test" became "Connect": test, save and turn on AI in one step
**Problem** After pasting a key and pressing Test, the page said the key worked, but AI was not actually on: the student still had to scroll down, press Save, and then meet a dialog. It looked finished and wasn't.
**Change** The button is now **Connect**. A working key is saved on the spot and the one-time "Turn on AI?" dialog opens right away; saying yes turns AI on and shows "✓ Connected. AI is on (Groq)." (and reads an already-uploaded resume). "Not now" keeps the key and says how to turn AI on later. A bad key or a denied host permission saves nothing. Save Settings still works for the other fields.

### Copy: "résumé" is now "resume" everywhere users read it
UI text, prompts, README, changelog and tests. The one exception is a heading detector in `utils/resume.js` that still recognises a résumé headed "Résumé", since real documents use the accent.

### UI: spacing and truncation polish (from real screenshots)
- The resume status box no longer touches the paste card; the "Read profile & write draft" button no longer touches the paste fallback (a `:last-of-type` rule had zeroed its margin); more air above "What I found about you".
- Schools, Employers and Skills are now small auto-wrapping boxes instead of single lines that cut the text off.
- The upload hint used to say "read on this device only", which is wrong in AI Mode; it now says what happens in each mode. The paste fallback is labelled "Prefer to paste your resume text?".
- Settings intro no longer says you "see exactly what is sent first" (that now happens once, when AI is turned on; "What's sent?" is always available).

### Fix: harmless pdf.js warning in chrome://extensions "Errors"
**What** `UnknownErrorException: Ensure that the standardFontDataUrl API parameter is provided` is a pdf.js *warning* for PDFs whose fonts are not embedded. It only matters for drawing glyphs; we only read text, so extraction was never affected. **Fix** pdf.js is told to log errors only (`verbosity: 0`), so real failures still surface and this one no longer clutters the Errors page.

### Fix: "3 AI drafts didn't pass the length/safety checks" (real Groq run)
**Problem** Llama wrote all three drafts over the 200-character note limit, our checker rejected them, and the student silently got free drafts; the same warning also showed twice on screen.
**Fix** (1) The prompt now says to count characters and aim for ~85% of the limit. (2) Drafts that fail get **one repair pass**: the model is shown each failed draft and exactly why it failed (e.g. "too long (240/200)") and rewrites it. (3) If something still can't be used, free drafts fill only those spots and the warning names the reason, e.g. "(too long)". (4) The warning is shown once, in the draft card, not also in the top status line.
**Tests** Repair succeeds (2 calls, 3 AI drafts, no warning); repair fails (only 1 retry, free fill, reason shown); 128 total.

### Quality: AI drafts greet by first name, shorter, plainer (from a real Groq draft)
The first working Groq draft was 198/200 characters, skipped the recipient's name (the checklist flagged it) and used stiff phrasing ("spare a short reply", "recent AI/ML internship experience"). The request now carries `recipient_first_name` and a `target_chars` (80% of the limit); the prompt requires "Hi <first name>," and plain, natural wording with one ordinary question; and if a model still skips the greeting it is added when it fits the limit.

### Quality: stop Llama hitting 200/200 and inventing "currently interning"
A real Groq draft was exactly 200/200 and claimed the sender was "currently interning there" (not in the data); two of three drafts were still too long. Models cannot count characters, so the model is now told a limit with a safety margin (176 for a note, 440 for a message) while our check still enforces the true limit (a draft between the two is accepted). The prompt also forbids adding "currently", "recent", "experienced" or any date, role or place that is not written in the sender data.

### Quality: stray "JANGALA" sign-off, wrong ask for the purpose, project glued to a school (real Groq draft)
- A connection note must have no sign-off, but Llama appended the surname in capitals. A trailing line that is only the sender's name (or "Thanks, <name>") is now removed from notes; messages keep their sign-off.
- With purpose "Job Opportunity" the ask was a generic chat. The prompt now spells out the right ask for each purpose (Networking, Job, Referral, Collaboration).
- "built an AI report-generation PWA *there*" tied a project to a school. The prompt now says to use the intro as written, add at most one project or role, and never pair it with a school or employer unless the data does.

### UX: Review Mode shows one next step at a time
**Problem** Review Mode showed a three-row progress table, two buttons ("Read & Find Common Ground" and a greyed "Write Draft") and a message telling you to "Hit Generate Message", a button that doesn't exist. Users didn't know what to press.
**Change** A single line says "Step 1 of 2: Read this profile and see what you have in common" with one button, **Read this profile**. When it finishes, the button becomes **Write my draft** and the line says "Step 2 of 2: check what I found, then write your draft", with a small "Read the page again" link. The hooks box is titled "What I found you can mention", and a scraped "Skills (23)" heading is no longer shown as a skill.

**Also** My Free/AI header buttons reused the `.mode-btn` class of the Quick/Review buttons, so one restyled the other; the header buttons now have their own class (`aiswitch-btn`) and Quick/Review go back to their intended look.

### UI: Settings redesigned from one long form into three calm cards
**Problem** Settings had grown into a profile page: key, name, bio, upload, then a dozen resume fields and a long privacy note, all open at once.
**Change**
1. **AI writing (optional)**: provider, key and Connect. Open until a key is saved, then it folds to one line ("On · Groq").
2. **About you**: name, short bio, resume upload (with paste as a fallback).
3. **Your profile**: folded to one summary line ("2 schools · 2 employers · 20 skills · Chennai"). Opening it shows only the essentials (intro, city, skills, education, experience, projects); schools/employers lists, certifications and languages sit in a second fold, "Matching lists and extras". It opens by itself right after a resume is read so you can check it.
- "What leaves your device" is a fold-away card (and opens when you tap "What's sent?" with no profile). **Save settings** stays pinned at the bottom while you scroll. Copy is shorter throughout. All field ids are unchanged.

### UI: "About you" folds like the other Settings cards
It is open until you have a name and a resume, then folds to a one-line summary ("Asha Menon · resume added") that stays current as you type or upload. The "add your resume" tip opens it so the upload box is reachable.

### Fix: "2 AI drafts couldn't be used (too long)" kept appearing
Llama still overran 200 characters by a sentence even with a margin and a repair pass. Now a draft that is only slightly over is shortened locally by dropping whole sentences from the middle (the greeting/hook and the final ask stay). Nothing is reworded or added, so it cannot introduce a new claim, and no extra API call is spent. If a draft still can't fit, the repair pass and free-draft fallback apply as before.

### Feature: "New connection" vs "Already connected", chosen for you when LinkedIn says so
**Problem** The only hint that the second format was for existing connections was a small tip, and its button just said "Message".
**Change**
- The two options are now **New connection (note · 200)** and **Already connected (message)**, each with a plain one-line explanation underneath.
- The extension reads LinkedIn's 1st / 2nd / 3rd badge from the top card. A 1st-degree connection switches to *Already connected* automatically (and says so); anyone else uses *New connection*. If you pick a format yourself, we stop choosing for you. If the badge can't be read, nothing changes.
- Drafts for an already-connected person never ask to connect (free composer for every purpose, and the AI prompt now says so explicitly), and they keep the longer layout with an easy out and a sign-off.
**Tests** Badge parsing, auto-selection and manual override, labels, and a sweep proving no "connect" ask in message drafts; 137 total. **Unverified live**: the badge markup on a real profile (the parser is deliberately strict and falls back to your own choice).

### Detection: connected or not is now read from several signals and explained
The first version relied on the "· 1st" badge alone. It now combines: the badge (including the hidden "1st degree connection" label), a **Connect** / "Invite … to connect" / **Pending** button (= not connected), and a "Remove connection" item (= connected). A lone **Message** button is deliberately *not* treated as proof (Premium and open profiles can message anyone). The result is `isConnection: true | false | null`.
**What you see** The format switches by itself and a line under the buttons says why ("You are already connected, so I chose Already connected" / "You are not connected yet (2nd degree), so I chose New connection" / "I couldn't tell if you are connected. Choose the right option above."). The page's answer beats an old saved preference; choosing a format yourself stops auto-selection. Pasted profile text carries no signal, so nothing is chosen for you there.
**Tests** Pure rules, a DOM test on realistic top-card markup (badge, hidden label, Connect button, unknown), and the popup behaviour; 139 total. **Unverified live**: LinkedIn's real markup for these buttons and badges.

### Fix: connection status was only checked after you pressed "Read profile & write draft"
**Problem** (screenshot of a 1st-degree profile) The format stayed on "New connection" because detection only ran as part of the full read. Nothing looked at the page until the button was pressed.
**Fix** As soon as a `/in/` profile is open (and each time you move to another person) the panel asks the background worker to run one small function in the page that returns only the top card's lines and button labels; the same pure rules decide connected / not connected, retrying for a few seconds while LinkedIn finishes drawing the page. The format and the explanation line update by themselves, an earlier clear reading is not undone by a later "can't tell", a saved preference does not override it, and a format you chose yourself is never touched. Moving to a new person clears the previous person's reading first.
**Checked in real Chrome** with markup shaped like your screenshot ("He/Him · 1st" with non-breaking spaces → connected; a Connect button and no badge → not connected). **Privacy note** This is a small, deliberate change to "nothing runs until you click": it reads a few short strings from the top card, keeps them on the device, and nothing is stored or sent. README updated.
**Also** The first version of this had a swallowed error (wrong global name); a test now covers the real path. 142 tests.

### Fix: "I see you both work with Python" (who is "both"?)
**Cause** The AI was given the UI wording of each shared point ("You both work with Python", written for the person reading the chips) and copied it into a message that the sender sends, where "you both" means nothing. **Fix** The AI now receives the sentence already in the sender's own voice ("I noticed we both work with Python."), the prompt says to write as the sender ("I" = sender, "you" = recipient, "we both" for shared things, never "you both"), and any "you both" that still slips through is turned into "we both". The free composer already used "we".

### Polish: names are cased properly and used in full
- **Casing** Resumes often shout ("JANGALA SAKETH"). A name that is ALL CAPS or all lower-case is now Title Cased (hyphens and apostrophes handled: *Mary-Ann O'Neil*); a name already in mixed case is never touched. This happens when a resume is read (on device and by AI), and again when a draft is made, so an old saved name is fixed too. School, employer and job-title text is fixed only when the whole line is shouting *and* no real word is short enough to be an acronym: *VELLORE INSTITUTE OF TECHNOLOGY CHENNAI* becomes *Vellore Institute of Technology Chennai*, while *IIT MADRAS* and *SRI CHAITANYA COLLEGE* are left alone.
- **Full name** The AI now gets `sender_full_name` (not just a first word, which for a surname-first resume was the surname: the "JANGALA" sign-off). A message signs off with the full name, and if the model signs with only part of it, it is completed. The free drafts already signed with the whole name and now use the cleaned-up one.
**Tests** Name and label rules, AI sign-off completion, free sign-off, popup fill; 146 total.

### Feature/fix: the profile picture is now read and shown
**Problem** The profile card always showed a letter in a coloured circle; the picture was never read.
**Change** The page reader now finds the member's own photo in the profile's main area: an image from LinkedIn's CDN whose URL says it is a profile photo, preferring one whose alt text is their name and the largest one. It skips the banner, company logos, the small mutual-connection faces and your own navigation avatar. The panel shows it in the card (the initial stays underneath and wins if the image cannot load). Only `https://*.licdn.com/` images are ever used (checked again in the panel), the image is loaded with no referrer, and the URL is display-only: it is not stored, not part of any prompt, and the AI never sees it.
**Tests** Picker rules (banner, logo, tiny face, foreign host, http), a DOM test on a realistic top card, and the panel (initial first, photo fades in, foreign host ignored); 149 total. **Unverified live**: that LinkedIn's real markup exposes the photo this way (the fallback is the initial, so nothing breaks if not).

## Slice A: Project Spotlight (resume-aware relevance, step 1 of 4)
Idea taken from an LLM brainstorm, scoped to what fits this product: instead of mentioning the whole resume, pick the **one** project or role most relevant to the person you are viewing, and keep the evidence.
**What** New pure module `utils/spotlight.js`: `spotlight(sender, recipient)` scores each project/role in your profile against the recipient's headline, about, skills, title and posts. Skill matches are alias-aware (reusing `Overlap.skillKey`: ML ≈ machine learning) and weigh 3; shared domain words weigh 1 (generic words like "built", "app", "intern" can never match). It needs real evidence (3 points or 2 distinct matches) and otherwise returns `null`: no forced weak links. An employer already used as the hook is not repeated, and a project edges out an equal role. It can only *select* something already in your profile; its text is assembled from your own words.
**Tests** Different picks for an ML vs a backend recipient from one resume, `null` for unrelated people, no invented words, aliases, hook de-duplication, determinism and odd-data safety.
