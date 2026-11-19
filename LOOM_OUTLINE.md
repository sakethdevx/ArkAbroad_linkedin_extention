# Loom outline (5 min) + pre-record checklist

Source of truth for details: `CHANGELOG.md`. Tip: demo on **your own** profile (or a friend who agrees), not a stranger's.

## Script

| Time | Say | Show |
|---|---|---|
| 0:00 | **The problem.** "This extension drafts LinkedIn messages, but for a student with no API key it gave one fixed template, ignored the resume they uploaded, and the popup died when you clicked the page. I audited it, found those plus a parser bug, and made four changes." | Base `v3.1.0` for 5 s: same text twice on *Regenerate*. |
| 0:30 | **#3 Trustworthy reading** (why first: everything depends on it). "Titles like *Marketing* Intern or *Junior* Developer were thrown away: the parser treated any word containing `mar`/`jun`/`dec` as a date." | A profile with such a title → **What I read** card (✓ Read well), edit a field. Then a sparse/non-profile page → amber *Barely read* + **paste profile text** fallback. |
| 1:30 | **#1 Resume → common ground.** "The upload finally does something, and the PDF never leaves your device." | Settings → upload PDF → the **What I found about you** card (editable). Open a profile → chips *School · … / Employer · … / Skills · …*. Untick one → draft changes. |
| 2:45 | **#2 Free drafts that fit LinkedIn.** "90% of students have no key, so free has to be good." | **Connection note 200** → 3 drafts, counter, **reply-ready checklist**; type past 200 → red; *New drafts* gives new text. Switch to **Message**. |
| 3:45 | **#4 Side panel + privacy.** "A popup closes when you click the page; a panel doesn't. And the tool says what it does with your data." | Click icon / Alt+Shift+O; browse; navigate → old draft clears. Add a key → **consent dialog with the exact payload**; *Use a free draft*. (Optional 10 s: profile text saying "ignore previous instructions" → amber notice.) |
| 4:30 | **How + judgment.** "No build step, 79 tests incl. the real background in a sandbox; permissions cut to storage/scripting/sidePanel; I cut insert-into-LinkedIn (it's automation LinkedIn prohibits) and on-device Gemini Nano (22 GB / 16 GB RAM, so not for most students). Next: a live Claude pass, reminders to follow up." | `CHANGELOG.md` + the permission list in `chrome://extensions`. |

## Pre-record checklist (real Chrome: do this once; nothing below was possible to run in my build environment)
- [ ] `chrome://extensions` → Developer mode → Load unpacked → no errors on the extension card; service worker console clean.
- [ ] Toolbar icon opens the side panel; **Alt+Shift+O** works (set in `chrome://extensions/shortcuts` if it's taken).
- [ ] On **3 real profiles** (yours + 2 with different layouts, incl. one with several roles at one company): the *What I read* card is right. If a field is wrong, note which; paste fallback must still work.
- [ ] Upload a **real text-based resume PDF**: card fills, chips appear on a matching profile. Try a scanned PDF → friendly paste fallback.
- [ ] Free drafts: note ≤ 200 always; copy → paste into LinkedIn's note box; you send it by hand.
- [ ] **Claude path (never exercised live while building):** Settings → paste your key → *Test* → *Save* → generate → consent dialog → *Send*: 3 drafts, source badge says "Written by Claude". Try a bad key → friendly message + free drafts.
- [ ] `chrome://extensions` details show only: *Read and change your data on www.linkedin.com and api.anthropic.com*.
- [ ] Reload the extension, open a LinkedIn tab that was already open before install → still reads (on-demand injection).
- [ ] If `in.linkedin.com` (country subdomain) redirects don't happen for you: the extension only has access to `www.linkedin.com` (documented limit).


## Addendum: resume-aware relevance (after the Groq and UX work)
Show: open an ML profile, then a backend profile, with the same resume. The "Why you two" card picks a different project each time and shows the matched words; tap the "Your work" chip to leave it out and watch the draft change; point at "Built on: …" under the draft. Say plainly: it only selects from your own resume, returns nothing rather than a weak link, and in AI Mode only that one item leaves the device.


## Addendum: on-device AI and writing in their language
Show (on a computer that qualifies): Settings → On-device AI → Turn on (one-time download). Then open a profile: the free draft appears instantly, a moment later the badge flips to "Written on your device" and the draft is polished, still with "Built on…". Then a German profile: the translate box opens by itself, press Translate, and point at the English check underneath. Say plainly: no key, nothing leaves the computer, and on computers that do not qualify the card says so and everything else is unchanged. Be honest that this was built against Chrome's documented API and tested with stand-ins.


## Addendum: tracker features (about 90 seconds)
1. **Recent knows who people are.** Click a name: their profile opens (handle stored, not just a name).
2. **Best next move.** One line above the drafts, rule-based (connected → just message; recent post → warm up first).
3. **Follow-up Coach.** Mark a message Sent; at day 4 it shows "Follow-up 1 of 2 is due", with an editable draft. Never more than two; "They replied" stops it.
4. **Copy & open.** Copies the draft and opens LinkedIn's message or note box. You press Send. It refuses to click anything else.
