#!/usr/bin/env node
// Process screen: one page that shows a run of the tool as it happens.
//
// It reads the events file the tool appends to (one JSON line per step start and finish) and
// pushes each parsed line to the page over server-sent events. It never writes the file, never
// calls the tool and never fails the demo: a line it cannot read is counted and skipped.
//
// Node built-ins only. No package, no build step, nothing loaded from the internet.
//
//   node trace/serve.mjs
//   node trace/serve.mjs --file some/events.jsonl
//   node trace/serve.mjs --replay trace/sample-events.jsonl --speed 2
//
// Options: --file <path>, --replay <path>, --speed <n>, --port <n>. Defaults: port 3300,
// tool/.state/events.jsonl, speed 1.

import { createServer } from 'node:http';
import { open, readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const DEFAULT_FILE = join(ROOT, 'tool', '.state', 'events.jsonl');
const PAGE = join(HERE, 'index.html');

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  if (i === -1) return null;
  const value = args[i + 1];
  return value === undefined || value.startsWith('--') ? null : value;
};

if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: node trace/serve.mjs [--file <path>] [--replay <path>] [--speed <n>] [--port <n>]');
  console.log('  --file    events file to follow (default tool/.state/events.jsonl)');
  console.log('  --replay  recorded events file to play with its real pauses');
  console.log('  --speed   replay speed, 2 halves the pauses (default 1)');
  console.log('  --port    port to serve on (default 3300)');
  process.exit(0);
}

const replayPath = opt('--replay');
const file = resolve(replayPath ?? opt('--file') ?? DEFAULT_FILE);
const port = Number.parseInt(opt('--port') ?? '3300', 10);
const speedRaw = Number.parseFloat(opt('--speed') ?? '1');
const speed = Number.isFinite(speedRaw) && speedRaw > 0 ? speedRaw : 1;
const mode = replayPath ? 'replay' : 'live';

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`[trace] not a port: ${opt('--port')}`);
  process.exit(1);
}

const displayPath = file.startsWith(ROOT + sep) ? file.slice(ROOT.length + 1).split(sep).join('/') : file;

let page;
try {
  page = await readFile(PAGE, 'utf8');
} catch (err) {
  console.error(`[trace] cannot read the page beside this script (${PAGE}): ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}

// Every parsed line, so a page that opens mid-run gets the run so far.
const events = [];
const clients = new Set();
const state = { exists: false, skipped: 0 };
const MAX_EVENTS = 5000;

function broadcast(payload) {
  const frame = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) {
    try {
      res.write(frame);
    } catch {
      clients.delete(res);
    }
  }
}

let warned = false;
function warnOnce(message) {
  if (warned) return;
  warned = true;
  console.error(`[trace] ${message}`);
}

/** Takes one line from the file. A line that is not a usable event is counted and skipped. */
function accept(raw, note = '') {
  const text = raw.trim();
  if (text === '') return;
  let line;
  try {
    line = JSON.parse(text);
  } catch {
    state.skipped += 1;
    console.error(`[trace] skipped a line that is not JSON${note}: ${text.slice(0, 120)}`);
    broadcast({ type: 'skipped', count: state.skipped });
    return;
  }
  if (
    line === null ||
    typeof line !== 'object' ||
    Array.isArray(line) ||
    typeof line.step !== 'string' ||
    line.step === '' ||
    typeof line.state !== 'string' ||
    line.state === '' ||
    typeof line.groupId !== 'string' ||
    line.groupId === ''
  ) {
    state.skipped += 1;
    console.error(`[trace] skipped a line without a step, state or groupId${note}: ${text.slice(0, 120)}`);
    broadcast({ type: 'skipped', count: state.skipped });
    return;
  }
  events.push(line);
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  const seconds = typeof line.seconds === 'number' ? ` ${line.seconds}s` : '';
  console.log(`[trace] ${line.groupId} ${line.step} ${line.state}${seconds}`);
  broadcast({ type: 'line', line });
}

function markExists(exists) {
  if (state.exists === exists) return;
  state.exists = exists;
  broadcast({ type: 'status', exists, skipped: state.skipped });
}

/** Reads what was appended since the last read. Called on a timer, so a missing file is fine. */
let reading = false;
let offset = 0;
let pending = Buffer.alloc(0);

async function poll() {
  if (reading) return;
  reading = true;
  try {
    let info;
    try {
      info = await stat(file);
    } catch (err) {
      if (err.code !== 'ENOENT') warnOnce(`cannot read ${file}: ${err.message}`);
      markExists(false);
      return;
    }
    if (!info.isFile()) {
      markExists(false);
      return;
    }
    markExists(true);
    if (info.size < offset) {
      // The file was emptied: the run it held is gone, so the page starts again.
      offset = 0;
      pending = Buffer.alloc(0);
      events.length = 0;
      broadcast({ type: 'reset', reason: 'the file was emptied' });
    }
    if (info.size === offset) return;
    const handle = await open(file, 'r');
    let chunk;
    try {
      chunk = Buffer.alloc(info.size - offset);
      let done = 0;
      while (done < chunk.length) {
        const { bytesRead } = await handle.read(chunk, done, chunk.length - done, offset + done);
        if (bytesRead === 0) break;
        done += bytesRead;
      }
      chunk = chunk.subarray(0, done);
    } finally {
      await handle.close();
    }
    offset += chunk.length;
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    let at;
    while ((at = pending.indexOf(0x0a)) !== -1) {
      const raw = pending.subarray(0, at).toString('utf8').replace(/\r$/, '');
      pending = pending.subarray(at + 1);
      accept(raw);
    }
  } catch (err) {
    warnOnce(`cannot follow ${file}: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    reading = false;
  }
}

/** Replay: the recorded lines, each after the pause the file says was between them. */
async function loadReplay(path) {
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    console.error(`[trace] cannot read the replay file ${path}: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
  const records = [];
  for (const raw of text.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (trimmed === '') continue;
    try {
      const line = JSON.parse(trimmed);
      if (line !== null && typeof line === 'object' && typeof line.step === 'string' && line.step !== '') records.push(line);
      else {
        state.skipped += 1;
        console.error(`[trace] replay skipped a line without a step: ${trimmed.slice(0, 120)}`);
      }
    } catch {
      state.skipped += 1;
      console.error(`[trace] replay skipped a line that is not JSON: ${trimmed.slice(0, 120)}`);
    }
  }
  let previous = null;
  let due = 0;
  const scheduled = records.map((line) => {
    const at = Date.parse(line.at);
    if (!Number.isNaN(at)) {
      if (previous !== null) due += Math.max(0, at - previous) / speed;
      previous = at;
    }
    return { line, due };
  });
  return { scheduled, total: due, count: records.length };
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(page);
    return;
  }
  if (url.pathname === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`data: ${JSON.stringify({ type: 'hello', file: displayPath, mode, speed, exists: state.exists, skipped: state.skipped })}\n\n`);
    for (const line of events) res.write(`data: ${JSON.stringify({ type: 'line', line })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'ready', exists: state.exists, skipped: state.skipped })}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (url.pathname === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ file: displayPath, mode, speed, exists: state.exists, skipped: state.skipped, events }));
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('not found\n');
});

// A dead client must never stop the server.
server.on('clientError', (err, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[trace] port ${port} is already in use. Stop the process on it, or use --port.`);
  } else {
    console.error(`[trace] server error: ${err.message}`);
  }
  process.exit(1);
});

function startServer() {
  server.listen(port, '127.0.0.1', () => {
    console.log(`[trace] ${mode} ${displayPath}`);
    console.log(`[trace] process screen on http://localhost:${port}`);
  });
}

// Keep the page alive while the tool sleeps between lines.
setInterval(() => {
  for (const res of clients) {
    try {
      res.write(': keep-alive\n\n');
    } catch {
      clients.delete(res);
    }
  }
}, 20000).unref();

if (mode === 'replay') {
  const recording = await loadReplay(file);
  state.exists = true;
  startServer();
  console.log(`[trace] replay ${recording.count} lines over ${(recording.total / 1000).toFixed(1)}s at ${speed}x`);
  for (const item of recording.scheduled) {
    setTimeout(() => accept(JSON.stringify(item.line), ' (replay)'), Math.round(item.due));
  }
  setTimeout(() => console.log(`[trace] replay finished: ${events.length} lines`), Math.round(recording.total) + 200).unref();
} else {
  startServer();
  await poll();
  setInterval(poll, 200);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log('[trace] stopped');
    process.exit(0);
  });
}
