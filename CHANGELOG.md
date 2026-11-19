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
