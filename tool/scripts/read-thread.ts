// Reads one #support thread back from Slack (conversations.replies) into a text file: each
// message's text, and the handoff's blocks as stored.
//   npx tsx --import ./src/loadSecrets.ts scripts/read-thread.ts --thread <permalink or ts> --out artifacts/f-thread-flicker.txt
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { WebClient } from '@slack/web-api';
import { slackThreadReader } from '../src/autoApprove.js';

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const thread = arg('thread') ?? '';
const out = arg('out');
const channel = (process.env.SUPPORT_CHANNEL_ID ?? '').trim() || 'C0CHF22D9AR';
// A permalink ends in /p<ts without the dot>.
const p = /\/p(\d{10})(\d{6})/.exec(thread);
const ts = p ? `${p[1]}.${p[2]}` : thread;
if (!/^\d{10}\.\d{6}$/.test(ts) || !out) {
  console.error('usage: read-thread.ts --thread <permalink or ts> --out <file>');
  process.exit(2);
}
const messages = await slackThreadReader(new WebClient(process.env.SLACK_BOT_TOKEN))(channel, ts);
const handoff = messages.find((m) => (m.blocks ?? []).some((b) => b.block_id === 'handoff_problem'));
const text = [
  `thread: ${thread}`,
  `messages in thread: ${messages.length}`,
  `read back with conversations.replies at ${new Date().toISOString()}`,
  '',
  ...messages.map((m) => `--- ${m.ts} ${m.user ?? ''}${m.bot_id ? ` bot ${m.bot_id}` : ''}${m === handoff ? ' (handoff)' : ''}\n${m.text ?? ''}`),
  '',
  '--- handoff blocks as stored',
  JSON.stringify(handoff?.blocks ?? null, null, 2),
].join('\n');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, text, 'utf8');
console.log(`wrote ${out}: ${messages.length} messages, handoff ${handoff ? handoff.ts : 'not found'}`);
