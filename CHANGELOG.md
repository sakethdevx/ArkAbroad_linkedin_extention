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
