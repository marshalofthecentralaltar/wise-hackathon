# Wise hackathon: from customer reports to a fix or a handoff

A tool for support and development teams. It reads customer reports in a Slack channel and notices when several are about the same problem. It checks monitoring and logs, reads the recent changes, finds the owning team, and investigates in the code until it can name the commit responsible. A low-severity problem it fixes and offers for approval. A high-severity problem it does not touch; it hands the team a written account of what it found.

Status on 13 November 2026, 17:45 UTC: nothing is built. This repository holds the context and the issues.

## Where to start

1. Read [`docs/CONTEXT.md`](docs/CONTEXT.md) completely.
2. Pick an open issue labelled `side-feature` or `needs-person` and comment "taking this".
3. Follow "How to work on an issue" in the context file.

Who does what and in what order is in [`docs/START.md`](docs/START.md). If you work with a coding agent, [`AGENTS.md`](AGENTS.md) holds its instructions.

## AI use

This project is built with Claude and Claude Code, and the tool itself calls Claude while it runs.
