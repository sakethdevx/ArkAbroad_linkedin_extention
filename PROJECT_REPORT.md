# LinkedIn Outreach AI — Base Version Report (As Provided)

Analysis of the base version as provided by Ark Abroad, **before** any of our changes (v3.1.0).
Purpose: reference for the Ark Abroad assignment (improve the extension, record a Loom walkthrough, due 22 Nov 2026, 5:00 PM IST).

---

## 1. What it is

A Manifest V3 Chrome extension. The user opens a LinkedIn profile (`linkedin.com/in/...`), clicks a button, and the extension:

1. Scrapes the visible profile data from the page,
2. Builds a short list of "personalisation hooks",
3. Writes an outreach message (networking, job, referral, collaboration) in a chosen tone,
4. Shows it in an editable box to copy, and saves it to a "Recent" list.

It runs entirely in the browser. There is no company server and no licence key (removed in the updated assignment build).

## 2. Target users (inferred, not stated in code)

- Job seekers, students and early-career professionals doing cold outreach on LinkedIn. Three of the four message types (Job, Referral, Networking) are what juniors send to strangers.
- Given the company name (Ark Abroad), probably people looking to study or work abroad, messaging alumni, employees and recruiters. **This part is a guess; confirm with the company.**
- Not built for sales or recruiter bulk outreach (no bulk queue, CRM, or sequences; history is capped at 5).
- Product tension: the target user is likely non-technical, but the best mode (AI) needs the user's own Anthropic API key.

## 3. File structure

```
manifest.json        Extension config, permissions, entry points
background.js       Service worker: scraping relay, message generation, Claude API call
content_script.js   Runs on linkedin.com: scrolls page and scrapes profile
popup.html          Popup UI markup (3 tabs)
popup.js            Popup logic and state
popup.css           Popup styling (~21 KB)
utils/cache.js      "Recent contacts" storage helper (last 5)
icons/              icon16.png, icon48.png, icon128.png
```

## 4. Manifest ([manifest.json](manifest.json))

| Item | Value |
|---|---|
| Name / version | LinkedIn Outreach AI / 3.1.0 |
| Permissions | `activeTab`, `storage`, `tabs`, `scripting` |
| Host permissions | `https://www.linkedin.com/*`, `https://api.anthropic.com/*` |
| Background | service worker `background.js` |
| Popup | `popup.html` |
| Content script | `content_script.js` on `https://www.linkedin.com/*`, `run_at: document_idle` |

## 5. How the pieces connect (data flow)

```
Popup (popup.js)
   │  sendMessage({action:'scrapeProfile'})
   ▼
Background (background.js)  ── chrome.tabs.sendMessage ──►  Content script
   │                                                         scrolls page, scrapes DOM
   │  ◄──────────────── profile JSON ───────────────────────┘
   │  normalizeProfile() → buildHooks()
   │      ├─ no API key  → localMessage()   (template)
   │      └─ has API key → aiMessage() → callClaude() → api.anthropic.com
   ▼
Popup shows message → editable textarea → Copy / Regenerate
   └─ saves to Recent (chrome.storage.local via utils/cache.js)
```

If the content script isn't loaded in the tab (e.g. tab opened before install), the background injects it with `chrome.scripting.executeScript` and retries ([background.js:62-67](background.js#L62-L67)).

## 6. UI ([popup.html](popup.html))

Header: "Outreach AI" plus a status pill: **● Free Mode** or **● AI Mode**.

### 6.1 Tab: CURRENT
- **Warning banner** if the active tab is not a LinkedIn profile (`/in/...`); scrape buttons are disabled in that case.
- **Profile card**: avatar initial, name, headline, company (shown after scraping).
- **Message Type** dropdown: Networking, Job Opportunity, Referral Request, Collaboration.
- **Tone** dropdown: Formal, Neutral (default), Casual.
- **Mode toggle**:
  - **Quick Mode** ("Scrape & Generate"): one click does scrape + generate.
  - **Deep Mode** ("3-Layer AI"): shows a pipeline panel (L1, L2, L3 with status dots), a "Top hooks found" list, and two buttons: "Scrape + Enrich (L1 + L2)" then "Generate Message (L3)".
- **Status bar** for progress, success and error text.
- **Generated message area**: editable textarea, live character count, **Regenerate** and **Copy** buttons.

### 6.2 Tab: RECENT
- Last 5 contacts: name, headline/company, date, 110-char preview.
- Per card: "Show full message" toggle and "Copy".
- "Clear all" button; empty state when nothing saved.

### 6.3 Tab: SETTINGS
- **Anthropic API key** (optional, password field) with a **Test** button.
- **Your Name**, **Your Bio** (3-row textarea).
- **Resume (PDF)** upload (click or drag-drop, PDF only, max 4 MB).
- **Save Settings** button.
- Note: "Everything is stored locally on your device. No data is sent to any company server."

## 7. Scraping ([content_script.js](content_script.js))

Triggered by message `scrapeProfile`. First scrolls the page (to 800, 1600, 2400 px, then back to top, with waits) so LinkedIn's lazy-loaded sections render. Then `scrapeProfile()` extracts:

| Field | How it is found |
|---|---|
| name | first `<h1>`, fallback `document.title` |
| headline | leaf `<p>` in the section containing `<h1>` that has `\|`, `@`, `·` or a job-title keyword |
| location | leaf `<p>` in the same section that has a comma, under 60 chars, no `\|` or `@` |
| about | longest leaf text (>80 chars) in the "About" section |
| experience | leaf `<p>` in "Experience" section, grouped 3–4 lines per entry (title, company, dates, optional location). The first entry is treated as current |
| currentTitle / currentCompany | first experience entry, else parsed from headline (`X at Y`, `X \| Y`) |
| pastCompanies | companies of experience entries 2+ (max 4, unique) |
| skills | short leaf texts in "Skills" section, filtered for noise (max 10) |
| education | groups of 3 lines in "Education" (max 3) |
| recentPosts | 40–500 char leaf texts in "Activity" section (max 3) |
| profileUrl | `location.href` without query string |
| rawTitle | `document.title` |

All of this is heuristic DOM scraping (no stable selectors), so it depends on LinkedIn's current markup.

## 8. Message generation ([background.js](background.js))

### 8.1 Message router
Handled message types: `scrapeProfile`, `generateMessage` (Quick), `TEST_API_KEY`, `RUN_ENRICH` (Deep L1+L2), `RUN_GENERATE` (Deep L3), `SAVE_RECENT`, `GET_RECENT`. (`SAVE_RECENT`/`GET_RECENT` exist but the popup uses `utils/cache.js` directly.)

### 8.2 Profile normalisation
`normalizeProfile()` fills defaults and derives `firstName` (first word of name, else "there").

### 8.3 Hooks (`buildHooks`)
Up to 3 hook strings, in priority order:
1. Recent post (truncated to 90 chars)
2. "Works as {title} at {company}" (or "Currently at {company}")
3. "Skilled in" top 3 skills
4. "Previously at" up to 2 past companies
5. "Studied at" first education entry
6. Fallback: the headline

### 8.4 Free Mode: `localMessage()` (template)
- Greeting by tone: `Dear X,` / `Hi X,` / `Hey X!`; sign-off `Kind regards,` / `Best,` / `Cheers,`.
- Hook line: recent post, else top 2 skills, else generic "impressed by your work as {role}".
- Optional "A bit about me: {bio, 120 chars}".
- Ask line by message type (Networking, Job, Referral, Collaboration).
- Appends the user's name if set.
- No length limit, no randomness: same input gives the same message.

### 8.5 AI Mode: `aiMessage()` + `callClaude()`
- Used only if the user saved an API key.
- Model: `claude-haiku-5-5`, `max_tokens` 400, endpoint `https://api.anthropic.com/v1/messages` with header `anthropic-dangerous-direct-browser-access: true`.
- Prompt: short LinkedIn message (under 600 characters), purpose, tone, recipient JSON (name, headline, title, company, about trimmed to 400, recent posts, skills), hooks, sender name and bio. "Return only the message text."
- The resume is **not** included.

### 8.6 Deep Mode
- **L1 and L2 are not real AI calls.** `handleEnrich()` just runs `normalizeProfile` + `buildHooks` locally with a 300 ms artificial delay. `companyNews` is always `[]`.
- **L3** (`handleDeepGenerate`) reads name/bio from storage and uses AI or the template exactly like Quick Mode, with the hooks from "L2".
- Net effect: Deep Mode gives the same output as Quick Mode, just in two steps with a hooks preview.

## 9. Storage

All in `chrome.storage.local`:

| Key | Content |
|---|---|
| `userApiKey` | user's Anthropic key (plain text) |
| `userName`, `userBio` | sender details |
| `resumeBase64`, `resumeFileName` | uploaded resume PDF (stored, never used) |
| `recentContacts` | array of up to 5: `{profileUrl, name, headline, company, message, timestamp}`, deduplicated by profile URL |

## 10. API keys and privacy

- No hardcoded keys or secrets anywhere in the repo (checked).
- The user's key goes only to `api.anthropic.com` in the `x-api-key` header.
- In AI Mode, scraped profile data (name, headline, about, posts, skills) is sent to Anthropic. The UI does not tell the user this.
- The Settings note says "No data is sent to any company server", which is true, but the Anthropic call isn't mentioned.

## 11. Known issues and weaknesses

### Product / feature gaps
1. **Free Mode is a fixed template**: robotic, identical for identical inputs, no variety.
2. **Resume upload does nothing**: stored as base64, never read by the generator. UI implies it helps.
3. **Deep Mode is mostly cosmetic**: L1/L2 are local; UI labels them "OpenAI — Profile Parser / Web Enrichment" although the code uses Anthropic and nothing is called.
4. **No LinkedIn length awareness**: connection notes are limited to about 300 characters (200 on free accounts). The AI prompt allows 600 and the template has no limit. No warning shown.
5. **Copy only**: no way to insert the message into LinkedIn's message or connect box.
6. **No sender-recipient matching**: nothing connects the user's background to the recipient's (shared company, school, skills).
7. **History limited to 5** with no search or notes.
8. **The best mode needs a developer API key**, which a typical student won't have.

### Reliability
9. **Fragile scraping**: heuristics on `p`/`span` text (comma means location, groups of 3 lines mean an experience entry, keyword list for titles). Breaks easily when LinkedIn changes markup; non-English profiles and entries with multiple roles at one company will misparse. It also forcibly scrolls the user's page.
10. **`isCurrent` is just "first entry"**, which may be wrong.
11. **Resume validation** relies on `file.type` and size only.

### Code quality / UX polish
12. Leftover "license key" naming: function `checkLicenseStatus()`, CSS classes `license-key-*`, an empty `no-key-warning` alert in the HTML.
13. `response.remaining` in `handleDeepGenerate` refers to a removed quota system and never fires.
14. Duplicate persistence paths (`SAVE_RECENT`/`GET_RECENT` in background vs `Cache` in popup).
15. `handleScrapeAndGenerate` / `handleEnrich` have blank placeholder lines where a licence check used to be.
16. Deep Mode errors collapse to generic text; the popup's `Regenerate` button re-uses the Quick path logic.
17. Popup `<title>` says "LinkedIn Outreach Generator" while the manifest says "LinkedIn Outreach AI".
18. API key is stored in plain text in `chrome.storage.local` (normal for extensions, but worth noting).

## 12. Candidate improvements (for later decision)

Ranked by demo impact versus effort. Not yet chosen.

1. **Use the resume**: extract PDF text (pdf.js), summarise the sender's strengths, and find overlap with the recipient (shared employer, school, skills) for personalised messages. Fixes #2 and #6.
2. **Smarter, varied Free Mode**: multiple template variants and better hook selection, so non-technical users get good output without a key. Fixes #1 and #8.
3. **LinkedIn character-limit mode**: a 300-character connection-note mode, with a live counter and warning. Fixes #4.
4. **Honest Deep Mode**: rename the layers to what they do, or make them real. Fixes #3.
5. **Insert into LinkedIn**: a button that fills the message or connect box on the page. Fixes #5.
6. **More robust scraping**: more selector fallbacks plus a "profile data" editor so the user can fix wrong fields before generating. Fixes #9 and #10.
7. **Cleanup**: remove licence leftovers, dead code, and fix titles. Fixes #12–#17.
8. **Privacy disclosure** when AI Mode is on. Fixes #10 (section 10).

---
*Report generated from the code as of repo commit `3411985` ("Initial commit").*
