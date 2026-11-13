# Who does what, and in what order

Written 13 November 2026, 18:00 UTC (20:00 Tallinn time). Nothing is built. The names against the issues are a proposal from the core build; change the table if the team decides otherwise.

All times below are Tallinn time.

## Who takes what

| Person | Works with | First task | Second task |
|---|---|---|---|
| Ralf | Claude Code | #2, the core build | Reviews every pull request |
| Nadim | Claude Code | #4, the Prometheus kit | In the demo: sits at the laptop and approves the fix as the owner |
| Roger | Codex | #3, the support messages | #7, the runbook |
| Diana | Codex | #5, the card app page designs | #7 with Roger: the checklists and the backup recording |
| Kata | ChatGPT and GitHub in the browser | #8, questions 1 to 3, tonight at the venue | #6, the pitch and the question sheet |

The core build never waits for a side task. A side pull request that is open by 23:00 tonight is used by the night build. A piece that is not open by then is built by the core, and the issue is closed.

## The order

### Step 1. Now, about 20 minutes. Everyone gets in

1. Send your GitHub user name to Ralf and accept the invitation to this repository.
2. Ralf creates the Slack workspace. Join it on your phone and your laptop.
3. Read [`CONTEXT.md`](CONTEXT.md) completely.
4. Comment "taking this" on your first issue.
5. Kata goes to an organiser with questions 1 to 3 of #8 before anything else. They may leave for the night, and the three answers change what is built.

### Step 2. Tonight, until 23:00

| Who | Does | Done when |
|---|---|---|
| Ralf | The Slack app, then the thin path: a message in `#support` becomes a pull request written by Claude Code. Then starts the card app and the tool | Five pull request links with their times in seconds |
| Nadim | #4 | Pull request open by 23:00 |
| Roger | #3 | Pull request open by 23:00 |
| Diana | #5 | Pull request open by 23:00 |
| Kata | #8: the answers as comments on the issue. Then starts #6 | Questions 1 to 3 answered tonight |

### Step 3. The night

The core is built in this order. Each line needs the one above it.

1. The card app with its two planted problems: the flickering card picture and the wrong transfer amount.
2. The tool, steps 1 to 5: reports, pattern, monitoring and logs, recent changes, the owner.
3. Steps 6 to 8: the investigation in the code, the severity verdict, the fix for low severity.
4. Steps 9 and 10: the handoff, the Slack post, the "Approve fix" button.
5. Full runs from a reset: five of the flicker, three of the wrong amount, each timed.

Everyone else sleeps.

### Step 4. The morning

These times assume the demo is at 11:15. If question 1 of #8 comes back as 12:44, keep the times and use the extra 90 minutes for rehearsals.

| Time | What | Who |
|---|---|---|
| 07:30 | Read the hand-off file. Post in Slack what works, what was dropped and the measured times | Ralf |
| 08:00 | Pull requests for #6 and #7 open. Their placeholders are filled in from the hand-off file | Kata, Roger, Diana |
| 08:15 | First full run with people: three reports typed on phones, the fix approved by Nadim | Everyone |
| 08:30 | Fix what that run showed. The others rehearse the words | Ralf; everyone else |
| 09:30 | The code stops changing | |
| 09:30 | Five timed rehearsals. Record the backup run | Everyone |
| 10:30 | Pack: two laptops logged in to Slack and GitHub, adapters, the recording on both | Diana |
| 11:15 | The demo | |

## Roles in the demo

A proposal. The team decides tonight.

| Person | During the three minutes |
|---|---|
| Ralf | Speaks, and answers the judges' questions |
| Nadim | At the laptop. Switches between the windows and, as the owner of the card page, presses "Approve fix" |
| Roger, Diana, Kata | Each sends one report from a phone at 0:20, from a draft saved beforehand |
| Kata | Also keeps the time and starts the backup recording if the network fails |

The owner of the card page in the owners file is Nadim's GitHub account, and "Approve fix" works only for Nadim's Slack account. If someone else takes that role, both change.

## How to start on your issue

**With Claude Code or Codex**

1. Clone this repository and open it in your agent.
2. Paste the line at the bottom of your issue. It tells the agent what to read and when to stop.
3. Check the proof output yourself before you open the pull request.

**With ChatGPT and no coding agent**

1. Open your issue and copy its whole text into ChatGPT, together with the text of `docs/CONTEXT.md`.
2. Ask it to write the files the issue lists.
3. On GitHub in the browser: "Add file", "Create new file", paste the text, choose "Create a new branch", and open a pull request with the title the issue gives.
4. For #8 there are no files. Write each answer as a comment on the issue.

## When something is unclear

Comment on the issue. Do not guess and do not wait: if 20 minutes pass with no answer, write down what you assumed and carry on.
