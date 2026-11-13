# Plan, then build the core: sprint one

Time now, Tallinn: ___
Demo time, if an organiser has answered: ___ (otherwise plan for 11:15 on 14 November)
Hand steps already done by a person: ___ (none, or which)
How the grouping step calls Claude: ___ (API key, or Claude Code's own login)

## Task

We are at the Wise hackathon in Tallinn, theme "Max Ease". Five of us demo a tool live for three minutes on 14 November. Ralf builds the core with you. The four others work on side issues that the core never waits for.

The tool reads customer reports in Slack and notices when several are about the same problem. It checks monitoring and logs, reads the recent changes, notes the owning team, and investigates in the code until it names the commit responsible. Then it judges severity. A low-severity problem it fixes and offers for approval in Slack. A high-severity problem it does not touch; it hands the team a written account.

You are the orchestrator. Your first reply is a plan, described under "First reply". After Ralf says go you build: the hand steps with him, then lanes that agents build through the night while everyone sleeps. Nothing may wait on a person between about 00:30 and 07:30 Tallinn time.

Difficulty: hard. Nothing is built, no step has been timed, and one stalled prompt at night loses the night.

## Read these completely before the plan

- The team repository `marshalofthecentralaltar/wise-hackathon` (private). Clone it to `C:\Users\ralfs\wise-build\wise-hackathon`; the path has no space in it, and this folder does.
  - `docs/CONTEXT.md` is the specification: the ten steps of the run, the severity rule, the eight parts of the handoff, the two planted problems, and the contracts (ports, metric names, log line, element ids, fixture format). The contracts bind the core too.
  - `docs/START.md`: who takes what, the order, the morning timetable, the demo roles.
  - Issue #2: the core checklist. Tick each line when its lane exits review.
  - Issues #3, #4, #5: side work that may arrive as pull requests tonight.
- `C:\Users\ralfs\wise hackathon\wise.md`: read "Decisions" and "Build kickoff checks".
- `C:\Users\ralfs\orchestration-ledger\templates\ORCHESTRATOR-STEPS.md`: the run and monitor duties. Register the run and the monitor before the first dispatch.

Two published pages (the plan page and the screens page) were made before this scope and show an older nine-step flow. Do not build from them.

## Decided, do not reopen

- Scope is sprint one as written in `docs/CONTEXT.md`. Ralf, 13 November: "we will stick to what we sketched right now". `docs/LATER.md` lists what is not being built.
- Every call the tool makes in the demo goes to the real service: Slack, GitHub, Claude Code, Prometheus. No fake endpoint. Test helpers may fake things.
- Two problems are planted, each as a real merged commit that causes no error: the card picture flickers (low severity, the live run) and a transfer shows the wrong amount (high severity, run before the team walks on).
- The tool changes code only for a low-severity problem and only as a pull request. It merges only after the owner presses "Approve fix" in Slack; the button works for the owner's Slack account alone. For high severity it changes nothing. It never rolls back and never writes to a customer. When in doubt the verdict is high.
- The owner is found in step 5 and tagged only when the handoff is posted. In the demo the owner is Nadim: his GitHub account in the owners file, his Slack account for the button.
- Monitoring is a real Prometheus, downloaded as one program. No Grafana, no Docker, no Loki. Logs are the card app's own request lines.
- The card app runs on the demo laptop at `http://localhost:3000`, as the contracts say. Deploy on merge is a small watcher that pulls `main` when the merge lands and restarts the app. This was chosen over a cloud host because the stage allows about 20 seconds from approval to the fixed page; say so in the plan and let Ralf overrule it.
- The handoff ends with one sentence support may tell customers, as plain text.
- The stand-in product is called "Demo Bank". Nothing carries the name, logo or colours of Wise.
- The tool is one Node program in TypeScript in `tool/`, reading Slack over Socket Mode. The card app lives in its own repository under the same GitHub account and uses Ralf's default stack.
- Dropped in this order when late: the search across several repositories, then the ending on the redeployed page, then the "Approve fix" button (the owner merges on GitHub from the link in the handoff). The high-severity run is never dropped; it is the low-severity run without the fix.
- Private repositories under `marshalofthecentralaltar` and one free Slack workspace are approved. Anything paid or public needs Ralf's yes.

## State, measured 17:57 UTC on 13 November. Measure again before acting on it

- The team repository holds `README.md`, `AGENTS.md`, `CLAUDE.md`, `.gitignore`, `docs/CONTEXT.md`, `docs/START.md`, `docs/LATER.md`. Eight open issues, no pull request.
- Access: the owner and one collaborator (`jekaterinq`); two invitations pending.
- `gh`: `marshalofthecentralaltar` is the active account and owns the repository. A search call as `Prince-Nothing` answered "User flagged as spammy" at 17:15 UTC; keep that account out of the demo.
- `claude`, `node` 22, `railway` and `vercel` are on the path. `ANTHROPIC_API_KEY` is not set. No Prometheus installed. The Docker daemon is not running and is not needed.
- Sleep on mains power is set to never.
- No build folder exists. No Slack workspace exists.

## First reply: the plan. Then stop for Ralf's go

Under 250 words plus two tables.

1. One line: what changed in the state since 17:57 UTC.
2. The work order as a table by clock time, adjusted to the time now: what starts, what it needs, the proof, the decision taken at that time. Start from "The work order" below and move the times; keep the order.
3. The hand steps for Ralf as a numbered list with the exact clicks, so he can start on them while he reads the rest.
4. Which lanes run in parallel, given at most two lanes with a server or tests at once on this PC.
5. At most one question, in plain words, with your recommendation and what happens with no answer. If the grouping blank at the top is empty, it is this: "The grouping step can call Claude with an API key or through Claude Code's own login. I recommend an API key because each call returns in a second or two and the stage allows 25 seconds for four steps; the cost is small but it is your money. With no answer I use Claude Code's login, which costs nothing extra and may be too slow for the stage."

Write no code before go. After go, do not plan again; build.

## The work order

Tallinn time. The times are a plan made at 20:00 on 13 November; every duration in it is a guess until measured.

| When | What | Needs | Decision at that time |
|---|---|---|---|
| go | Lane A, the card app, starts. It needs GitHub only | Nothing | |
| go to +45 min | Hand steps with Ralf: Slack workspace and app, tokens, the clone | Ralf | |
| +45 min to 22:00 | Thin path: a message in `#support` becomes a pull request on a hello-world repository, written by `claude -p`. Timed 5 times | Slack tokens | Over 90 seconds: undoing the commit becomes the main path and the written fix follows it |
| 23:00 | Side pull requests #3, #4, #5: review each that is open with `lane-review` and use it. Build the missing ones yourself | | Never wait on one |
| 23:00 | Lanes B and C start | Lane A | |
| about 00:30 | Ralf sleeps. The `/goal` text is set. Nothing in the queue needs a person | Thin path proven | |
| night | Lane D, then lanes B and D joined, then lane F | Lanes A, B | |
| 04:00 | | | Lane D not passing: lane E is dropped |
| 06:30 | | | Lane F not passing: stop building, write the hand-off with what works |
| 07:30 | `MORNING.md` exists | | |

## Hand steps, with Ralf at the keyboard

1. Slack: he creates the workspace and a `#support` channel and invites the team. You write the app settings file (manifest) with Socket Mode, the message events and the button. He creates the app from it, installs it, and pastes the bot token and the app-level token into the secrets file you name. No secrets file is ever committed.
2. GitHub: you create the card app's private repository. He confirms the team's GitHub names; invite anyone still missing to both repositories.
3. Nadim's GitHub and Slack user names, for the owners file and the button.
4. Check the session will not stop to ask for permission during the night.
5. Before he sleeps, tell him in under 100 words what is verified, what the agents will build, and that nothing waits on a person. Give him the `/goal` text from the end of this file.

## The lanes

Dispatch with `lane-dispatch`, review with `lane-review`. Every criterion is paired with its proof. A lane report without the proof is not done.

| Lane | Builds | Proof |
|---|---|---|
| A. Card app | Three pages (card, transfers, account) with the four element ids, tests, the owners file, `/metrics` and the request log lines to the contract, both planted problems merged to `main` as real commits. If #5 has a pull request, port its design | `npm test` is green with both problems in. `curl localhost:3000/metrics` returns request counts. A browser check shows `#card-picture` is replaced within 5 seconds. An amount in `#transfers-table` differs from the stored amount |
| B. Tool, steps 1 to 5 and 9 to 10 | The report count and grouping, the monitoring and logs check, the recent changes, the owner lookup with nobody tagged, the handoff in its eight parts, the Slack post, the "Approve fix" button | One Slack thread per planted problem, each ending in a handoff in the format of the context file. Tests: a message that is not a report is ignored; the grouping test passes on the fixture from #3, or on 20 messages you write if #3 is not in; with no owner line the handoff says so and asks in the thread; no Slack message names the owner before the handoff; the handoff says the commit reverts cleanly after a clean trial revert and says it does not after a conflicting one; "Approve fix" pressed by the owner merges the pull request and pressed by anyone else changes nothing |
| C. Monitoring and deploy on merge | Prometheus reading the card app every 15 seconds, from the #4 pull request if it is open by 23:00 and otherwise built here. The watcher that pulls `main` and restarts the app | Prometheus's graph page shows the 5xx query for the card page at 0. With the app returning 500, the query is above 0 within 2 minutes. Time from merge to the new page, measured 3 times, in seconds. If Prometheus does not answer a query within 30 minutes of the lane starting, the tool reads `/metrics` directly and the report says so |
| D. Investigation, verdict and fix, steps 6 to 8 | `claude -p` in a fresh copy of the code reads the page's code, the recent commits and their pull request comments, and names the responsible commit and what is wrong. Written rules give the severity first; the model judges only what the rules leave open. Low: Claude Code writes the smallest fix, runs the tests, pushes, and the tool opens the pull request; after 60 seconds without a tested fix, a branch that undoes the commit is pushed. High: no change to code | 5 timed runs on the flicker: each names the planted commit, is judged low, and ends in a pull request; after the fix `#card-picture` is the same DOM node after 5 seconds and `#balance` still changes. 5 timed runs on the wrong amount: each names its planted commit, is judged high, and leaves no branch and no pull request. A page returning 500 is judged high. Seconds for every run |
| E. Search across repositories (dropped first) | The card app split into two or three repositories; the tool searches all of them | The app still redeploys after a merge. With the flicker commit in a repository other than the card page's own, the handoff still names it |
| F. Full runs | A test script that posts the reports for either problem to `#support` from a second Slack identity, and a reset command that closes the pull request, deletes the branch, puts both planted problems back on `main` and clears the tool's open groups | 5 consecutive runs of the flicker, each from the reset command, each ending with a handoff and a pull request link in the thread. 3 runs of the wrong amount, each ending with a handoff and no code change. Seconds per run and per step |

The tool must not treat the test script's messages differently from a person's. In the demo the reports come from phones.

## Ways this goes wrong without anything turning red

1. Tests pass and the picture still flickers. No unit test sees a flicker. Only the DOM-node check proves the fix.
2. A later run looks green because it reuses an earlier run's groups, branch or open pull request. Every counted run starts from the reset command.
3. The verdict flips between runs. A model that judges the flicker high once in five gives a demo with no fix on stage. The proof is 5 of 5 on each planted problem.
4. Monitoring and logs show nothing for both planted problems, by design. An investigation that needs a signal from them finds nothing. The evidence is the reports, the recent commits and the code.
5. The tool reads its own thread replies as new reports.
6. Slack may deliver a message posted by a bot differently from one typed by a person. A listener can pass with the test script and fail with phones, or the reverse. Lane F's proof holds only after one run typed by hand, which people do at 08:15; say so in the hand-off.
7. The watcher restarts the app while Prometheus is reading it, and one failed read looks like an error on the page. Check the query stays at 0 across a redeploy.
8. A permission prompt, an expired login or a usage limit stops the night with nobody awake. Check the first two before Ralf sleeps. Wait a usage limit out; never work around it.

Expect some fix attempts to miss 60 seconds and fall back to the undo branch. That is the planned fallback and a number to record, not a defect to chase.

## The hand-off for the morning

Write `MORNING.md` in the build folder by 07:30 Tallinn time:

1. What works, one line per step of the ten, each with its proof.
2. What was dropped and why.
3. Measured times: thin path, investigation, fix, merge to new page, full run.
4. How to start everything for a rehearsal, and the reset command, as lines to copy.
5. What only a person can check: one run with reports typed on phones, and "Approve fix" pressed by Nadim.
6. Open defects.

Then tick issue #2, post the measured times as a comment on issues #6 and #7 so their placeholders can be filled, add one dated line to `wise.md`, and stop every server and watcher the morning does not need.

## How to work

- When you have enough to act, act. After go the plan is settled.
- Before any progress claim, check it against a tool result from this session. Unverified is written as unverified. A failing test is shown with its output.
- Every number carries its source and the word measured or guess.
- Pause only for money, a credential, or anything public. Otherwise run to the end. Never end a turn on a promise to continue.
- Use `ship-any` before any push and `plain-product-copy` for anything the judges or the team will read.

## Reports

- Before Ralf sleeps: under 100 words, as in hand step 5.
- In the morning: the path to `MORNING.md` first, then a table of the ten steps with works or dropped and the proof, then the single next thing Ralf does.

## Dispositions

Open items in this prompt, as they stood at 17:57 UTC on 13 November.

| Item | Class | Status | Evidence |
|---|---|---|---|
| How the grouping step calls Claude (API key or Claude Code's login) | method-choice | choice-for-ralf | `ANTHROPIC_API_KEY` empty in the shell at 16:59 UTC. Neither path has been timed. It is his money, so he decides; with no answer the login is used |
| Where the card app runs: the demo laptop or a cloud host | method-choice | choice-for-ralf | The contracts in `docs/CONTEXT.md` give `localhost:3000`. No redeploy has been timed on either. The laptop is written in as decided because the stage allows about 20 seconds; the first reply tells Ralf and he may overrule it |
| Demo time: about 12:44 by Ralf's count, about 11:15 by the first kickoff notes | contradictory | marked-unresolved | `wise.md`, "Build kickoff checks"; Ralf's counts of 19 hours at 15:49 UTC and 18 at 16:44 UTC. Next source: an organiser, question 1 of issue #8. Until then the morning is planned for 11:15 |
| Teammates' access to the repository | missing | marked-unresolved | `gh api repos/.../collaborators` at 17:57 UTC: the owner and `jekaterinq`; two invitations pending. Hand step 2 invites whoever is missing |
| Prometheus not installed | missing | marked-unresolved | `command -v prometheus` found nothing at 16:59 UTC. Lane C supplies it, with a 30-minute cap and a fallback |
| Whether the investigation and the fix fit the 55 seconds the stage allows | unverified | marked-unresolved | No run exists. The thin path and lane D each time it 5 times |
| Time from merge to the new page | unverified | marked-unresolved | No watcher exists. Lane C measures it 3 times |
| Slack treats a bot's message differently from a typed one | unverified | marked-unresolved | Stated from memory of Slack's event format; Slack's documentation was not opened. Proved by the run typed by hand at 08:15 |
| Every clock time in "The work order" | unverified | marked-unresolved | A plan made at 20:00 Tallinn time with guessed durations. The first reply moves the times to the clock |
| The plan page and the screens page show the nine-step flow from before sprint one | defect | marked-unresolved | Both sources in `pages\` were written before 17:35 UTC and neither has been republished. This prompt tells the session not to build from them |
| Whether the sentence for support stays in sprint one | method-choice | choice-for-ralf | Ralf's description at 17:35 UTC does not mention it. It is kept as the last line of the handoff; removing it is one line in lane B |

## The /goal text for the night (Ralf pastes it before he sleeps)

```
/goal Land the overnight build described in C:\Users\ralfs\wise hackathon\NEXT-PROMPT.md: the lanes and the hand-off. It is approved; don't re-plan it.

Three ways this goes silently wrong, in order of likelihood:
1. Tests pass and the card picture still flickers, because no test sees a flicker. Only the DOM-node check over 5 seconds proves the fix.
2. A later run reuses an earlier run's Slack groups, branch or open pull request and looks green. Every counted run starts from the reset command.
3. The severity verdict flips between runs. The flicker judged high once in five means no fix on stage. Count 5 of 5.

Expect monitoring and logs to show nothing for both planted problems. That is the design, not a broken check. Expect some fix attempts to miss 60 seconds and fall back to the undo branch; record the number. Expect the search across repositories to be dropped if lane D is not passing by 04:00 Tallinn time.

Done when: 5 consecutive test-script runs of the flicker from the reset command each end with a handoff and a pull request link in the Slack thread, judged low; 3 runs of the wrong amount each end with a handoff judged high and leave no branch and no pull request; each run's seconds are in MORNING.md; a page with errors in monitoring is judged high, a missing owner is stated in the handoff, and a fix that misses 60 seconds falls back to the undo branch, each with a passing test; "Approve fix" merges for the owner and does nothing for anyone else, shown by a test; time from merge to the new page is measured 3 times and written down; MORNING.md exists with its six parts; issue #2 is ticked to match; every build repository shows main in sync with origin/main; every server and watcher not listed in MORNING.md as needed is stopped.
```
