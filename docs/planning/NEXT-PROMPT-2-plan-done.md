# Orient and plan the build: from a customer's report to a pull request

Hours left until the demo: ___
(The clock stood at about 17.5 hours when this was written, 2026-11-13 15:45 UTC. Fill in the real figure.)
Team: three people. Ralf builds with Claude Code.

## Task

We are at the Wise hackathon in Tallinn, theme "Max Ease". After four hours of research and three conversations with Wise engineers, the team has chosen its idea. This session turns the idea into a time-boxed plan for a live three-minute demo, waits for Ralf's go, then starts on the first build step.

The idea in one sentence: a tool that watches where customers report small problems, works out which service and team each problem belongs to and which recent change is the suspect, opens a pull request with a fix, and gives support one approved sentence for the customer.

Your first reply is the plan described under "First deliverable". Write no code before Ralf says go.

## Read these completely before doing anything

- `C:\Users\ralfs\wise hackathon\wise.md`: the running notes. Read "Decisions", "Theme and scoring", "Mentor notes" (four dated entries from 13 November) and "Published pages". The two "Problem search" sections record what was killed and why; skim them so you do not reopen it.
- `C:\Users\ralfs\wise hackathon\mentor-conversation-transcript.md`: the full conversation with two Wise engineers, with speaker labels and a "Facts stated" digest. This is the best primary source for what Wise's tooling looks like.
- `C:\Users\ralfs\wise hackathon\pages\which-change-broke-it.html`: source of the page that pictures the idea, published at https://claude.ai/artifact/17tUhuGJ5zemMV7FLKUUN8. It shows an older five-step flow that ends on a note to developers. It does not yet end on a pull request.

## Decided, do not reopen

- The idea above. Ralf: "after 4 hours we have an idea."
- It targets small problems that never get fixed. It does not target major incidents. A Wise engineer: "It wouldn't really help Sev ones", because dashboards and office screens already catch those.
- The journey ends on a pull request. The Wise engineer's own example is a card picture that flickers, which no monitoring can see.
- The demo is live. It may be recorded as a backup.
- Earlier candidates (phone calls you can read, parking, the doctor and patient interpreter and the rest) are closed.

## What the scoring sheet demands

- Friction removal, 40%. The top mark needs friction removed entirely from an everyday experience.
- Technical, 25%. A working end-to-end prototype on real services. Hardcoded shortcuts score 2 of 4, mock-ups score 1.
- Pitch, 25%. A live demo of the main journey. Leaning on slides scores 2.
- Creativity, 10%.
- AI use must be disclosed.

The Wise engineer advised faking the support and monitoring endpoints. He is not a judge, and the sheet punishes fakes. Prefer one tiny real system, broken on purpose, so every call in the demo is real.

## Proposed demo journey (Ralf has seen it, has not approved it)

1. A small web app we own, with a card page, in a real GitHub repository with a CODEOWNERS file. CODEOWNERS stands in for Wise's map from URL path to service to team.
2. We merge a change that makes the card image flicker. Real Prometheus and Grafana stay green, because monitoring cannot see it.
3. Three customers report it through a real Slack channel or a real support inbox.
4. The tool groups the reports, asks Prometheus whether anything shows, finds nothing, looks up the owner of that page, and finds the recent change to that path through the GitHub API.
5. It opens a fix as a pull request, tags the owner in Slack, and gives support one sentence for the customers.

## Not proven. Check each before building on it

1. Theme fit. This is a tool for support and developers, and the sheet says "everyday experience". The pitch has to open with the customer whose small bug finally gets fixed. Nobody has tested this framing on a judge.
2. Prior art. incident.io, PagerDuty and Rootly match incidents to recent changes, starting from monitoring alerts. Add-ons link support tickets to GitHub issues. No search has covered coding agents that turn an issue into a pull request. Search before claiming anything is new.
3. Size. The benefit sum on the page gives 400 customers and about 85 hours per bug, and four of its seven inputs are guesses. Three figures were asked of Wise people and not obtained: tickets per small bug, time from first ticket to a developer hearing of it, bugs per year that reach customers before monitoring.
4. Whether a Zendesk trial gives API access. Slack alone is the fallback.
5. Whether an automatic fix can be produced reliably inside a three-minute live demo. Plan a rehearsed fallback.
6. Wise's real support tooling. One engineer thinks Zendesk, the other recalls Twilio for phones. Neither was sure.

## First deliverable

Reply in chat, under 300 words plus one table.

1. One line: the journey you recommend for the demo, and any change to the proposal above with the reason.
2. A table of time boxes from now to the demo: what gets built, the command or screenshot that proves it works, who does it. Ralf will assign names; propose a split for three people.
3. Build the riskiest piece first. Propose a thin path from a Slack message to an opened pull request on a hello-world repository within the first two hours.
4. The cut line: what is dropped first if the team falls behind.
5. A final block with no new code: rehearsal, a recorded backup, and the pitch.
6. At most one question for Ralf, in plain words, with your recommendation and what happens if he does not answer.

Then stop and wait for go.

## How to work

- Run the tests that can kill a plan before recommending it. Say where it breaks, then narrow.
- Every number carries its source and the word measured or guessed. A claim with no tool result from this session behind it is labelled unverified.
- Do the simplest thing that works. One journey. Every extra feature costs demo time.
- Ask Ralf before creating anything public or paid: a GitHub repository, a Slack app, any trial account. His git identity is Prince-Nothing.
- This folder is not a git repository. The build needs a new one; propose where it lives.
- This PC has 4 cores and 32 GB. Run at most two things that start a dev server or tests at once, and stop every server you start before you report.
- Use the `plain-product-copy` skill for anything the judges or the team will read, and the `ship-any` skill before any push.
- Append decisions and new facts to `wise.md` under the matching heading with the date.
