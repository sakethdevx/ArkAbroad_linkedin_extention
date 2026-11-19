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
