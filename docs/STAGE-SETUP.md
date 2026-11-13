# Stage laptop setup

What one person does on the stage laptop, in order, to make it run the demo. The laptop is a
Windows laptop of a teammate (Nadim or Roger), set up on the morning of 14 November 2026. It
takes about 20 minutes when nothing is missing (guess; the steps below say which times were
measured on the build PC on 13 November and which are guesses).

Every line in a grey box is pasted into a terminal. "Terminal" means Windows Terminal or
PowerShell, opened from the Start menu. After an install step, close the terminal and open a new
one, so the new program is found.

The demo itself (who says what, what to do when a step fails) is in [runbook.md](runbook.md).
The addresses, channel and repository names are in [CONTEXT.md](CONTEXT.md), section "Contracts".

## 1. Install the programs (about 8 minutes, guess)

Paste each line. Each one asks once for permission to change the computer; click Yes. A program
that is already installed is reported as such and nothing changes.

| Program | Line to paste | Package checked on the build PC |
|---|---|---|
| Node.js 22 | `winget install --id OpenJS.NodeJS.22 -e` | yes, `winget show` found version 22.23.5 (13 Nov, 22:51 UTC) |
| Git | `winget install --id Git.Git -e` | yes, version 2.56.0.4 |
| GitHub command line | `winget install --id GitHub.cli -e` | yes, version 2.104.0 |
| Google Chrome | `winget install --id Google.Chrome -e` | yes, version 157.0.8103.79 |

Microsoft Edge comes with Windows 11, and the browser check uses Edge when Chrome is missing, so
Chrome is only needed if Edge was removed (`winget show --id Microsoft.Edge -e` was also checked:
version 156.0.4314.58). The output of each check is in `tool/artifacts/stage-winget.txt` of the
build lane (that folder is not committed).

Then close the terminal and open a new one, and install Claude Code with npm, which is how it is
installed on the build PC (version 2.1.325, from npm):

```
npm install -g @anthropic-ai/claude-code
```

Takes about 1 minute (guess). Anthropic's own installer (`irm https://claude.ai/install.ps1 | iex`)
also works for the tool, which finds either kind (not checked on this laptop type).

Last, stop Claude Code from updating itself in the middle of the demo (it did once on 13 Nov):

```
setx DISABLE_AUTOUPDATER 1
```

Close the terminal and open a new one. Takes 10 seconds.

## 2. Log in to GitHub (about 2 minutes, guess)

```
gh auth login
```

Answer: GitHub.com, HTTPS, "Yes" to authenticate Git, "Login with a web browser". Copy the code
it shows, press Enter, paste the code in the browser and approve. Log in as the teammate whose
laptop this is (`nadimmetwalli` or `rogerpurtsak`).

## 3. Accept the invitation to the card app (1 minute, guess)

The tool pushes a branch to the card app and opens a pull request there, so the GitHub account
from step 2 needs write access. The owner has sent an invitation; it has to be accepted once. In
the browser, logged in to github.com as that same account, open:

https://github.com/marshalofthecentralaltar/demo-bank-card-app/invitations

Click "Accept invitation". If the page says there is no invitation, ask the owner to send one to
that account; the demo cannot open a pull request without it.

The tool's own repository is private too (checked 13 Nov), so the same account needs access to
it before step 5: if it is not already a collaborator, accept that invitation as well at
https://github.com/marshalofthecentralaltar/wise-hackathon/invitations.

## 4. Log in to Claude Code (about 2 minutes, guess)

```
claude
```

It opens a browser page. Log in with the teammate's own Claude account (the person whose laptop
this is), come back to the terminal, and when it shows its prompt type `/exit`.

## 5. Make the build folder and get the code (about 1 minute; the clone took 3 s on the build PC, measured)

The build folder holds the code, the secrets file and the card app's running copy. Any folder
works; this page uses `C:\wise-build`.

```
mkdir C:\wise-build
cd C:\wise-build
git clone https://github.com/marshalofthecentralaltar/wise-hackathon.git
```

The repository is private: the clone works once step 2 is done with an account that can read it.

## 6. Install the tool's packages (about 1 minute on a new laptop, guess; 5 s measured on the build PC with its download cache full)

```
cd C:\wise-build\wise-hackathon\tool
npm ci
```

## 7. The secrets file (about 3 minutes, guess)

Run the quick, offline readiness check once (about 10 seconds, guess); when the secrets file does
not exist yet it makes an empty one with the four names:

```
npm run doctor -- --offline
```

It prints `MISSING secrets file: C:/wise-build/secrets.env did not exist; created it ...`. Open
that file in Notepad:

```
notepad C:\wise-build\secrets.env
```

It holds four lines. Paste each token right after its `=` sign, with no spaces or quotes:

| Line | Where the value comes from |
|---|---|
| `SLACK_BOT_TOKEN=` | api.slack.com/apps, app "Innovative Bug Fixer", "OAuth & Permissions", "Bot User OAuth Token" (starts with `xoxb-`) |
| `SLACK_APP_TOKEN=` | the same app, "Basic Information", "App-Level Tokens", the token there (starts with `xapp-`); the app uses Socket Mode |
| `SLACK_TEST_BOT_TOKEN=` | app "Support Desk", "OAuth & Permissions", "Bot User OAuth Token" (starts with `xoxb-`) |
| `GROUPING_ANTHROPIC_KEY=` | leave empty; it is not used |

Opening the app pages needs a Slack account that is a collaborator on both apps in the workspace
"Innovative Bug Fixer". Copy the tokens from those pages yourself. Never send the file or a token
through Slack, email or a chat in the clear; if a token must travel, use a password manager's
share. Save the file and close Notepad.

## 8. Check the laptop is ready (about 1 minute, guess; up to 2 minutes the first time)

```
npm run doctor
```

One line per item. `OK` is fine. `MISSING` names the exact fix: do it, then run the line again
until the last line reads `READY: nothing is missing.`. A `WARN` about `DISABLE_AUTOUPDATER` means
step 1's `setx` line was skipped or the terminal was not reopened. The first run also prepares
the packages the fix step needs (about 18 s when it has to install them, measured 13 Nov), so the
demo does not wait for them.

What it checks: Node 22 or newer, git, the GitHub command line logged in with push access to the
card app and read access to the tool's repository, Claude Code answering one short question,
Chrome or Edge starting for the browser check, the secrets file and its three tokens (shown by
length only, never the value), Slack accepting both tokens, `#support` found, the card page's
owner found in Slack, ports 3000 and 9090 free, and `DISABLE_AUTOUPDATER`.

A busy port 3000 or 9090 means the demo (or a copy of the card app or Prometheus) is already
running: stop it with the stop command below, then run the doctor again.

## 9. Start, reset and stop the demo (time added at the join)

Added by the orchestrator at the join (another part of the work builds these commands):

- Start: `ADDED BY THE ORCHESTRATOR AT THE JOIN`
- Reset between rehearsals: `ADDED BY THE ORCHESTRATOR AT THE JOIN`
- Stop: `ADDED BY THE ORCHESTRATOR AT THE JOIN`

## Settings a laptop may need

None by hand on a laptop set up as above (measured on the build PC on 13 Nov: a fresh clone in a
folder not named `wise-build` ran the offline doctor, which named the missing secrets file and
created it there, then passed the type check and all 241 tests, and connected to Slack). These exist for unusual layouts:

| Variable | What it changes | Default |
|---|---|---|
| `WISE_BUILD_DIR` | the build folder | the folder above the `wise-hackathon` checkout |
| `WISE_SECRETS_FILE` | the secrets file | `<build folder>/secrets.env` |
| `CARD_APP_DEPLOY_DIR` | the card app's running copy | `<build folder>/demo-bank-card-app-deploy` |
| `CHECK_FLICKER` | the browser check | `tool/checks/check-flicker.mjs` |
| `CLAUDE_BIN_PATH_FOR_TOOL` | the Claude Code program, when the tool cannot find it | found with `where claude` |

A value set in the terminal wins over the secrets file.

## On a Mac

None of this was tested on a Mac. The differences, each not tested on a Mac:

- Install with Homebrew instead of winget: `brew install node@22 git gh`, then
  `npm install -g @anthropic-ai/claude-code` (not tested on a Mac).
- Chrome from https://www.google.com/chrome; Edge is not built in (not tested on a Mac).
- Instead of `setx DISABLE_AUTOUPDATER 1`: `echo 'export DISABLE_AUTOUPDATER=1' >> ~/.zshrc`, then
  open a new terminal (not tested on a Mac).
- The build folder: `mkdir ~/wise-build && cd ~/wise-build`, then the same clone line (not tested on a Mac).
- Edit the secrets file with `open -e ~/wise-build/secrets.env` (not tested on a Mac).
- A busy port: `lsof -i :3000` shows the program holding it (not tested on a Mac).
