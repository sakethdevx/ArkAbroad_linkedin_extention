# LinkedIn Outreach AI

Draft a short, specific LinkedIn message for the person whose profile you're looking at. **You read it, edit it and send it yourself.** Nothing is ever sent or clicked for you.

Works **free, on your device**, with no account and no API key. Optionally add your own key and flip the **Free ⇄ AI** switch in the top bar so an AI writes the drafts instead: **Anthropic (Claude)** or **Groq (Llama, which has a free plan with usage limits)**.

## Install (unpacked, no build step)
1. `chrome://extensions` → turn on **Developer mode** → **Load unpacked** → choose this folder.
2. Click the toolbar icon (or press **Alt+Shift+O**) to open the side panel. It stays open while you browse.
3. Open someone's LinkedIn profile → **Read profile & write draft**.

Needs Chrome 116 or newer (side panel).

## What it does
- **Reads the profile you're on** (only when you click), shows you *what it read* and lets you fix it. If the page can't be read, paste the profile text instead.
- **Uses your resume** (optional PDF, read on your device) to find what you two have in common: shared school, employer, skills, city. In AI Mode the AI also fills in your whole profile (education, experience, projects, skills) from it, so you don't type anything.
- **Writes 3 drafts** that open with that shared ground, say who you are in one line and make one small ask. Pick **Connection note** (≤ 200 characters, LinkedIn's limit) or **Message**.
- **Checks the draft** as you edit: specific? one ask? fits? no stock phrases?

## What leaves your device
| Mode | What is sent | Where |
|---|---|---|
| **Free** (no key) | Nothing | n/a |
| **AI** (your own key, switch on) | A short, cleaned-up summary of the profile + your profile details. You say yes **once** when you turn AI on, and "What's sent?" always shows the exact data | only the provider you chose: `api.anthropic.com` **or** `api.groq.com` |
| **AI**, resume upload | The resume **text** (emails/phones already removed) so the AI can fill in your profile | the same provider |
| Always | Never: your resume PDF, emails, phone numbers, your key (header only), or anything else on the page | n/a |

- Stored locally (`chrome.storage.local`): your key (if you add one), name/bio, resume **text** (contact details removed; the PDF is not kept), your edited "about you" info, recent drafts.
- Profile, pasted and resume text are treated as **untrusted input**: invisible characters are stripped, fields are length-capped and whitelisted, text that tries to instruct an AI is flagged and dropped, and model output is checked before you see it.
- Permissions: `storage`, `scripting`, `sidePanel`; hosts `linkedin.com` and `api.anthropic.com`. `api.groq.com` is an **optional** permission that Chrome asks for only if you choose Groq. The page script is injected only when you click; nothing runs on LinkedIn otherwise.

## About LinkedIn's rules
LinkedIn's help centre says it does not permit browser extensions that scrape or automate activity on its site. This tool only reads the page you are looking at, on your click, never navigates, clicks, types or sends, and offers a **paste-text mode that needs no page access at all**. Using any extension on LinkedIn is your call and your account's risk; please read LinkedIn's terms.

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

## Known limits
- LinkedIn changes its markup often. The reader is tested on fixtures, not every live layout, hence the "What I read" check and the paste fallback.
- Resume parsing is heuristic; the extracted info is editable and that edited copy is what's used.
- Scanned (image-only) PDFs have no text; paste the resume text instead.
