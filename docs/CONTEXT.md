# Project context

Read this completely before starting any issue. Status on 13 November 2026, 17:45 UTC: nothing is built. The run below is the scope of the first sprint, set by the repository owner at 17:35 UTC.

## What we are building

A tool for support and development teams. It reads customer reports in a Slack channel and notices when several are about the same problem. It checks monitoring and logs, reads the recent changes, finds the owning team, and investigates in the code until it can name the commit responsible. Then it judges how serious the problem is. A low-severity problem it fixes and offers the fix for approval. A high-severity problem it does not touch; it hands the team a written account of what it found.

It is our entry for the Wise hackathon in Tallinn, theme "Max Ease". We demo it live for three minutes on 14 November 2026 at about 12:44 Tallinn time. The time is not confirmed and may be 11:15 (issue #8 asks).

## Why

Wise engineers told us that monitoring catches the large failures and that small problems slip through: a card picture flickers, no error fires, each support agent sees one report, and nobody joins them up. The tool starts from what customers report.

## The run, step by step

1. **Reports arrive.** Support agents post customer reports in Slack `#support`. The tool acts when one group of reports reaches a set number: 3 in the demo.
2. **Pattern.** The tool decides which reports are about the same problem and which page it is on.
3. **Monitoring and logs.** It asks Prometheus about that page (errors, response time, firing alerts) and reads the card app's logs for the last hour. It records what it finds. Finding nothing is a normal result: both problems in our demo return 200 and log no error.
4. **Recent changes.** It lists the commits and deploys of the last 7 days.
5. **Owner.** It finds the service and the owning team in the owners file (CODEOWNERS). It notes the owner and tells nobody yet.
6. **Investigation.** Claude Code, in a fresh copy of the repository, reads the code of that page, the recent commits and the comments on their pull requests. It names the commit responsible and what is wrong in the code.
7. **Verdict.** The tool gives the problem a severity, with the reason.
8. **Fix, low severity only.** Claude Code writes the smallest change that fixes it, runs the tests, and the tool opens a pull request. For high severity nothing in the code is changed.
9. **Handoff.** The tool writes one handoff (format below).
10. **Slack.** It posts the handoff in the thread and tags the owner. For low severity the post carries an "Approve fix" button. When the owner presses it, the tool merges the pull request and the card app redeploys.

### Severity

| Severity | When | What the tool does |
|---|---|---|
| high | A figure, a balance, a payment or a customer's data is wrong or at risk. Or monitoring shows errors on the page. Or the tool cannot name the responsible commit | Handoff only. No change to code |
| low | Appearance or wording. No figure and no action is wrong | Fix, then handoff with the option to approve |

When in doubt the verdict is high.

### The handoff

Posted to Slack as one message, in this order:

1. The problem in one sentence, and the severity with its reason.
2. Reports: how many, with links to the messages.
3. Monitoring and logs: what each showed, or "nothing".
4. Origin: the commit responsible, its author, when it was merged, and whether it reverts cleanly.
5. The problem in the code: file, lines, and what is wrong.
6. Next steps the tool suggests.
7. Low severity only: the pull request link and the "Approve fix" button.
8. One sentence support may tell the customers.

### The two problems we plant

| Problem slug | Page | Severity | What customers see | Use |
|---|---|---|---|---|
| `card-picture-flicker` | card | low | The card picture blinks once a second | The live demo |
| `transfers-amount-wrong` | transfers | high | A transfer in the list shows the wrong amount | Run before we walk on; its handoff is shown during the live run |

Each is planted as a real merged commit. Neither causes an error or a slow request.

The drawings at https://claude.ai/artifact/3qLwbjNP7LEtCRZNCZe7mD were made before this scope. Screens 1, 2 and 6 still hold. The Slack thread in screen 3 now ends in the handoff and the "Approve fix" button, and the owner approves in Slack where screen 4 shows a merge on GitHub.

## What is real, what stands in, what is out

| Kind | What | In the demo |
|---|---|---|
| The tool | One Node program (TypeScript) on one laptop | Makes every call in steps 1 to 10 |
| Real service | Slack | A new workspace, a `#support` channel, our bot |
| Real service | GitHub | Private repositories, the owners file, real commits, a real pull request |
| Real service | Claude and Claude Code | Claude groups the reports and gives the verdict. Claude Code investigates and writes the fix |
| Real service | Prometheus | Reads the card app every 15 seconds. Its own graph page is the monitoring screen on stage |
| Real | The card app's logs | One line per request, written by the running app |
| Real | Deploy on merge | The card app runs on the demo laptop. A small watcher pulls `main` when the merge lands and restarts it |
| Stand-in | The card app | Three pages we write. It stands in for a product |
| Stand-in | The owners file | Stands in for a company's map from web path to service to team |
| Stand-in | The three of us on phones | We type as support agents passing on what customers said |
| Stand-in | The two planted problems | Planted by us as real merged commits |
| Out | Grafana, Loki, Zendesk, Twilio, Rollbar | Not built, not connected. Prometheus answers the monitoring question and the app's own log file answers the log question |
| Out | Rolling a change back, paging, postmortems | The handoff may suggest a revert. The tool never does one |
| Out | Messages to customers | The tool gives support a sentence and writes to no customer |

## Rules that hold everywhere

- Every call the tool makes during the demo goes to a real service. The scoring sheet gives 2 of 4 on technical for hardcoded shortcuts. Test helpers may fake things; the demo path may not.
- Nothing we make carries the name, logo or colours of Wise or of any real company. The stand-in product is called "Demo Bank".
- The tool changes code only for a low-severity problem, and only as a pull request. It merges that pull request only after the owner presses "Approve fix" in Slack. The button works for the owner named in the handoff and for nobody else.
- For a high-severity problem the tool changes nothing.
- The tool never rolls back and never writes to a customer.
- The demo uses no slides. Leaning on slides scores 2 of 4 on the pitch.
- AI use is disclosed.
- No secret goes into the repository. `.env` files are ignored by git.

## How we are scored

| Category | Weight |
|---|---|
| Friction removed from an everyday experience | 40% |
| Technical: a working end-to-end prototype on real services | 25% |
| Pitch: a live demo of the main journey | 25% |
| Creativity | 10% |

## Who builds what

- The core path (the tool, the card app, the Slack app, the investigation and fix, deploy on merge, full runs) is built by the repository owner, with Claude. Issue #2 tracks it. Do not start on anything listed there.
- Side features are the issues labelled `side-feature`. Each is independent of the core path and of the other side features. The core team reviews them after they arrive.
- `needs-person` marks work only a person can do.

## Repository layout

| Folder | What | Who |
|---|---|---|
| `tool/` | The tool | core, issue #2 |
| `fixtures/` | Support messages for tests | issue #3 |
| `monitoring/` | Prometheus settings and scripts | issue #4 |
| `design/card-app/` | Static page designs for the card app | issue #5 |
| `docs/` | This file, the pitch, the question sheet, the runbook | issues #6 and #7 |

The card app itself lives in its own repositories, created by the core build. Do not add it here.

## Contracts

These are fixed. Build to them exactly, so that separate pieces fit without changes.

### Addresses on the demo laptop

- Card app: `http://localhost:3000`. Pages: `/card`, `/transfers`, `/account`.
- Card app metrics: `GET http://localhost:3000/metrics`, Prometheus text format.
- Prometheus: `http://localhost:9090`.

### Metrics the card app exposes

- Counter `http_requests_total` with labels `method`, `path`, `status`. Example: `http_requests_total{method="GET",path="/card",status="200"} 42`
- Histogram `http_request_duration_seconds` with labels `method`, `path`.
- The query the tool sends: `sum(rate(http_requests_total{path="/card",status=~"5.."}[1h]))`

### Log lines the card app writes

One JSON object per line, one line per request:

```json
{"time":"2026-11-14T09:30:00.000Z","level":"info","method":"GET","path":"/card","status":200,"ms":12}
```

`level` is `info`, `warn` or `error`. Where the lines are kept and how the tool reads them is decided by the core build.

### Elements on the card app's pages

- The card picture: `id="card-picture"`
- The balance: `id="balance"`
- The transfers table: `id="transfers-table"`
- The account holder's name: `id="account-name"`

### Problems, pages and severity

| Page | Path | Problem slug | Severity | Planted |
|---|---|---|---|---|
| card | `/card` | `card-picture-flicker` | low | yes |
| transfers | `/transfers` | `transfers-amount-wrong` | high | yes |
| card | `/card` | `card-payment-declined` | high | no, tests only |
| account | `/account` | `account-name-cut-off` | low | no, tests only |

### Support message fixture

`fixtures/reports.json` is an array of objects:

```json
{ "id": "r01", "text": "Customer says the picture of her card keeps blinking on the card page.", "lang": "en", "is_report": true, "page": "card", "problem": "card-picture-flicker", "severity": "low" }
```

`lang` is `en`, `et` or `ru`. `page` is `card`, `transfers`, `account` or `null`. `problem` is a slug or `null`. `severity` is `low`, `high` or `null`; it is set for the four problems in the table above and `null` for every other message. When `is_report` is `false`, `page`, `problem` and `severity` are `null`.

## How to work on an issue

1. Comment "taking this" on the issue before you start.
2. Branch from `main` as `issue-<number>-<short-name>`.
3. Touch only the folder the issue names.
4. Use Node 22 and no dependencies unless the issue allows them.
5. Run every proof command in the issue. Paste each command and its output into the pull request description.
6. Open a pull request to `main` titled `#<number> <issue title>` with `Closes #<number>` in the description.
7. Do not merge your own pull request. The core team reviews it.
8. If you are stuck for more than 20 minutes, comment on the issue with what you tried.

## Writing rules for anything a judge or a teammate reads

- Plain statements. Headings name their content. No slogans.
- No em dashes.
- Every number carries its source and the word "measured" or "guess".
- A plan is written as a plan. Nothing is described as working until a command has shown it working.
