# LinkedIn Outreach AI

Draft a short, specific LinkedIn message for the person whose profile you're looking at. **You read it, edit it and send it yourself.** Nothing is ever sent or clicked for you.

Works **free, on your device**, with no account and no API key. On a capable computer, Chrome's own built-in AI can polish your free drafts (**on-device AI**, optional). Optionally add your own key and flip the **Free ⇄ AI** switch in the top bar so an AI writes the drafts instead: **Anthropic (Claude)** or **Groq (Llama, which has a free plan with usage limits)**.

## Install (unpacked, no build step)
1. `chrome://extensions` → turn on **Developer mode** → **Load unpacked** → choose this folder.
2. Click the toolbar icon (or press **Alt+Shift+O**) to open the side panel. It stays open while you browse.
3. Open someone's LinkedIn profile → **Read profile & write draft**.

Needs Chrome 116 or newer (side panel).

## What it does
- **Picks the right format** by itself: it notices whether you are already connected (the 1st-degree badge, or a Connect / Pending button) and selects *Already connected* or *New connection*, telling you which and why.
- **Reads the profile you're on** (the full read only when you click), shows you *what it read* and lets you fix it. If the page can't be read, paste the profile text instead.
- **Uses your resume** (optional PDF, read on your device) to find what you two have in common: shared school, employer, skills, city. In AI Mode the AI also fills in your whole profile (education, experience, projects, skills) from it, so you don't type anything.
- **Picks your most relevant work** for each person (the one project or role that matches their field, with the matching words shown) and explains every draft ("Built on: …"). You can leave it out with one tap. Nothing is invented: it only selects something already in your profile, and it says nothing rather than force a weak link.
- **Writes in their language.** If their profile is in German, Spanish, French… a "Write in another language" box translates your draft on your device and shows what it says back in English, so you can check it before sending.
- **Writes 3 drafts** that open with that shared ground, say who you are in one line and make one small ask. Pick **Connection note** (≤ 200 characters, LinkedIn's limit) or **Message**.
- **Checks the draft** as you edit: specific? one ask? fits? no stock phrases?

## What leaves your device
| Mode | What is sent | Where |
|---|---|---|
| **Free** (no key) | Nothing | n/a |
| **AI** (your own key, switch on) | A short, cleaned-up summary of the profile + a short summary of you (intro, skills, schools, employers, goal) + the **one** project or role picked for this person. Your other projects and roles stay on your device. You say yes **once** when you turn AI on, and "What's sent?" always shows the exact data | only the provider you chose: `api.anthropic.com` **or** `api.groq.com` |
| **AI**, resume upload | The resume **text** (emails/phones already removed) so the AI can fill in your profile | the same provider |
| **Free + on-device AI** | Nothing. Chrome downloads its AI model once (a large one-time download done by Chrome, not by this extension) and runs it on your computer; translation works the same way | n/a |
| Always | Never: your resume PDF, emails, phone numbers, your key (header only), or anything else on the page | n/a |

- The profile card shows the person's photo, loaded from LinkedIn's own image servers (`*.licdn.com`, https only) exactly as the page does. The photo is never stored, never sent to an AI, and never leaves the panel.
- Stored locally (`chrome.storage.local`): your key (if you add one), name/bio, resume **text** (contact details removed; the PDF is not kept), your edited "about you" info, recent drafts.
- Profile, pasted and resume text are treated as **untrusted input**: invisible characters are stripped, fields are length-capped and whitelisted, text that tries to instruct an AI is flagged and dropped, and model output is checked before you see it.
- Permissions: `storage`, `scripting`, `sidePanel`; hosts `linkedin.com` and `api.anthropic.com`. `api.groq.com` is an **optional** permission that Chrome asks for only if you choose Groq. The full page reader is injected only when you click. On a profile, the panel also runs one tiny function that reads just the top card's connection badge and button labels (a few short strings, kept on your device, never stored or sent) so it can pre-select "New connection" or "Already connected"; The one declared content script is a small on-page helper (`utils/notefill.js` and `utils/pagecomposer.js`, matching `https://www.linkedin.com/*` only). LinkedIn is a single-page app, so it is present on every LinkedIn page but **inert except on profile pages (`/in/…`)**, where it only waits for LinkedIn's note box to open. When one opens it reads that profile on your device (through the background worker, the same read as the panel's), shows free drafts made on your device with goal and tone choices, and types a draft into the box when you press **Use this draft**. The card uses the best engine you have switched on: in **AI Mode** it asks your own AI provider directly when the box opens (the same short summary the panel sends, which you already approved when you turned AI on); in Free Mode with **On-device AI** on, Chrome's built-in model polishes the free drafts on your computer (if Chrome offers it to LinkedIn pages; otherwise you simply see the free drafts); otherwise free drafts made on your device. A "Free drafts instead" button on the card turns the smart engine off for that box. Choose how much it does in Settings → On the LinkedIn page (Smart composer, Fill button only, or Off). The full page reader is still injected only when you ask.

## About LinkedIn's rules
LinkedIn's help centre says it does not permit browser extensions that scrape or automate activity on its site. This tool reads the page you are looking at, on your click. It does two small things on the page, and only when you ask: **Copy & open** clicks LinkedIn's own Message (or Connect → Add a note) button to open the box, and **Fill with my draft** types your draft into that box. It **never presses Send** (or anything else; tests check this), never navigates, and offers a **paste-text mode that needs no page access at all**. Using any extension on LinkedIn is your call and your account's risk; please read LinkedIn's terms.

## Tests
```
node test/run.js                      # pure modules + real background.js in a sandbox
NODE_PATH=/path/to/node_modules node test/run.js   # also runs DOM/HTML tests if jsdom is installed
```
No dependencies are needed to run the extension or the core tests.

## Layout
```
manifest.json  background.js  content_script.js  popup.html/js/css   (popup.html is also the side panel)
utils/  profile_parse.js  resume.js  overlap.js  compose.js  safety.js  cache.js
lib/    pdf.js (Apache-2.0), vendored
test/   unit, sandbox, DOM and accessibility tests
CHANGELOG.md   what changed and why (base: tag base-v3.1.0)
```

## On-device AI and translation: requirements
Built-in AI needs desktop Chrome 138+, about 22 GB free disk and 16 GB of memory or a graphics card with 4 GB+. Where a computer doesn't qualify, Settings says so and nothing else changes. Translation depends on Chrome supporting the language pair. Both ask for a click before the first download.

## Known limits
- On-device AI and translation were built against Chrome's documented APIs and tested with stand-ins; they have not been run on real Gemini Nano in this repo's test environment.
- LinkedIn changes its markup often. The reader is tested on fixtures, not every live layout, hence the "What I read" check and the paste fallback.
- Resume parsing is heuristic; the extracted info is editable and that edited copy is what's used.
- Scanned (image-only) PDFs have no text; paste the resume text instead.
