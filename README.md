# Wise hackathon: from a customer's report to a pull request

A tool for support and development teams. It reads customer reports in a Slack channel, groups the ones about the same small problem, checks that monitoring shows nothing, finds the owning team and the recent change behind the problem, has Claude Code write a fix, opens a pull request, and gives support one sentence to tell the customers.

Status on 13 November 2026, 17:30 UTC: nothing is built. This repository holds the context and the issues.

## Where to start

1. Read [`docs/CONTEXT.md`](docs/CONTEXT.md) completely.
2. Pick an open issue labelled `side-feature` or `needs-person` and comment "taking this".
3. Follow "How to work on an issue" in the context file.

If you work with a coding agent, [`AGENTS.md`](AGENTS.md) holds its instructions.

## AI use

This project is built with Claude and Claude Code, and the tool itself calls Claude while it runs.
