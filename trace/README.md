# Process screen

A local page that shows what the tool is doing, step by step, with the evidence each step found.
It is a separate program that only reads a file. If it stops, the demo carries on.

Port 3300, as issue #20 sets it.

## Run it

    node trace/serve.mjs

That follows `tool/.state/events.jsonl` and serves the page on http://localhost:3300.

    node trace/serve.mjs --file C:\some\other\events.jsonl
    node trace/serve.mjs --replay trace/sample-events.jsonl
    node trace/serve.mjs --replay trace/sample-events.jsonl --speed 2

`--replay` plays a recorded file with the pauses it recorded. `--speed 2` halves them. Use it to
build or show the page when the tool is not running.

Options: `--file <path>`, `--replay <path>`, `--speed <n>`, `--port <n>`. Node 22, built-ins only.
There is no package, no build step and nothing is loaded from the internet.

## What it shows

- The newest run only. A line with a new `groupId` clears the page and starts again.
- The steps in the order of the issue: reports, monitoring, changes, owner, investigation,
  verdict, fix, handoff, approval, deploy, proof. A step name the page does not know gets a plain
  row after these.
- For each step: waiting, running with a clock that counts, done with the seconds the line
  reports, or failed with the line's error. A live line's own time starts its clock. In a replay
  the recorded times are old, so the clock counts from when the line arrived.
- Under each step, the evidence as plain labelled values: the monitoring query and its answer,
  the commits weighed, the commit named and why, the verdict, the diff.
- Before the first line: "Waiting for the first reports". A file that does not exist yet is not
  an error.

Every field may be missing or null; the page shows what is there and skips the rest. A line that
is not JSON is counted and skipped, and the page keeps running. The page reconnects on its own if
the connection drops, and reads the run so far when it opens.

## The file

One JSON object per line, written by `tool/src/events.ts`:

    {"v":1,"at":"2026-11-14T00:02:14.476Z","groupId":"group-1","step":"reports","state":"done",
     "seconds":5.8,"evidence":{...}}

`state` is `start`, `done` or `failed`. `done` and `failed` add `seconds`; `done` usually adds
`evidence`, `failed` adds `error`. A real run uses `<group id>@<startedAt>` as its `groupId`, so a
second run of the same group is a new run. Any change of `groupId` is treated as a new run.

`trace/sample-events.jsonl` is a whole low-severity run for building against. Its values are made
up. It plays over 53.4 seconds between its first and last line (measured with `node -e` on its
`at` fields).

## Files

- `serve.mjs`: the server. Tails the file, adds no newline assumptions beyond one JSON object per
  line, and pushes each line to the page over server-sent events. It also answers
  `GET /api/events` with the run so far, for inspection.
- `index.html`: the one page. Plain JavaScript and CSS, no frameworks.
- `sample-events.jsonl`: the sample run.

## Shell

Run it in Command Prompt (cmd.exe) or PowerShell on Windows 11; both are tested. The server prints
the file it follows and the address to open. Stop it with Ctrl+C.
