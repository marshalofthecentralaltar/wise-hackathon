// Deletes every message the tool's bot posted in the monitor channel (MONITOR_CHANNEL, default
// `monitor`): top-level pattern messages and everything in their threads, so the channel is empty
// before a demo. Messages typed by people are left (the bot may not delete them) and counted.
// Run from tool/: npm run clear-monitor
import { WebClient } from '@slack/web-api';
import { config } from '../src/config.js';

const token = (process.env.SLACK_BOT_TOKEN ?? '').trim();
if (!token) {
  console.error('SLACK_BOT_TOKEN is empty');
  process.exit(2);
}
const client = new WebClient(token);
const me = (await client.auth.test()).user_id;
let channel: string | undefined;
for (let cursor: string | undefined, first = true; (first || cursor) && !channel; first = false) {
  const page = await client.conversations.list({ types: 'public_channel', exclude_archived: true, limit: 200, cursor });
  channel = page.channels?.find((c) => c.name === config.monitorChannel)?.id;
  cursor = page.response_metadata?.next_cursor || undefined;
}
if (!channel) {
  console.error(`#${config.monitorChannel} not found`);
  process.exit(1);
}
let deleted = 0;
let left = 0;
let failed = 0;
for (let cursor: string | undefined, first = true; first || cursor; first = false) {
  const h = await client.conversations.history({ channel, limit: 200, cursor });
  for (const top of h.messages ?? []) {
    const replies = top.reply_count ? ((await client.conversations.replies({ channel, ts: String(top.ts), limit: 200 })).messages ?? []) : [top];
    // Replies first, the top-level message last.
    for (const m of [...replies].reverse()) {
      if ((m as { subtype?: string }).subtype === 'channel_join') continue;
      if (m.user !== me) {
        left++;
        continue;
      }
      try {
        await client.chat.delete({ channel, ts: String(m.ts) });
        deleted++;
      } catch (err) {
        failed++;
        console.error(`could not delete ${m.ts}: ${(err as { data?: { error?: string } }).data?.error ?? String(err)}`);
      }
    }
  }
  cursor = h.response_metadata?.next_cursor || undefined;
}
console.log(`#${config.monitorChannel}: deleted ${deleted} of the tool's messages, ${failed} failed, ${left} by people left in place`);
