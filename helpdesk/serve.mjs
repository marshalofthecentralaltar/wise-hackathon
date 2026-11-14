// node helpdesk/serve.mjs [--dry-run] [--port 3400]
// The Demo Bank Helpdesk: the customer contact form (any address), the live agent inbox (this
// computer only), and the PII filter that forwards safe tickets to Slack #support as the
// "Support Desk" app. Node 22 built-ins only. Nothing personal is printed or logged.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from './lib/store.mjs';
import { processEdit, processTicket } from './lib/pipeline.mjs';
import { claudeCheck, describeScreenshot } from './lib/claude.mjs';
import { loadSlackSettings, slackPoster } from './lib/slack.mjs';
import { readTicketInput, isLocal, BODY_LIMIT } from './lib/http.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const port = Number(argv[argv.indexOf('--port') + 1]) || Number(process.env.HELPDESK_PORT) || 3400;
const stateDir = process.env.HELPDESK_STATE_DIR || join(here, '.state');

const store = openStore(stateDir);
const slack = loadSlackSettings();
const post = dryRun
  ? async (text) => {
      console.log(`[helpdesk] dry run, would post to #support:\n${text}\n`);
      return { ts: null, link: null };
    }
  : slackPoster(slack);
const deps = { claudeCheck: (t) => claudeCheck(t, { cwd: stateDir }), describeScreenshot: (p, complaint) => describeScreenshot(p, { cwd: stateDir, complaint }) };

const pages = { form: join(here, 'public', 'form.html'), inbox: join(here, 'public', 'inbox.html') };
const clients = new Set();
const say = (line) => console.log(`[helpdesk] ${line}`);

function publicView(t) {
  const { screenshotPath, ...rest } = t;
  return { ...rest, screenshotUrl: screenshotPath ? `/screenshots/${basename(screenshotPath)}` : null };
}

function broadcast(t) {
  const data = `data: ${JSON.stringify(publicView(t))}\n\n`;
  for (const res of clients) res.write(data);
}

function update(id, patch) {
  const t = store.update(id, patch);
  if (t) {
    broadcast(t);
    say(`${id} ${t.status}`);
  }
  return t;
}

async function sendToSlack(id, text, removed) {
  try {
    const r = await post(text);
    const t = store.get(id);
    const seconds = Math.round((Date.now() - Date.parse(t.createdAt)) / 100) / 10;
    update(id, { status: 'Sent to #support', slackText: text, removed, slackTs: r.ts, slackLink: r.link, postedAt: new Date().toISOString(), secondsToSlack: seconds, dryRun, postError: null, heldReason: null });
  } catch (err) {
    update(id, { status: 'Post failed', slackText: text, removed, postError: String(err.message ?? err) });
  }
}

async function check(id) {
  update(id, { status: 'Checking' });
  const t = store.get(id);
  const r = await processTicket(t, deps);
  if (r.describeError) store.update(id, { describeError: r.describeError });
  if (r.status === 'held') {
    update(id, { status: 'Held', heldReason: r.reason, proposedText: r.proposedText, removed: r.removed });
    return;
  }
  await sendToSlack(id, r.slackText, r.removed);
}

function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function html(res, file) {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(readFileSync(file));
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > BODY_LIMIT) throw Object.assign(new Error('body too large'), { code: 413 });
    chunks.push(c);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw Object.assign(new Error('body is not JSON'), { code: 400 });
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const path = url.pathname;
  try {
    // Open to any address: the form and its endpoint.
    if (req.method === 'GET' && path === '/') return html(res, pages.form);
    if (req.method === 'POST' && path === '/api/tickets') {
      const body = await readJson(req);
      const input = readTicketInput(body, req.headers['user-agent'] ?? '');
      if (input.error) return json(res, 400, { error: input.error });
      const t = store.create({ ...input.fields, createdAt: new Date().toISOString() });
      if (input.screenshot) store.update(t.id, { screenshotPath: store.saveScreenshot(t.id, input.screenshot.ext, input.screenshot.bytes) });
      broadcast(t);
      say(`${t.id} New`);
      json(res, 201, { id: t.id });
      void check(t.id);
      return;
    }

    // Everything else shows personal data: this computer only.
    if (!isLocal(req.socket.remoteAddress)) return json(res, 403, { error: 'The inbox is only open on the helpdesk computer' });
    if (req.method === 'GET' && path === '/inbox') return html(res, pages.inbox);
    if (req.method === 'GET' && path === '/api/inbox/tickets') return json(res, 200, { dryRun, tickets: store.list().map(publicView) });
    if (req.method === 'GET' && path === '/api/inbox/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write(': connected\n\n');
      clients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 15_000);
      req.on('close', () => (clearInterval(ping), clients.delete(res)));
      return;
    }
    const shot = /^\/screenshots\/(T-\d+\.(?:png|jpg))$/.exec(path);
    if (req.method === 'GET' && shot) {
      const t = store.get(shot[1].split('.')[0]);
      if (!t?.screenshotPath) return json(res, 404, { error: 'no such screenshot' });
      res.writeHead(200, { 'content-type': shot[1].endsWith('png') ? 'image/png' : 'image/jpeg', 'cache-control': 'no-store' });
      return res.end(readFileSync(t.screenshotPath));
    }
    const act = /^\/api\/inbox\/tickets\/(T-\d+)\/(send|retry)$/.exec(path);
    if (req.method === 'POST' && act) {
      const t = store.get(act[1]);
      if (!t) return json(res, 404, { error: 'no such ticket' });
      if (act[2] === 'retry') {
        if (t.status !== 'Post failed') return json(res, 409, { error: `ticket is ${t.status}` });
        json(res, 202, { ok: true });
        update(t.id, { status: 'Checking' });
        void sendToSlack(t.id, t.slackText, t.removed);
        return;
      }
      if (t.status !== 'Held') return json(res, 409, { error: `ticket is ${t.status}` });
      const body = await readJson(req);
      const r = processEdit(t, body.text);
      if (r.status === 'held') {
        update(t.id, { heldReason: r.reason, proposedText: r.proposedText });
        return json(res, 422, { error: r.reason, proposedText: r.proposedText });
      }
      json(res, 202, { ok: true });
      update(t.id, { status: 'Checking', editedByAgent: true });
      void sendToSlack(t.id, r.slackText, [...(t.removed ?? []), ...r.removed]);
      return;
    }
    json(res, 404, { error: 'not found' });
  } catch (err) {
    json(res, err.code === 413 ? 413 : err.code === 400 ? 400 : 500, { error: err.message });
  }
});

server.listen(port, '0.0.0.0', () => {
  say(`form on http://localhost:${port}/ (open on the network), inbox on http://localhost:${port}/inbox (this computer only)`);
  if (dryRun) say('dry run: Slack messages are printed, not posted');
  else if (!slack.token) say(`SLACK_TEST_BOT_TOKEN is empty in ${slack.file}; posts will fail (use --dry-run to print them)`);
});
