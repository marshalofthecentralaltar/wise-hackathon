# Wise hackathon notes

Running notes. Add new information under the matching heading with the date. Every number carries where it came from.

## Decisions

- 2026-11-13: The idea does not have to be about Wise. "Max Ease" can be anywhere in life (Ralf).
- 2026-11-13: Wise Platform dropped as a build target. Its customer is a bank, credentials are not self-serve, and it fits "everyday experience" badly.
- 2026-11-13, later: **No idea is chosen. Both leads collapsed.** The organisers told the team not to think of Wise specifically. Next step is a fresh search for a real problem anywhere in life, using `NEXT-PROMPT.md` in this folder.
- 2026-11-13, later: Ütle on Wise collapsed on a condition count. A person must be unable to type, able to speak, Estonian-speaking, on desktop Chrome, a Wise customer, and able to approve the payment. Only the first number is measured (33,700 registered mobility disability in Estonia, from Ütle's notes); the result is dozens to a few hundred people. The demo also hides the approval step, which a person without hand use cannot do; Wise's test environment accepts a fixed code there.
- 2026-11-13, later: Working rule from Ralf: run the tests that can kill an idea before praising it, and think from first principles. What made Ütle a good idea originally was its moat: a group the mainstream tools skip (Estonian speakers who cannot use their hands).
- 2026-11-13: The team split the Wise product areas between three people; Ralf moved from Platform to general customer experience.
- 2026-11-13, evening: **Idea chosen** (Ralf: "after 4 hours we have an idea"). A tool that watches where customers report small problems, works out which service and team each belongs to and which recent change is the suspect, opens a pull request with a fix, and gives support one approved sentence. It targets small problems that never get fixed and leaves major incidents to monitoring. Steered by two Wise engineers; see mentor notes and `mentor-conversation-transcript.md`. The build kickoff is kept as `NEXT-PROMPT-2-plan-done.md` (already run; it produced the "Report to pull request" page); the earlier research brief is kept as `NEXT-PROMPT-1-research-done.md`.
- 2026-11-13, 16:45 UTC: after the on-call engineer conversation, Ralf said "Take this all" to the other session's reading of it, which I read as accepting its two proposed changes: the tool searches several repositories for the recent change, and its Slack post adds "This change can be undone cleanly" after a trial revert. The alert-driven on-call flow stays out of scope. `NEXT-PROMPT.md` is now the prompt that updates the "Report to pull request" page with all of this.
- 2026-11-13, about 17:05 UTC: that page update ran (kept as `NEXT-PROMPT-3-page-update-done.md`). Ralf asked what can be built by tomorrow with agents running all night. `NEXT-PROMPT.md` is now the overnight build kickoff: hand steps with Ralf first, six lanes with a proof each, a morning hand-off, and a `/goal` text. Running it is Ralf's go for the build. Measured on this PC at 16:59 UTC: `gh` active account is still `marshalofthecentralaltar`, Docker daemon not running, no Prometheus or Grafana installed, `ANTHROPIC_API_KEY` not set, `railway` and `vercel` on the path and both logged in (17:03 UTC), sleep on mains power set to never. The demo time is still two figures (about 12:44 by Ralf's count, about 11:15 by the first kickoff notes); the kickoff has a teammate ask an organiser.
- 2026-11-13, 17:59 UTC: Ralf asked for the work order on GitHub and a kickoff that plans, then builds the core. The work order is in issue #1 (everyone, by clock) and issue #2 (the core, with a decision at each time). `NEXT-PROMPT.md` was rewritten clean: its first reply is a plan and it stops for Ralf's go; then hand steps, six lanes with a proof each, a hand-off by 07:30 Tallinn time, and a `/goal` text. One decision of mine is written in as overrulable: the card app runs on the demo laptop and a watcher redeploys it on merge, in place of a cloud host; `docs/CONTEXT.md` says so (commit f431585). Measured 17:57 UTC: the repository has one collaborator besides the owner (`jekaterinq`) and two invitations pending, so Ralf has started inviting. Every clock time in the work order is a guess.
- 2026-11-13, 18:24 UTC: Ralf asked for the issues to be as deep as possible for teammates on weaker models, each showing who it is for. All eight issues were rewritten and posted: the person's name leads each title, a label per person, an assignee per issue, and every issue carries the whole plan, the build file by file, the easy mistakes, proof commands and a longer agent prompt. Old bodies are kept in the session scratchpad only. Changed in the specs: #4 uses Prometheus 3.15.1 as `.tar.gz` on every system (GNU tar in Git Bash cannot unpack a zip) and listens on 127.0.0.1; #3 fixes the six `other-` slugs and adds five validator checks; #5 adds a `db-` class prefix, a no-animation rule and committed screenshots; #8 question 2 no longer reopens the real Prometheus. GitHub names measured 18:17 UTC: `nadimmetwalli`, `rogerpurtsak`, `jekaterinq` in; `diyunas` invited 18:10 UTC. Read as Kata = `jekaterinq` and Diana = `diyunas`; the first is my inference. The Slack workspace is "Innovative Bug Fixer" (Ralf created it, with `#support`). Nadim's Slack member ID is no longer a hand step: the tool looks it up once he has joined. The first reply of the kickoff (the plan) is given; Ralf has not said go. At 18:30 UTC, on Ralf's ask, the order was added: each title says 1st or 2nd for its person, each issue has an "Order" row, and #1 has the order across the team. At 18:45 UTC, on Ralf's ask: #1 was rewritten to 20 sections (the problem and the benefit sum, one run worked through with an example handoff, the severity rule, what runs where, the stage table, scoring, the six parts of the night build with their drop order, a table for when things go wrong, a glossary), and every issue now states that it is worked on in its own branch (a "Branch" row, a rule in the shared plan, the agent prompts; #2 uses `core-<part>` branches, #8 has none). A flow diagram in mermaid rendered with clipped labels on GitHub and was replaced by a plain-text flow, checked in the browser. #6 said "four of the seven inputs are guesses" about the 85-hour sum; the page it comes from marks every input as a guess, so #6 now says that. Diana (`diyunas`) accepted and commented "taking this" on #5 at 18:32 UTC.
- 2026-11-13, 17:52 UTC: **The team is five people** (earlier notes said three). From Ralf: Ralf has Claude on the 20x plan; Nadim has the 5x plan and spends it sparingly; Roger and Diana each have Codex and Claude Pro; Kata has ChatGPT Go and no coding agent. Proposed split, pushed to the team repository as `docs/START.md` and into issues #1, #2 and #7: Ralf the core (#2); Nadim #4 and the owner role in the demo; Roger #3 then #7; Diana #5 then #7; Kata #8 tonight then #6. Proposed demo roles: Ralf speaks, Nadim at the laptop approves the fix, Roger, Diana and Kata post the three reports. The morning timetable assumes a demo at 11:15 and needs the hand-off file by 07:30 Tallinn time. Ralf has not confirmed the split. Nobody is invited to the repository yet.
- 2026-11-13, about 17:50 UTC: Ralf asked for the larger scope from all the talks, then ruled: "we will stick to what we sketched right now". The larger list is saved in the team repository as `docs/LATER.md`, marked as not being built. Sprint one stays the scope.
- 2026-11-13, 17:35 UTC: **Ralf set the scope of the first sprint.** Reports in Slack reach a set count; the tool finds the pattern; checks monitoring and logs; reads the recent changes; finds the service and team and tells nobody yet; investigates in the code (code, commits, deploys, comments); gives a verdict on severity. Low severity (a screen flickers): it fixes the bug, then writes a handoff. High severity (a balance is wrong): handoff only, with the origin, the responsible commit, what was wrong in the code and next suggestions. The handoff goes to the owning team in Slack, with the option to approve the fix when severity is low. Applied at 17:38 UTC to `docs/CONTEXT.md` (commit 704d3cf), the readme, issues #1, #2, #3, #6, #7 and `NEXT-PROMPT.md`. My readings, not confirmed by Ralf: Grafana stays cut and Loki stays out (Prometheus and the app's own log lines); the second planted problem is a wrong amount on the transfers page, run before the demo; "Approve fix" makes the tool merge, for the owner's Slack account only; the sentence for support stays as the last line of the handoff; when in doubt the verdict is high. The plan page and the screens page still show the earlier nine-step flow.
- 2026-11-13, 17:23 UTC: Ralf asked for GitHub issues, with the core path kept for us and side features for teammates on Codex and Claude Code. The team repository is `marshalofthecentralaltar/wise-hackathon` (private; it was empty, with the owner as its only collaborator). Seeded `main` with `README.md`, `AGENTS.md`, `CLAUDE.md`, `.gitignore` and `docs/CONTEXT.md` (five commits through the API; the user's name is not in them). Created issues: #1 read first (pinned), #2 core checklist (ours), #3 support messages fixture, #4 Prometheus kit, #5 card app page designs, #6 pitch and question sheet, #7 runbook, #8 questions for organisers and the on-call engineer. `docs/CONTEXT.md` fixes the contracts (ports 3000 and 9090, metric names, four element ids, fixture format, the stand-in name "Demo Bank"). `NEXT-PROMPT.md` now names this account in place of Prince-Nothing, whose search call answered "User flagged as spammy". Teammates are not invited yet.
- 2026-11-13, 17:10 UTC: Ralf asked whether setting up Prometheus and Grafana is a waste of time against a mock. Applied to `NEXT-PROMPT.md` and the screens page (version 3): Prometheus stays real as one downloaded program with a 30-minute cap and a fallback to reading `/metrics` directly; Grafana is cut and Prometheus's own graph page is the green screen; no Docker. The plan page (version 2) still says Grafana and has not been changed. Ralf has not confirmed this; a full mock of monitoring is his call and would change lane C only.

## Theme and scoring (from the printed sheet)

Theme: Max Ease. Remove friction from an everyday experience: simplify a complicated process, anticipate what someone needs, or help people get something done faster and more confidently.

Directions on the sheet: simplifying complex workflows (a confusing form or application), seamless navigation (new city, service, system), effortless coordination (trip, event, household, group), inclusive accessibility (needs, languages, digital confidence).

| Category | Weight | What a 3 needs | What a 4 needs |
|---|---|---|---|
| Friction removal and utility | 40% | Reduces effort in a real scenario; intuitive and practical | Eliminates complex friction entirely; effortless; accessible to all |
| Technical execution | 25% | Fully working end-to-end prototype, proper APIs, stable | Production-ready, elegant error handling |
| Presentation and pitch | 25% | Clear story with a live demo of the main user journey | Flawless live demo, strong Q&A |
| Creativity | 10% | Distinct, clever framing | Highly original |

Hardcoded shortcuts cap technical at 2. Leaning on slides caps the pitch at 2. AI use must be disclosed and carries no points.

Reading: 90% of the score is a real friction removed plus one journey that works live.

## Wise in brief (as of 2026-11-13, from Wise's own pages and results)

- Tagline: "Min fees. Max ease. Full speed." The theme is one third of it.
- Wise measures ease by how often a customer has to contact support (7.29% in Q3 2024, the latest figure found).
- FY2026: about 19 million active customers, $243.5 billion moved, average fee 0.52%, 77% of transfers arrive in under 20 seconds.
- Products: personal account and card, Wise Business, Wise Platform (banks embed Wise).
- Tallinn is the largest office, 2,200 to 2,500 staff (sources differ).
- Already shipped, so not worth pitching: bill splitting, Groups and Jars, travel hub with eSIM, scheduled transfers, large-transfer planner, bulk invoice upload, AI assistant for transfer questions, reading bank details from a photo or QR code.
- Wise's own named reasons people contact support (2024): identity checks, receiving money, changing phone or number, ordering a card.

## Review scrape (collected 2026-11-13)

Coverage:
- 22,753 reviews: 11,889 App Store (29 country stores), 10,864 Google Play (13 stores).
- 13,840 dated 1 May 2026 or later; 71% of those are 5-star.
- Reddit and Trustpilot refused direct requests; covered only through search summaries.
- Data: `research/data/appstore_reviews.jsonl`, `research/data/googleplay_reviews.jsonl`. Scripts: `research/scripts/`.

Themes in the 3,044 recent 1 to 4 star reviews with text (keyword tags in about ten languages; rough, a review can carry several, and a second read showed the first pass undercounts):

| Theme | All 1 to 4 star | 2 to 4 star only (868) |
|---|---|---|
| Identity checks and document requests | 13.7% | 5.6% |
| Support hard to reach or scripted | 13.3% | 4.3% |
| Transfer slow, stuck or held | 12.3% | 13.5% |
| Fees and rates | 11.2% | 13.7% |
| App redesign, updates, bugs | 10.2% | 15.2% |
| Account closed or blocked | 9.9% | 1.8% |
| Receiving or adding money fails | 9.8% | 6.6% |
| Card, ATM, delivery | 7.7% | 7.8% |
| Login, codes, locked out | 3.0% | 2.9% |

Second pass, English reviews only:
- What 5-star reviewers praise (1,799 with text): easy or simple 46%, fast 36%, cheap 23%, travel and card 16%.
- In 906 low-star reviews: a wait counted in days or weeks 14%; urgent or emergency 9%; long-time user who turned 7.5%; abroad when it failed 7%; asked for the same thing again 5.5%; given no reason 5%.
- Waits people put a number on: 138 in total, 117 of them three days or longer, 21 over a month.

Synthesis:
1. Ease is judged in the exception. Nobody complains about the normal transfer; nearly every serious complaint is about being stopped.
2. The stop comes with no information: what is needed, why, how long. Checks, support and holds show up in the same reviews.
3. A broken promise hurts more than slowness. "Arrives in seconds" followed by three days; "sometimes minutes, sometimes days, why?"
4. People are asked again for what they already gave, and their documents fail without a clear reason.
5. It fails when the stakes are highest (urgent, abroad) and when life changes (moved country, new phone number).

Limits: reviews show where it hurts, not why. They come from Wise customers only, so for an idea outside Wise they give a pattern, not proof of demand.

## Mentor notes

- 2026-11-13, screening team member, side note written during the talk (low weight, one anecdote): an outside service checks registrations against sanctions lists. It flagged a person on a guess. Wise had a location signal, but the outside service could not receive it, so the case went to manual handling. Their view: teams communicate poorly, every team supplies data, and the data lacks context and labels.
  - Background found: published studies put false alarms above 90% of sanctions alerts. OpenSanctions offers the combined lists free for non-commercial use.

- 2026-11-13, later, team conversation with a person who works in support on major incidents (name not captured; transcript pasted by Ralf): support and engineers sit far apart. A lower team receives customer tickets; when many pile up they raise a major incident and the speaker's team escalates and calls people in. In every incident the first question is "is there customer impact, are there support updates". Support may not tell customers everything.
  - Idea as discussed: a bot, not the agent, reads incoming tickets, notices the same problem repeating in a short window (three in 15 minutes was the example), checks whether it lines up with a recent change by developers, and hands engineers a packet. Kristjan's addition: the bot could go into the code and look for the cause. Objection in the room: reading code is too far; match against the list of recent changes (commit names) instead.
  - Prior art found 2026-11-13: IrisAgent sells ticket clustering that alerts engineering; PagerDuty's Zendesk app lets an agent link a ticket to an incident by hand and see an internal status page; Zapier has ticket-spike templates; Enterpret warns that volume alone is weak and breadth across accounts matters. No tool found that ties a ticket spike to one specific recent change, or that sends agents an approved customer wording. Not confirmed absent.
  - Not kill-tested yet. Open risks: internal tool against "everyday experience" on the sheet; no real ticket data, so tickets would be made up.
  - 2026-11-13, later, the insider's answer (reported by Ralf): major incidents are usually spotted by internal tooling before customers report them. **This was the stop answer for the major-incident version; that version is dead.** The insider also asked how big the problem is, who benefits and how much time it saves; nobody has a number.
  - Team's widened version: triage for everything customers report or rate badly, aimed at the edge cases with no internal monitoring, recommending changes to developers and tracing each to the change behind it. Prior art for this wider version is a sold category (Enterpret, IrisAgent, and Lorikeet's list of tools that cluster conversations and surface emerging issues).
  - Size check on our own data, 2026-11-13 (`research/scripts/bursts.py`, crude keyword detector, judgement on the read): 47,985 reviews, 40 apps plus Wise, since June 2024. 1,544 low-star reviews say something broke; 173 of them (11%) fall inside 26 bursts in 12 apps. Median burst 4 days, three lasted a week or more. Reading the 22 largest, about 11 are one problem, most right after an update: Enefit 17 to 29 June 2026 (26 reviews, app freezes on a white screen), Smart-ID from 24 February 2026 (21 reviews, the new QR step), Smart-ID 10 May 2026 (10 reviews, crash after that day's update), Swedbank from 29 September 2026 (9 reviews, fingerprint login). Wise's own four bursts are mixed topics, so no single-problem pile shows in Wise's public reviews by this method. Limits: reviews are a thin sample of tickets, and a long burst can mean a slow fix just as well as slow detection.

- 2026-11-13, later, a Wise engineer (transcript pasted by Ralf, cut off at both ends):
  - Regional teams nearly always work in someone else's code base and often do not know which team owns a service. "Request review" pings the owning team; that is how people are told of changes, and it shows merged, reviewed, approved.
  - An incident is a Slack channel. Whoever raised it is in the channel; if support raised it, support is in it. Until someone knows which service is involved, who joins is "very organic". Once the service is found, its owner is pulled in automatically as lead. Tagging anyone else is manual.
  - The engineer's words on the idea: "you'd be removing all that toil with auto-locating anything."
  - Not answered in the transcript: how much manual work this is. A second engineer left the team with a doubtful impression; the sentence was cut off.
  - Prior art found the same hour: incident.io's AI SRE, PagerDuty's Paige and Rootly's AI SRE all match an incident to recent changes and name a suspect pull request, starting from monitoring signals; incident.io describes looking up the owner and paging the team (not confirmed as shipped). So finding the change is sold on the engineering side. **This corrects the earlier line that nobody sells it.** Still not found: a tool that starts from customer tickets and ends with the release, the owner and a sentence for customers. Whether Wise uses any of these tools is unknown.

- 2026-11-13, evening, two Wise engineers, one named Oleg (transcript pasted by Ralf, speech-to-text, garbled in places):
  - Tools at Wise as they described them: Grafana for dashboards, Prometheus for metrics, Loki for logs, Rollbar for front-end errors. Support tooling: Oleg thinks Zendesk; the other engineer recalls Twilio for phones. Neither was sure.
  - How support reaches engineers: support goes into Slack to find who can help; big things start with `/incident` in Slack.
  - "It wouldn't really help Sev ones": dashboards on office TVs go red and teams see it. "It's all about the nitpicks… small wins, edge cases that are taking time or never being fixed."
  - Their own evidence: when Wise adopted AI coding tools and the engineer ran workshops, teams began fixing things that "had been there for ages". Example: card pictures flickering, fixed with Claude Code. No monitoring could see that one.
  - The flow they sketched: connectors watch Slack and the support tool (and could watch GitHub issues); step one is understanding the problem; then ask Prometheus, Grafana and Rollbar whether anything shows; then a decision tree that ends in a developer hand-off, an automated fix or a rollback.
  - Rollbacks: a change rolls out to 1%, then 5%, then 10% of traffic and is pulled back automatically when its metrics go wrong; one can also redeploy the previous image. A reverted commit that is redeployed is not tracked well ("very hard to pick up that you've reverted a commit").
  - Ownership: their team owns the catalogue of teams and domains. All back-end calls pass one proxy with a mapping from URL path to service, and each path is registered to a team. An internal Chrome extension shows the owner of a page.
  - Demo advice: fake support and monitoring endpoints with loud logging, one web page to type the customer problem into, end on the pull request. A real demo beats a video; the engineer disliked last year's winning video. This engineer is not a judge.
  - Pitch advice: say outright that Wise's monitoring already catches the big incidents and this is for what gets missed, "to make it easier for customer service, and to make engineers not even involved unless they have to be". Scale they mentioned: 20,000 pull requests. (Corrected against the full transcript in `mentor-conversation-transcript.md`, which is the better source; it also says "record it as well" about the demo and that a problem with no visible error goes to a developer for verification.)
  - The team's closing words: "After 3.5 hours, we have an idea."

- 2026-11-13, evening, a Wise engineer who takes on-call shifts (Estonian, speech-to-text, no speaker labels, garbled in places; raw paste in `oncall-engineer-transcript.md`). Who said which sentence is inferred.
  - What on-call looks like: a robot phones, he acknowledges, opens Slack, and the alert links to the right dashboard. He first judges whether it is a short spike or serious. "Certainly I look at what the latest releases were"; if something broke right after a release, "easy rollback"; otherwise logs. No rule says how long a spike must last; each person decides.
  - Rollback: in office hours he asks the author ("maybe it is your change"); alone in the evening he decides himself. Not every change can be rolled back.
  - Serious: he opens an incident, which is a Slack channel, and presses "page on-call" so a robot calls another team's on-call (his example: Kafka lag with no cause in his own service; Kafka is run by an internal platform team). They join the channel and read the context. No voice call by default.
  - **What he would automate, his first answer:** the latest releases, "so I don't have to go to GitHub by hand and look through every repository", and working out which service is involved, because Wise has thousands of services and his service may call another one that is overloaded. Then: the tool says which change it suspects, that it checked the change can be rolled back, and offers the rollback as a first step. A button to roll back: "for example, yes". Rolling back automatically: he thinks it may be dangerous. The tool could also name the responsible team and offer to page it.
  - Canary rollout exists as described earlier, but "5% of traffic is so little"; it often helps and misses flows with low volume next to everything else.
  - After the fix: "postmortem actions", meaning tickets in Jira and a postmortem written in Confluence, by hand today. He agreed a bot could draft it from the incident channel for a person to review.
  - **On problems with no monitoring alert, raised by the team at the end:** "I think that is the one. A big part that could help, because not every alert comes from monitoring. Fairly often we do not see it, or from our side it is more or less fine, but customers write that this specific thing does not work the way it should." This is the third Wise voice to point at customer-reported problems and the first to give a frequency word ("suht palju", fairly often). No number.
  - The team told him "our idea is to automate the whole flow". His answer to that was lukewarm ("a nice thing on top", garbled). The alert-driven flow he described is the version already closed on 13 November and is what incident.io, PagerDuty and Rootly sell.
  - Still not asked: how often a problem reaches him from customers before monitoring, and how long from the first customer message until he hears.
  - Prior art for the postmortem draft, searched the same hour: incident.io and Rootly both say they draft a postmortem from the incident's Slack channel (their own blogs, via search, pages not opened). So that piece is sold too.

## Friction sub-tests (the 40% row, taken from the sheet's wording)

Each scored 0 to 2, 14 in total. Scores are judgement, not measurement.

1. Meaningful: a real problem, frequent or high-stakes (the sheet's 1 is "fails to solve a meaningful problem").
2. Complex today: the current way takes many steps or special knowledge.
3. Eliminated, not reduced: about one action is left.
4. Anticipates: acts before the person asks (the sheet's 2 is "fails to anticipate user needs").
5. Effortless: nothing to learn or set up.
6. Accessible to all: language, age, disability, digital confidence.
7. Adds no new friction (the sheet's 1 is "adds unnecessary complexity").

Gates outside the 40%: one journey that demos live in three minutes; buildable end to end in the time with real APIs; explainable in one sentence; not already shipped.

## Candidates scored (2026-11-13)

| Candidate | Score /14 | Why it wins or loses |
|---|---|---|
| Send money on Wise by speaking Estonian (built on Ütle's speech engine) | 12 | Only one where "accessible to all" is the core; one sentence replaces the whole flow; working speech engine already exists |
| Tell a person which document an institution wants and check it before submitting | 10 | Reduces, does not eliminate; any AI chat already does most of it |
| Fill any form from your own documents | 9 to 10 | Browsers already ship AI autofill |
| Travel readiness: Wise prepares the trip when it sees the flight payment | 9 to 10 | Card data is partner-only, so it would be hardcoded; Travel hub covers part |
| Sanctions false alarms: give the reviewer the missing context | 8 | Internal tool, hard to demo, one anecdote |

Leading idea: **Wise by voice, in Estonian.** Say "saada emale viiskümmend eurot" and the transfer is prepared and read back; the person approves it. Nothing to tap, read or type.

Evidence gathered 2026-11-13:
- No bank or fintech found that sends money by voice; Revolut's assistant takes voice input but does not make payments. No Estonian voice banking found.
- The European Accessibility Act has applied to consumer banking and payment services since 28 June 2025.
- Wise's test environment is a separate account at wise-sandbox.com; a personal token can create quotes, recipients and transfers. In the EU and UK a personal token cannot fund a transfer, so approval stays with the account holder.
- Reviews: "I'm 70 and found it a little complex", "introduced a relative to the app and they couldn't figure it out", "send and move is confusing for beginners".

Ütle's role:
- As the engine under a new Wise-specific build: yes, disclosed.
- Submitted as it is: no. It was not built here and already won on 6 October 2026.
- As proof of identity by voice: no. Voices can be cloned.
- As the way to complete verification steps without hands: possible second scene, only if time allows.

Blockers to clear first:
- Do the rules allow building on our own earlier open-source code if we disclose it?
- Can we register at wise-sandbox.com and get a token today?
- Speech recognition in a loud hall: headset, push-to-talk, a recorded fallback.
- The security question in Q&A: voice only prepares; approval stays a separate step.

Parked:
- Travel lock-out: login codes sent to a phone number the traveller cannot reach.

## Demand check on the Ütle lead (2026-11-13)

Rules: organisers allow Ütle if disclosed (Ralf, 2026-11-13).

What the evidence supports:
- Ütle's own user (eye-tracker user, motor disability, hackathon day one) asked for three things: faster messages, browser by voice, Estonian. He added that eye tracking works badly with forms and PDFs. Banking was not on his list.
- Ütle's product page: about 33,700 people in Estonia have a registered mobility disability; how many fit is a guess (a few thousand). Seven care-home testers have used it.
- UK survey (Which?, October 2025, 2,723 people): over half of disabled bank customers struggled to access banking; one in five found security steps such as card readers and passwords hard.
- UK research (Bristol, 815 people): 24% had problems with online banking, 58% among those who find digital devices difficult.
- Wise reviews: 137 recent low-star reviews mention confusion or not finding things (keyword match, rough).

What the evidence does not support:
- Voice payments as something Wise customers want: zero requests in 22,753 reviews. Every "speak" hit meant "speak to a human".
- Accessibility as a stated Wise complaint: about three genuine cases in 22,753 (a VoiceOver user in Brazil who could no longer convert currency, small fonts, a 70-year-old who found it complex). People who cannot use an app rarely review it, so this is weak evidence either way.
- Estonian speakers as Wise's customer base: not shown.

Revised idea: **any form, by talking.** The tool reads the form on the page, asks for each answer in plain words, fills it, and the person confirms by voice or by looking. Demo on a real Wise form in the test environment, then on one non-Wise form. This matches the sheet's first direction ("a confusing form/application") and fourth (needs, languages, digital confidence), and the one thing Ütle's own user said was still broken.

New work at the event: turning a form into a conversation, and making it work on real pages. Ütle's forms-by-voice is proven on stand-in pages only.

Kill test: with Ütle running, fill one field by voice on a real Wise page.

## Teammate's idea: CaseFlow with "Confirm via your bank" (2026-11-13)

As described: an internal tool for compliance and support teams that shortens the time a customer's money is frozen, through document checks at upload, case priority by real customer impact, and a visible status. Added piece: instead of uploading a bank statement, the customer logs in to their own bank and consents to read-only access, so the data comes straight from the bank (open banking, the EU's PSD2 account information service).

Checked 2026-11-13:
- Reviews that name bank statements, proof of funds or income: 29 of 3,044 recent low-star reviews (1.0%, narrow keyword match with some noise). Documents rejected or asked for again: 77 (2.5%). The wider identity-check theme is 13.7%.
- Strongest quotes: "I have spent hours providing bank statements from three banks, payslips, tax returns"; a student asked for three months of bank statements who could not use their money meanwhile; "they put the payment on pending as they need to confirm the source of income".
- Wise's help pages describe document uploads only. No sign that Wise offers a bank connection for this. Not confirmed absent.
- The method exists elsewhere: Thirdfort, Amiqus (through TrueLayer), Armalytix and Credas sell it to UK law firms. Proven, so not novel.
- GoCardless Bank Account Data is closed to new sign-ups (confirmed). Enable Banking lists a test environment for Estonia covering LHV, Citadele and Swedbank; SEB not found; free sign-up not confirmed.

Weak points:
- Bank data proves money arrived, not where the sender got it. Pick a demo case it answers fully (salary or income), not the car sale.
- Four features is too many for one day. One journey: transfer held, confirm via bank, verified, released.
- "Internal tool" fights "everyday experience" on the sheet. Lead with the customer's moment.
- Covers EU and UK banks only; everyone else falls back to upload.
- Do not claim legal compliance on stage; ask what may be shown to a customer during a review.

Kill question for the screening mentor: "Does Wise already let customers connect a bank instead of uploading a statement, and if not, why not?"

### Case-by-case test (2026-11-13)

Read all 35 reviews since January 2025 that name bank statements or proof of funds and asked of each: would a bank login have ended this customer's problem? Hand classification from short review text, so judgement.

| Outcome | Count |
|---|---|
| Clearly yes | 3 |
| Partly | 4 |
| No | 27 |
| Not a complaint | 1 |

Why the 27 "no":
- Outside EU and UK banks: 8.
- The customer already gave a statement and was asked for more, or closed anyway: 6.
- The question was about someone else's money (sender, family, clients): 5.
- A different document or request (address, tax, moved country, getting proof out of Wise): 4.
- Closed with no reason given, or unclear: 3.
- Wise already had the data (salary paid into the Wise account, still asked): 1.

Structural problems:
- The statement is rarely the last question. Requests arrive one after another, each with its own wait.
- More data invites more questions. A bank feed shows months of transactions; existing products flag cash deposits, crypto and undeclared sources.
- The wait sits in the review queue. A faster document only helps if a rule may close the case with no person, which is Wise's decision.
- Wise accepts a statement as proof only if it shows the full amount being sent, so large one-off sums are the weak case.

Verdict: too thin as the core idea. It would solve about 3 of 35 named cases. What the cases describe is a drip of requests and silence, and one asks outright: "If they really needed the information, they could have asked me before I sent the money."

## Published pages (private until shared)

- Confirm via your bank (teammate's idea, with the thin-case finding): https://claude.ai/artifact/DGiirdaeNCFNYEevokFZCA
- Forms by talking (Ütle idea): published 2026-11-13, link in the session.
- Which change broke it (complaints matched to the release behind them, shown on Smart-ID May 2026): https://claude.ai/artifact/17tUhuGJ5zemMV7FLKUUN8. Source kept at `pages/which-change-broke-it.html` (version 3, 2026-11-13); to update from another session, publish that file with the link as `url`. Its flow ends on a note to developers and has not been updated to end on a pull request. Smart-ID low ratings per day ran at about 2, then 10, 5, 3 and 7 on 11 to 14 May 2026 after an update a reviewer dates to 10 May; six of the ten on 11 May name the update. Google Play installs measured 2026-11-13: Smart-ID 5,000,000+, Swedbank Estonia 500,000+, Enefit 100,000+, LHV 100,000+, Wise 50,000,000+.
  - Version 2 (same link) after Ralf's feedback that the first version did not show the process or name the benefit: a five-step flow, then a benefit sum with editable inputs. Default result: 400 customers and about 85 hours per bug (80 of them customers' own time, 3.3 support, 2 developers); 38 bugs a year gives about 15,200 customers and 3,243 hours. Four inputs are plain guesses (40 tickets per bug, 10 people affected per ticket, 12 customer minutes, 2 developer hours). Public figures used: 150 deployments a day (Wise engineering blog, 2022), a 7-minute average support call (ContactBabel, US, 2025), under 1% of changes failing in the best tier (LinearB 2025, 3,026 organisations). Wise's support headcount was not found; total headcount sources disagree (6,500 to 8,800).

- Report to pull request (the demo workflow part by part, the three minutes on stage, the 19-hour build plan): https://claude.ai/artifact/1RLZu4U3H6gxsN4VvcCWTF, published 2026-11-13. Source at `pages/report-to-pull-request.html`. It shows a plan; nothing in it is built and Ralf had not approved the plan when it was published.
  - 2026-11-13, 16:55 UTC, version 2 (same link, source saved at the same path), from the on-call engineer conversation: step 5 searches two or three repositories (1 hour, a guess); step 8 adds "This change can be undone cleanly" after a trial revert; the pitch gains the 5% rollout reason; new sections "Who it helps, how many, how much time", "What Wise engineers told us" and "What this tool leaves alone"; the repository search is first on the drop list; the build table is 18 hours from 16:44 UTC with 6 hours of sleep, 2 of rehearsal and no spare. Status on the page as of 16:44 UTC: 18 hours left (Ralf), nothing built, plan not approved. Quotes were checked by script against the transcript files. Not looked at in a browser after publishing.

- Report to PR demo screens (drawings of the six screens on stage, each marked real service, stand-in or the tool; who sets up what by hand; who works when): https://claude.ai/artifact/3qLwbjNP7LEtCRZNCZe7mD, published 2026-11-13 about 17:05 UTC, version 2. Source at `pages/demo-screens.html`. Drawings only; nothing in it is built. Not looked at in a browser after publishing.

Ütle facts checked in its code 2026-11-13: forms by voice exist field by field ("valmis" next, "kinnita" submit), saved details exist (Minu andmed), dwell works on whatever moves the pointer. No webcam eye-tracking code was found in the Ütle folders on this PC; Ralf says a camera eye tracker works, location not confirmed.

## Open questions

- What share of document requests fail the first time, and why?
- During a review, what may an institution tell the customer?
- Does the pattern "an institution stopped me and asked for proof" show up in mentors' own lives outside Wise?
- Do we get any sandbox or test access at the event?

## Interview script

Open: "We are choosing our problem, not pitching. Can I ask about the last time something everyday was a pain?"

1. What is the last thing you had to get done that took far more steps than it should have? Walk me through it.
2. Where exactly did you get stuck or have to start over?
3. What did you do to get around it, and who or what did you ask?
4. What did it cost you in hours, money or a missed deadline?
5. How often does it come up, and who else hits it?

Follow-ups after any answer: "What happened next?", "How often?", "How do you know?"

Capture line: `Who | situation | stuck at | workaround | cost | how often | exact quote`

## Problem search outside Wise (2026-11-13, afternoon, 21.5 h before the demo)

Run from `NEXT-PROMPT.md`. Result: **nothing passed all seven kill tests.** The nearest miss is phone calls you can read, in Estonian. It failed on missing measurement, not on evidence against it.

### Data collected

- 25,232 reviews of 40 Estonian everyday apps (5,405 App Store, 19,827 Google Play; Estonian, English and Russian), 12,296 of them 1 to 4 star with text. Files: `research/data/ee_apps_appstore_reviews.jsonl`, `research/data/ee_apps_googleplay_reviews.jsonl`. The theme counts below were taken on the first 21,430, before the App Store fetch finished.
- Scripts, run from `research`: `scripts/ee_apps_apple_fetch.py`, `scripts/ee_apps_googleplay_fetch.mjs`, `scripts/ee_apps_themes.py`, `scripts/ee_apps_grep.py <app regex> <text regex> <n>`.
- 358 Rogervoice reviews (`research/data/rogervoice_appstore_reviews.jsonl`): none from the Estonian store.
- Lowest-rated in the Estonian App Store (measured): Luminor 1.4, Stuudium 1.5, Elron 1.6, Pilet.ee 1.7, Olerex 1.8, PARGI.EE 2.0, RIA DigiDoc 2.2, Eesti äpp 2.9.

### What the reviews show (keyword counts, rough)

- Login and codes: 16% of low-star reviews across all apps. Closed systems, nothing we can build on.
- Russian removed: 41 of 110 low-star reviews of the state app (launched December 2024 without Russian) and 30 of 141 for Omniva (removed late 2025). Several reviewers say they read Estonian and are protesting.
- Parking (PARGI.EE, EuroPark, Snabb, 800 low-star reviews): fines after the app ended a session by itself, a free hour lost the moment "start" is pressed, the wrong zone shown, sign-up that needs a call from an Estonian number, foreign cards refused, a 0.50 euro fee per start.
- Smart-ID: moving to a new phone fails when the ID card's contactless chip will not read; the new QR step confuses older people ("my parents are pensioners and no longer understand how").

### Sources outside the reviews

- Riigikogu Toimetised 2025 (Remmelg and others), survey of about 2,366 health workers: 35% rate their Russian below B1; 33% of Estonian-speaking doctors have had a visit cancelled or postponed over language; 62% already use Google Translate or ChatGPT with patients; 65% want a medical translation tool; 1% use a phone interpreter.
- Census 2021: 84% of residents speak Estonian, so about 16% do not (computed, about 213,000).
- Estonian Hard of Hearing Association leaflet: hearing loss in 14 to 20% of people, "up to 200,000" in Estonia, 1,500 to 2,000 fully deaf, all estimates; "making a phone call can be blocked, for example booking a doctor's appointment"; only 1% of people with hearing loss know sign language.
- ERR 2025 (Laurimaa): 1,300 to 1,500 deaf sign-language users; remote interpreting runs weekdays 9 to 18 and Saturdays 10 to 16, with no provider found for Tuesdays and Thursdays. The state app books an interpreter for 30 minutes, one booking at a time.
- ERR 2020: institutions phoned deaf people despite a note on file; relatives had to take the calls.
- Eesti Arst 2025: no statistics on hearing loss exist in Estonia.
- Call captions on phones: Apple lists English, French, Spanish, German, Japanese, Korean, Mandarin, Cantonese (The Apple Wiki, not checked against Apple). Pixel lists English, German, Spanish, French, Italian, Portuguese, Hindi (secondary source). Samsung lists 24 languages; Estonian not found in any result, not confirmed absent.
- United States: captioned phone service is free to residents, with a 2025-26 funding requirement of $787 million (FCC order DA 25-578). Rogervoice sells it elsewhere for $5.99 to $29.99 a month; no page found that lists Estonian. Not confirmed absent.
- Captions for a conversation in the same room already exist in Estonian (tekstiks.ee from TalTech, Soniox), so only the phone call is open.
- Twilio lists Estonian numbers against an ID document, address anywhere (Twilio's guideline page, not tried).

### Candidates and where each died

| Candidate | Died at | Why |
|---|---|---|
| Russian back in the state app and Omniva | K4 | Screen and page translation already do it; part of the complaints are protest |
| Parking helper (read the sign, right zone, reminder) | K2 | About 13 of 60 cases read would have ended (hand count); the rest are sign-up, cards, fees, bugs |
| Parking payment for visitors | K6 | No operator API; SMS parking needs an Estonian SIM |
| Smart-ID on a new phone | K6 | Closed system |
| Watcher for freed specialist appointments | K6 | Slots sit behind a Smart-ID login, no API |
| Prescription renewal without phoning | K6 | Every practice has its own channel |
| Doctor and patient interpreter, Estonian and Russian | K4 | 62% already use Google Translate or ChatGPT. Best-measured problem found |
| Call interpreter for foreigners in Estonia | K2 | No complaints found in people's own words |
| Customs declaration from the parcel notice | K2 | No complaints found; Omniva files it for 10 euros |
| School apps for parents | K6 | Closed systems (eKool paid-tier complaints 129 of 951) |
| Phone calls you can read, in Estonian | K1 and K2 | No measured count of people; 7 documented Estonian cases, 20 needed |

### Nearest miss: phone calls you can read, in Estonian

A person who cannot hear the phone, or cannot speak, calls any number from a web page. The other side's Estonian appears as text within about two seconds; the caller answers by voice or types and a synthetic Estonian voice speaks.

- K1 failed: every count is an estimate. Conditions: cannot follow speech on the phone or cannot speak; reads Estonian; has a computer or phone with internet; recognition accurate enough on phone-line audio (untested).
- K2 failed on volume: 5 of 7 documented cases would end with outgoing calls only, 7 of 7 once incoming calls work.
- K3: calls back from a clinic go to the person's normal phone until an Estonian number is rented.
- K4 passed as far as checked: no phone and no service found that captions a call in Estonian.
- K5: call captions ship per language and Estonian has 1.1 million speakers; the free service is paid for by a United States fund. Ütle already recognises Estonian on the person's own computer, which suits calls about health.
- K6: Twilio for the call (about $20, not bought), Ütle's engine for recognition, TartuNLP for the voice. First build test: ten sentences with times, names and numbers over a real phone line; stop under eight correct.
- K7: the seven Rapla testers and the eye-tracker user. Question: "When did you last skip a phone call, or have someone make it for you, because you could not hear or could not speak? Who was the call to?" Go: three of eight name a call within the last month. Stop: most say staff or family handle all calls and they do not mind.
- Friction score, judgement: 10 of 14.

## Second search, inside Wise's own space (2026-11-13, later)

Ralf asked for something relevant to Wise. Result: **nothing passes here either.** Read 160 Wise reviews case by case in three clusters (70 random mid-star from 2026, 45 on confusion, 45 on receiving money).

Structural finding: the heavy complaints (checks 13.7%, support 13.3%, held transfers 12.3%, closures 9.9%, receiving 9.8%) are stops that only Wise can lift, because the reason and the case sit in Wise's systems. What an outsider can reach through the public API is the surface: quote, recipient, transfer, account details, rate, status. Confusion about that surface is 112 of 3,634 low-star reviews with text since June 2025 (3.1%, keyword match).

| Candidate | Died at | Why |
|---|---|---|
| Explain or shorten a held transfer, a check or a closure | K6 | Needs Wise's internal case data |
| Say what you want and Wise does it (send, convert, find details, check status) | K5 | 18 of 45 confusion cases clearly end, 7 partly, 20 no (hand count). Wise is hiring a product lead to take its assistant "from contextual helper to agentic concierge", so Wise is not skipping this and we hold no edge. An EU personal token also cannot read statements or fund transfers |
| Which account details to give a payer | K2 | About 10 of 45 receiving cases; the rest are holds, delays and closures |
| Pay-in from your own bank is slow or fails | K6 | Sits between Wise and the bank |
| Wrong recipient details, money lost | K6 | Name checks sit with banks |
| Card refused abroad over limits; locked out when the phone number is unreachable | K6 | Inside Wise |
| Check a document before upload | K4 | Any AI chat does most of it (earlier finding) |
| Pay an invoice from a photo, split a bill, schedule, send without bank details | K4 | Shipped; Wise fills a transfer from a screenshot or invoice |

Facts checked this session:
- Wise's test environment is pre-funded with 1,000,000 GBP and has endpoints that simulate transfer states, top-ups, card payments, identity reviews and incoming payments (Wise docs, via search; not tried).
- Third-party connectors that send money through Wise's API from an AI chat already exist for developers (sergeiledvanov/mcp-wise and others). No official one found.
- Tasks people named in the confusion cluster: convert between currencies (6), work out how to send (about 10), find their own account details (3), tell whether a transfer completed (2), find transactions (1), find the rate (1).

## Build kickoff checks (2026-11-13, 15:50 UTC, run from `NEXT-PROMPT.md`)

Prior art for the fix step (this closes the gap named in the kickoff: coding agents that turn a report into a pull request):
- Cursor sells "Fix bugs reported in Slack": it fires on a bug report in a watched channel, reads the thread, searches the code, and opens a pull request "when the fix is small and safe" (Cursor's own workflow page, opened). The page does not mention grouping several reports, an owner lookup, the change that caused the bug, a monitoring check, or wording for customers.
- Gleap's Kai Resolve and Kai Code go from a support ticket to a pull request linked to the ticket, then reply to the customer once a teammate confirms the fix is live (article by Gleap's CEO on HackerNoon, opened). The article does not mention grouping duplicates, the causing change, or the owning team.
- Also listed in search results, pages not opened: Devin Auto-Triage (starts from Datadog, Sentry, PagerDuty alerts), Kilo for Slack, Continue's Slack agent, Slack Code with partner agents.
- **So "report to pull request" is sold. Do not claim it is new.** What neither opened page describes is the part before the fix: several customer reports with no alert behind them, who owns the page, and which recent change is the suspect. Not confirmed absent.

Zendesk: a trial lasts 14 days and an admin has to switch API token access on (third-party guide, via search). One blog says Zendesk stopped issuing new API tokens on 27 October 2026 in favour of OAuth (single source, unverified). Not tried. Recommendation in the plan: Slack only.

This PC, measured 15:49 UTC: `gh` 2.88.1 with two accounts logged in, the active one is `marshalofthecentralaltar` and `Prince-Nothing` needs `gh auth switch` before any repository is created. Claude Code 2.1.323, Node 22.20.0, git 2.50.1 present. Docker client 29.9.1 present, daemon not running. `ANTHROPIC_API_KEY` not set in the shell.

Clock: the kickoff file said 17.5 hours at 15:45 UTC; Ralf gave 19 hours at 15:49 UTC. The two differ by 1.5 hours; the plan uses 19 and keeps the last hour as buffer.
