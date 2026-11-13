# Project context

Read this completely before starting any issue. Status on 13 November 2026, 17:30 UTC: nothing is built.

## What we are building

A tool for support and development teams. It reads customer reports in a Slack channel, groups the ones about the same small problem, checks that monitoring shows nothing, finds the team that owns the page and the recent change behind the problem, has Claude Code write a fix, opens a pull request, and gives support one sentence to tell the customers.

It is our entry for the Wise hackathon in Tallinn, theme "Max Ease". We demo it live for three minutes on 14 November 2026 at about 12:44 Tallinn time. The time is not confirmed and may be 11:15 (issue #8 asks).

## Why

Wise engineers told us that monitoring catches the large failures and that small problems slip through: a card picture flickers, no error fires, each support agent sees one report, and nobody joins them up. The tool targets those small problems only.

## The one run we demo

1. Three support agents each post one customer report in Slack `#support`: the card picture flickers on the card page.
2. The tool groups the three into one problem.
3. It asks Prometheus whether the card page shows errors. It shows none.
4. It reads the owners file (CODEOWNERS) and finds who owns the card page.
5. It finds the recent change that fits the reports: "Card: refresh the balance every second".
6. Claude Code writes the fix and runs the tests, with no person at the keyboard.
7. The tool opens a pull request and requests a review from the owner.
8. It tags the owner in Slack, says whether the change can be undone cleanly, and gives support one sentence for customers. A support lead approves the wording.
9. The owner merges. The card app redeploys and the picture stops flickering.

Drawings of the six screens the audience sees: https://claude.ai/artifact/3qLwbjNP7LEtCRZNCZe7mD

## What is real, what stands in, what is out

| Kind | What | In the demo |
|---|---|---|
| The tool | One Node program (TypeScript) on one laptop | Makes every call in steps 2 to 8 |
| Real service | Slack | A new workspace, a `#support` channel, our bot |
| Real service | GitHub | Private repositories, the owners file, real commits, a real pull request |
| Real service | Claude and Claude Code | Claude groups the messages, Claude Code writes the fix |
| Real service | Prometheus | Reads the card app every 15 seconds. Its own graph page is the green screen on stage |
| Real service | A host that redeploys on merge | The card app goes live again after the merge |
| Stand-in | The card app | Three pages we write. It stands in for a product page |
| Stand-in | The owners file | Stands in for a company's map from web path to team |
| Stand-in | The three of us on phones | We type as support agents passing on what customers said |
| Stand-in | The flicker | Planted by us as a real merged change |
| Out | Grafana, Zendesk, Twilio, Rollbar, Loki | Not built, not connected |
| Out | The alert flow | No rollback button, no paging, no postmortem |
| Out | Messages to customers | The tool gives support a sentence and writes to no customer |

## Rules that hold everywhere

- Every call the tool makes during the demo goes to a real service. The scoring sheet gives 2 of 4 on technical for hardcoded shortcuts. Test helpers may fake things; the demo path may not.
- Nothing we make carries the name, logo or colours of Wise or of any real company. The stand-in product is called "Demo Bank".
- The tool never merges, never rolls back and never writes to a customer. A person merges.
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

- The core path (the tool, the card app, the Slack app, the fix step, deploy on merge, full runs) is built by the repository owner, with Claude. Issue #2 tracks it. Do not start on anything listed there.
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

### Elements on the card app's pages

- The card picture: `id="card-picture"`
- The balance: `id="balance"`
- The transfers table: `id="transfers-table"`
- The account holder's name: `id="account-name"`

### Problems and pages

| Page | Path | Problem slug used in tests |
|---|---|---|
| card | `/card` | `card-picture-flicker` |
| transfers | `/transfers` | `transfers-wrong-date` |
| account | `/account` | `account-name-cut-off` |

Only `card-picture-flicker` is planted in the demo. The other two exist so tests can check that the tool keeps different problems apart.

### Support message fixture

`fixtures/reports.json` is an array of objects:

```json
{ "id": "r01", "text": "Customer says the picture of her card keeps blinking on the card page.", "lang": "en", "is_report": true, "page": "card", "problem": "card-picture-flicker" }
```

`lang` is `en`, `et` or `ru`. `page` is `card`, `transfers`, `account` or `null`. `problem` is a slug or `null`. When `is_report` is `false`, `page` and `problem` are `null`.

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
