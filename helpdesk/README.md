# Demo Bank Helpdesk

A stand-in helpdesk (issue #30). Customers write to support through a form; agents see each ticket live with all its detail; only a PII-safe version is posted to Slack `#support`, where the tool picks it up as it picks up any report. The tool itself is not changed.

    node helpdesk/serve.mjs              # http://localhost:3400 (form) and /inbox (agents)
    node helpdesk/serve.mjs --dry-run    # prints the Slack message instead of posting it
    node helpdesk/seed.mjs --problem flicker|amount|declined|mixed [--gap-seconds 3]
    node helpdesk/test.mjs               # no Slack, no Claude

- The form (`/`) answers any address, so phones on the same network can use `http://<laptop address>:3400`. The inbox, its API and the screenshots answer only this computer (`403` for others).
- The PII filter has three layers: rules (`lib/pii.mjs`), a Claude check that may only name exact substrings to remove (`lib/claude.mjs`), and a leak gate that holds the ticket if any value the customer typed is still in the text. If unsure, the ticket is held and an agent edits and sends it.
- A screenshot stays here. Claude describes it in one sentence; that sentence is filtered like the rest.
- Slack: posted as the "Support Desk" app with `SLACK_TEST_BOT_TOKEN` from the same `secrets.env` as the tool; channel `SUPPORT_CHANNEL_ID`.
- Tickets and screenshots live in `helpdesk/.state/`, ignored by git. All personal data in `seed-tickets.json` and `seed-screenshots/` is made up.
- Needs Node 22 and the `claude` command line, logged in and new enough for the tool (2.1.325 works; 2.1.191 does not). No package.

## On Windows 11

Use Command Prompt, not PowerShell, as in `docs/STAGE-SETUP.md`. The same commands work. On the first start Windows asks whether Node.js may use the network: click **Allow** (private networks), or phones cannot open the form. The server prints the address phones should use. If the venue network keeps devices apart, use a phone hotspot. `claude.exe` is found from `where claude`, the npm global folder, or Anthropic's installer folder; `CLAUDE_BIN_PATH_FOR_TOOL` overrides it.
