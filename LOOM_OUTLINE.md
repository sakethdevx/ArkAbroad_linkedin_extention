# Loom outline (5 min) + pre-record checklist

Source of truth for details: `CHANGELOG.md`. Tip: demo on **your own** profile (or a friend who agrees), not a stranger's.

## Script

| Time | Say | Show |
|---|---|---|
| 0:00 | **The problem.** "This extension drafts LinkedIn messages, but for a student with no API key it gave one fixed template, ignored the résumé they uploaded, and the popup died when you clicked the page. I audited it, found those plus a parser bug, and made four changes." | Base `v3.1.0` for 5 s: same text twice on *Regenerate*. |
| 0:30 | **#3 Trustworthy reading** (why first: everything depends on it). "Titles like *Marketing* Intern or *Junior* Developer were thrown away: the parser treated any word containing `mar`/`jun`/`dec` as a date." | A profile with such a title → **What I read** card (✓ Read well), edit a field. Then a sparse/non-profile page → amber *Barely read* + **paste profile text** fallback. |
| 1:30 | **#1 Résumé → common ground.** "The upload finally does something, and the PDF never leaves your device." | Settings → upload PDF → the **What I found about you** card (editable). Open a profile → chips *School · … / Employer · … / Skills · …*. Untick one → draft changes. |
| 2:45 | **#2 Free drafts that fit LinkedIn.** "90% of students have no key, so free has to be good." | **Connection note 200** → 3 drafts, counter, **reply-ready checklist**; type past 200 → red; *New drafts* gives new text. Switch to **Message**. |
| 3:45 | **#4 Side panel + privacy.** "A popup closes when you click the page; a panel doesn't. And the tool says what it does with your data." | Click icon / Alt+Shift+O; browse; navigate → old draft clears. Add a key → **consent dialog with the exact payload**; *Use a free draft*. (Optional 10 s: profile text saying "ignore previous instructions" → amber notice.) |
| 4:30 | **How + judgment.** "No build step, 79 tests incl. the real background in a sandbox; permissions cut to storage/scripting/sidePanel; I cut insert-into-LinkedIn (it's automation LinkedIn prohibits) and on-device Gemini Nano (22 GB / 16 GB RAM, so not for most students). Next: a live Claude pass, reminders to follow up." | `CHANGELOG.md` + the permission list in `chrome://extensions`. |

## Pre-record checklist (real Chrome: do this once; nothing below was possible to run in my build environment)
- [ ] `chrome://extensions` → Developer mode → Load unpacked → no errors on the extension card; service worker console clean.
- [ ] Toolbar icon opens the side panel; **Alt+Shift+O** works (set in `chrome://extensions/shortcuts` if it's taken).
- [ ] On **3 real profiles** (yours + 2 with different layouts, incl. one with several roles at one company): the *What I read* card is right. If a field is wrong, note which; paste fallback must still work.
- [ ] Upload a **real text-based résumé PDF**: card fills, chips appear on a matching profile. Try a scanned PDF → friendly paste fallback.
- [ ] Free drafts: note ≤ 200 always; copy → paste into LinkedIn's note box; you send it by hand.
- [ ] **Claude path (never exercised live while building):** Settings → paste your key → *Test* → *Save* → generate → consent dialog → *Send*: 3 drafts, source badge says "Written by Claude". Try a bad key → friendly message + free drafts.
- [ ] `chrome://extensions` details show only: *Read and change your data on www.linkedin.com and api.anthropic.com*.
- [ ] Reload the extension, open a LinkedIn tab that was already open before install → still reads (on-demand injection).
- [ ] If `in.linkedin.com` (country subdomain) redirects don't happen for you: the extension only has access to `www.linkedin.com` (documented limit).
