// node helpdesk/seed.mjs --problem flicker|amount|declined|mixed [--gap-seconds 3] [--url http://localhost:3400] [--no-wait]
// Submits made-up tickets from seed-tickets.json through the same endpoint the form uses, so they
// go through the whole filter. Then waits until each is sent or held and prints the Slack text
// and the measured seconds. Prints no personal data.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const problem = arg('problem');
const gap = Number(arg('gap-seconds', '3'));
const base = arg('url', 'http://localhost:3400');
const wait = !process.argv.includes('--no-wait');
if (!['flicker', 'amount', 'declined', 'mixed'].includes(problem) || !Number.isFinite(gap) || gap < 0) {
  console.error('usage: node helpdesk/seed.mjs --problem flicker|amount|declined|mixed [--gap-seconds 3] [--url http://localhost:3400] [--no-wait]');
  process.exit(2);
}

const all = JSON.parse(readFileSync(join(here, 'seed-tickets.json'), 'utf8'));
const chosen = problem === 'mixed' ? all : all.filter((t) => t.problem === problem);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ids = [];
for (const [i, t] of chosen.entries()) {
  if (i > 0) await sleep(gap * 1000);
  const body = { name: t.name, email: t.email, phone: t.phone, customerNumber: t.customerNumber, page: t.page, text: t.text, lang: t.lang };
  if (t.screenshot) body.screenshot = { name: t.screenshot, dataBase64: readFileSync(join(here, t.screenshot)).toString('base64') };
  let res;
  try {
    res = await fetch(`${base}/api/tickets`, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': t.userAgent }, body: JSON.stringify(body) });
  } catch (err) {
    console.error(`could not reach the helpdesk at ${base}: ${err.cause?.code ?? err.message}. Start it with node helpdesk/serve.mjs`);
    process.exit(1);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`ticket ${i + 1} (${t.problem}) refused: ${data.error ?? res.status}`);
    process.exit(1);
  }
  ids.push(data.id);
  console.log(`[seed] ${data.id} submitted (${t.problem}, ${t.lang}${t.screenshot ? ', with screenshot' : ''})`);
}

if (!wait) process.exit(0);
const DONE = new Set(['Sent to #support', 'Held', 'Post failed']);
const deadline = Date.now() + 120_000;
let tickets = [];
while (Date.now() < deadline) {
  const res = await fetch(`${base}/api/inbox/tickets`);
  tickets = (await res.json()).tickets.filter((t) => ids.includes(t.id));
  if (tickets.length === ids.length && tickets.every((t) => DONE.has(t.status))) break;
  await sleep(1000);
}
let failed = 0;
for (const id of ids) {
  const t = tickets.find((x) => x.id === id);
  if (!t || !DONE.has(t.status)) {
    console.log(`\n${id}: still ${t?.status ?? 'unknown'} after 120 s`);
    failed++;
    continue;
  }
  if (t.status !== 'Sent to #support') failed++;
  console.log(`\n${id}: ${t.status}${t.secondsToSlack != null ? `, ${t.secondsToSlack} s from submit to Slack (measured)` : ''}`);
  if (t.slackText) console.log(t.slackText);
  if (t.slackLink) console.log(t.slackLink);
  if (t.heldReason) console.log(`held: ${t.heldReason}`);
  if (t.postError) console.log(`post failed: ${t.postError}`);
}
process.exit(failed ? 1 : 0);
