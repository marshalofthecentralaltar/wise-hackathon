# Update the "Report to pull request" page with what the on-call engineer said

Hours left until the demo: ___
(Ralf gave 19 hours at 15:49 UTC on 2026-11-13, which puts the demo near 10:50 UTC on 14 November. Fill in the real figure.)
Plan approved by Ralf: ___ (yes or no)
Built so far: ___ (nothing, or what exists)

## Task

We are at the Wise hackathon in Tallinn, theme "Max Ease". The team's idea is a tool that reads customer reports in Slack, groups the ones about the same small problem, finds the owning team and the recent change behind it, opens a pull request with a fix, and gives support one sentence for the customers.

The plan for the demo is published as a page: https://claude.ai/artifact/1RLZu4U3H6gxsN4VvcCWTF. After it was published, the team talked to a Wise engineer who takes on-call shifts. Your job is to update that page, at the same link, so it carries what he said. The three teammates build from this page and show it to Wise mentors, so a wrong line on it costs build hours.

Change the page. Write no product code.

## Read these completely before doing anything

- `C:\Users\ralfs\wise hackathon\pages\report-to-pull-request.html`: the page source. Nine sections, a nine-step run, a three-minute script, a 19-hour build table.
- `C:\Users\ralfs\wise hackathon\oncall-engineer-transcript.md`: the on-call conversation, in Estonian, raw speech-to-text with no speaker labels. Quote from this file, never from memory.
- `C:\Users\ralfs\wise hackathon\wise.md`: read "Decisions", "Mentor notes" (the last entry is the English digest of the on-call conversation), "Published pages" and "Build kickoff checks".
- `C:\Users\ralfs\wise hackathon\mentor-conversation-transcript.md`: the earlier conversation with two Wise engineers, for the quotes already used on the page.

Read the published artifact with the Artifact tool before publishing to it, and pass its link as `url` so the address stays the same.

## The changes, each one named

1. **Add a section "What Wise engineers told us"**, placed before "Not proven yet". Three short entries, one per conversation, each with one quote and what it supports. For the on-call engineer use his words on problems with no alert, in Estonian with an English translation under them: "Ma ise arvan, et see on see" and "mitte iga alert tuleb monitooringust. Suht palju võibki olla nii, et me ei näe … aga customerid kirjutavad". State that "suht palju" (fairly often) is a frequency word and that nobody has given a number.
2. **Step 5, finding the change, searches several repositories.** His first answer on what to automate was the latest releases, "ma ei pea käsitsi GitHubi minema ja igast repast vaatama", and working out which service is involved, because Wise has thousands. Split the card app into two or three repositories in the plan and have the tool look for the recent change across all of them. Update the step, the parts table and the build table. The other session estimated about one hour of work; mark that as a guess.
3. **Step 8, the Slack post, gains one line:** "This change can be undone cleanly", shown only after the tool has done a trial revert that applies without conflict. Say beside it that the tool never rolls a change back by itself. His view: a button is fine, doing it automatically "may be dangerous".
4. **The pitch script gains his reason the gap exists.** The gradual rollout checks a small share of traffic ("5% of traffic is so little"), so a problem in a low-volume flow passes it. Put this in the 1:10 to 2:05 row.
5. **Add a section "What this tool leaves alone".** The alert-driven on-call flow (the robot call, the dashboard, paging another team, the postmortem) is out of scope. incident.io, PagerDuty and Rootly sell the release lookup for alerts, and incident.io and Rootly say they draft the postmortem from the Slack channel. When the team told him "our idea is to automate the whole flow" his answer was lukewarm. The page must not widen into it.
6. **Add a section "Who it helps, how many, how much time"**, after the step-by-step run. Carry over the three rows and the sum from the earlier page (`pages\which-change-broke-it.html`): customers, support agents, the development team, each with its count and time, each input tagged measured or guess. Add a fourth row for the on-call engineer who today opens each repository by hand; his time saved has not been asked, so show the question in that cell.
7. **"What we drop first if we fall behind"**: the search across several repositories goes to the top of the list.
8. **"Not proven yet"**: in the Size row add his "fairly often", and add the question to put to him: "Millal sa viimati said veast teada kliendi kaudu, mitte monitooringust, ja kui kaua läks esimesest kliendi kirjast sinuni?"
9. **The status line and the clock.** Replace "19 hours left", "Nothing is built yet" and "Ralf has not approved it" with what the three blanks at the top of this prompt say, each with its time.

## Limits

- Edit the existing page. Keep its design, its sections and its order apart from the additions above. A full rebuild is out of scope.
- Every number carries its source and the word measured or guess. A quote is copied from the transcript file character for character. Who said which sentence is inferred, and the page says so once.
- Invent no figure. Where a number is missing, show the question that would get it.
- Use the `plain-product-copy` skill for every sentence: plain statements, headings that name their content, no slogans.
- The page keeps saying what is planned and what is built. A plan step is never written as if it ran.
- The idea, the small-problem target and the ending on a pull request are decided. Leave them as they are.

## Check and publish

1. Run the copy check from `plain-product-copy` on the visible text.
2. Check that the build table still adds up to the hours left and that the sleep block survives.
3. Publish to the same link. Save the published source back to `pages\report-to-pull-request.html`.
4. Add one line to `wise.md` under "Published pages" with the date, the version and what changed.

## Report

Reply in chat, under 150 words:

1. The link, first.
2. The nine changes, one line each: done, or not done with the reason.
3. Anything on the page that is still a guess.
4. The one question for the on-call engineer, ready to read out.

Then stop. Do not start building.
