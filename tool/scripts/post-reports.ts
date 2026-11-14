// Posts the three English fixture reports of one problem to #support as three top-level
// messages, a few seconds apart, from the second Slack app ("Support Desk", SLACK_TEST_BOT_TOKEN),
// the way a support integration would. A separately running `npm run tool` picks them up.
// Run from tool/:
//   npx tsx --import ./src/loadSecrets.ts scripts/post-reports.ts --problem flicker|amount|both [--gap-seconds 3]
// `both` (npm run demo-both): the three flicker reports, then the three wrong-amount reports, so two
// threads open in #monitor: the low flicker with a fix to approve, then the high one with context only.
// Whenever the flicker is posted, the Grafana spike seeder (monitoring/seed-spike.mjs, 240 s) starts first.
// Exit 2 when the token is empty or the arguments are wrong.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebClient } from '@slack/web-api';
import { pickReports, type Problem } from '../src/fullRun.js';
import { SECRETS_FILE, emptyTestTokenMessage } from './lib/secretsLine.js';

const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const problem = arg('problem') as Problem | 'both' | undefined;
const gapSeconds = Number(arg('gap-seconds', '3'));
if ((problem !== 'flicker' && problem !== 'amount' && problem !== 'both') || !Number.isFinite(gapSeconds) || gapSeconds < 0) {
  console.error('usage: post-reports.ts --problem flicker|amount|both [--gap-seconds 3]');
  process.exit(2);
}
const token = (process.env.SLACK_TEST_BOT_TOKEN ?? '').trim();
if (!token) {
  console.error(emptyTestTokenMessage(SECRETS_FILE));
  process.exit(2);
}
const channel = (process.env.SUPPORT_CHANNEL_ID ?? '').trim() || 'C0CHF22D9AR';

const client = new WebClient(token);
const auth = await client.auth.test();
const problems: Problem[] = problem === 'both' ? ['flicker', 'amount'] : [problem];
if (problems.includes('flicker') && (process.env.SEED_SPIKE ?? '').toLowerCase() !== 'off') {
  const seeder = spawn(process.execPath, [fileURLToPath(new URL('../../monitoring/seed-spike.mjs', import.meta.url))], { detached: true, stdio: 'ignore', windowsHide: true });
  seeder.unref();
  console.error(`Grafana spike seeder started (pid ${seeder.pid ?? '?'}, 240 s)`);
}
const texts = problems.flatMap((p) => pickReports(p));
const posted: { ts: string; postedAt: string }[] = [];
for (const [i, text] of texts.entries()) {
  if (i > 0) await new Promise((r) => setTimeout(r, gapSeconds * 1000));
  const r = await client.chat.postMessage({ channel, text });
  posted.push({ ts: String(r.ts ?? ''), postedAt: new Date().toISOString() });
}
console.log(JSON.stringify({ problem, channel, as: { user: auth.user_id, bot: auth.bot_id }, posted }));
