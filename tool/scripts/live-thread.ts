// One live run for one planted problem: posts three fixture reports in #support with the bot
// token, groups them with the real step 2, then runs the pipeline with the real steps 3 to 7 and
// the stand-in fix. The owner's Slack id is replaced by the bot's own id, so no person is pinged.
// The bot ignores its own messages, so this goes straight to the pipeline, not through the listener.
// Run from tool/:
//   npx tsx --import ./src/loadSecrets.ts scripts/live-thread.ts --problem flicker
//   npx tsx --import ./src/loadSecrets.ts scripts/live-thread.ts --problem amount
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WebClient } from '@slack/web-api';
import { investigate } from '../src/investigate.js';
import { runPipeline } from '../src/pipeline.js';
import { webSlackPort } from '../src/slackPost.js';
import { standInFix } from '../src/standInFix.js';
import { findOwner } from '../src/steps/owner.js';
import { ReportStore } from '../src/steps/reports.js';
import type { CodeSteps, Report } from '../src/types.js';
import { classifyCustomerEffect, judge } from '../src/verdict.js';

const SLUGS: Record<string, string> = { flicker: 'card-picture-flicker', amount: 'transfers-amount-wrong' };
const problem = process.argv[process.argv.indexOf('--problem') + 1] ?? '';
const slug = SLUGS[problem];
if (!slug) {
  console.error('usage: live-thread.ts --problem flicker|amount');
  process.exit(2);
}
const CHANNEL = process.env.SUPPORT_CHANNEL_ID || 'C0CHF22D9AR';

interface Fixture {
  text: string;
  lang: string;
  problem: string | null;
}
const fixtures = JSON.parse(readFileSync(fileURLToPath(new URL('../../fixtures/reports.json', import.meta.url)), 'utf8')) as Fixture[];
// One message per language where the fixtures have one, then English ones until there are three.
const ofProblem = fixtures.filter((f) => f.problem === slug);
const picked = ['en', 'et', 'ru'].map((lang) => ofProblem.find((f) => f.lang === lang)).filter((f): f is Fixture => !!f);
for (const f of ofProblem) if (picked.length < 3 && !picked.includes(f)) picked.push(f);
if (picked.length < 3) {
  console.error(`only ${picked.length} fixture reports for ${slug}`);
  process.exit(1);
}

const client = new WebClient(process.env.SLACK_BOT_TOKEN);
const auth = await client.auth.test();
const botUserId = auth.user_id ?? '';

const reports: Report[] = [];
for (const f of picked) {
  const r = await client.chat.postMessage({ channel: CHANNEL, text: f.text });
  reports.push({ channel: CHANNEL, ts: String(r.ts), sender: botUserId, text: f.text });
}

const t0 = performance.now();
const store = new ReportStore({ statePath: null, threshold: 3 });
const triggered = await store.addReports(reports);
const patternSeconds = (performance.now() - t0) / 1000;
const group = triggered[0];
if (!group) {
  console.error(JSON.stringify({ stopped: 'no group reached 3 reports', state: store.state() }));
  process.exit(1);
}

const code: CodeSteps = { investigate: (i) => investigate(i), classifyCustomerEffect: (t) => classifyCustomerEffect(t), judge, fix: standInFix };
const slack = webSlackPort(client);
const result = await runPipeline(group, {
  code,
  slack,
  patternSeconds,
  // The real owners line, with the bot's own id in place of the person's.
  findOwner: async (page) => ({ ...(await findOwner(page, { lookupSlackUser: async () => null })), slackUserId: botUserId }),
});

const permalink = await slack.getPermalink(CHANNEL, group.threadTs);
console.log(JSON.stringify({ problem, threadPermalink: permalink, groupSize: group.reports.length, page: group.page }));
console.log(JSON.stringify({ ok: result.ok, failedStep: result.failedStep ?? null, commit: result.handoff?.investigation.commitSha?.slice(0, 7) ?? null, file: result.handoff?.investigation.file ?? null, severity: result.handoff?.verdict.severity ?? null }));
console.log(JSON.stringify(result.timings));

// Read back what Slack stored.
const replies = await client.conversations.replies({ channel: CHANNEL, ts: group.threadTs, limit: 50 });
const msgs = replies.messages ?? [];
const handoff = msgs.find((m) => m.ts === result.handoffTs);
mkdirSync(fileURLToPath(new URL('../artifacts/', import.meta.url)), { recursive: true });
const out = [
  `thread: ${permalink}`,
  `messages in thread: ${msgs.length}`,
  `read back with conversations.replies at ${new Date().toISOString()}`,
  '',
  ...msgs.map((m) => `--- ${m.ts}${m.ts === result.handoffTs ? ' (handoff)' : ''}\n${m.text ?? ''}`),
  '',
  '--- handoff blocks as stored',
  JSON.stringify(handoff?.blocks ?? null, null, 2),
].join('\n');
writeFileSync(fileURLToPath(new URL(`../artifacts/b2-thread-${problem}.txt`, import.meta.url)), out, 'utf8');
console.log(`wrote artifacts/b2-thread-${problem}.txt`);
