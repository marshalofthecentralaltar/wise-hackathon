// Thin path: a typed report in #support becomes a pull request written by Claude Code.
// Run: npm run thin            (listen)
//      npm run thin -- --check (connect once, print team and bot id, exit)
import { App, LogLevel } from '@slack/bolt';
import { WebClient } from '@slack/web-api';
import { readEnv } from './env.js';
import { writeFixPullRequest } from './fix.js';
import {
  formatFailureReply,
  formatSuccessReply,
  isCustomerReportCandidate,
  type SlackMessageEvent,
} from './slack.js';

const SUPPORT_CHANNEL = 'support';
const FIX_REPO = process.env.FIX_REPO || 'marshalofthecentralaltar/demo-bank-hello';

async function findChannelId(client: WebClient, name: string): Promise<string | undefined> {
  let cursor: string | undefined;
  do {
    const page = await client.conversations.list({ types: 'public_channel', exclude_archived: true, limit: 200, cursor });
    const hit = page.channels?.find((c) => c.name === name);
    if (hit?.id) return hit.id;
    cursor = page.response_metadata?.next_cursor || undefined;
  } while (cursor);
  return undefined;
}

async function main(): Promise<number> {
  const check = process.argv.includes('--check');
  const env = readEnv();
  const missing = [
    ['SLACK_BOT_TOKEN', env.slackBotToken],
    ['SLACK_APP_TOKEN', env.slackAppToken],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) {
    console.error(`Empty in the env file: ${missing.join(', ')}`);
    return 2;
  }

  const client = new WebClient(env.slackBotToken);
  const auth = await client.auth.test();
  const botUserId = auth.user_id ?? '';
  const channelId = await findChannelId(client, SUPPORT_CHANNEL);
  if (!channelId) {
    console.error(`#${SUPPORT_CHANNEL} not found (the bot needs channels:read)`);
    return 1;
  }
  await client.conversations.join({ channel: channelId });

  const app = new App({
    token: env.slackBotToken,
    appToken: env.slackAppToken,
    socketMode: true,
    logLevel: LogLevel.WARN,
  });

  // One fix at a time: reports are queued, never run in parallel on this laptop.
  let queue: Promise<void> = Promise.resolve();

  app.event('message', async ({ event, client: web }) => {
    const msg = event as SlackMessageEvent;
    if (msg.channel !== channelId || !isCustomerReportCandidate(msg, botUserId)) return;
    const threadTs = msg.ts as string;
    await web.chat.postMessage({ channel: channelId, thread_ts: threadTs, text: 'Looking into it' });
    queue = queue.then(async () => {
      try {
        const result = await writeFixPullRequest({ repo: FIX_REPO, reportText: msg.text ?? '', model: env.fixModel });
        const text = result.ok
          ? formatSuccessReply(result.prUrl, { ...result.seconds })
          : formatFailureReply(result.stage, result.message, result.seconds.total);
        console.log(result.ok ? `PR ${result.prUrl} in ${result.seconds.total}s` : `failed at ${result.stage}: ${result.message}`);
        await web.chat.postMessage({ channel: channelId, thread_ts: threadTs, text });
      } catch (err) {
        console.error(err);
        await web.chat.postMessage({ channel: channelId, thread_ts: threadTs, text: `Could not write a fix: ${String(err)}` });
      }
    });
  });

  await app.start();
  console.log(`team: ${auth.team}`);
  console.log(`bot user id: ${botUserId}`);
  console.log(`channel: #${SUPPORT_CHANNEL} (${channelId})`);
  console.log('connected');
  if (check) {
    await app.stop();
    return 0;
  }
  console.log(`Listening in #${SUPPORT_CHANNEL}; fixes go to ${FIX_REPO} with model ${env.fixModel}. Ctrl+C stops.`);
  return new Promise<number>(() => undefined);
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
