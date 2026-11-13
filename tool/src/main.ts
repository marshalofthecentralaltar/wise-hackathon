// The tool: listens in #support, groups reports, and runs steps 3 to 10 once for each group
// that reaches the threshold, one group at a time. Also handles the "Approve fix" button.
// Run from tool/: npm run tool
import { App, LogLevel } from '@slack/bolt';
import { WebClient } from '@slack/web-api';
import { handleApprovePress } from './approve.js';
import { config } from './config.js';
import { readEnv } from './env.js';
import { APPROVE_ACTION_ID } from './handoff.js';
import { investigate } from './investigate.js';
import { PipelineQueue, runPipeline } from './pipeline.js';
import { makeMessageHandler } from './listener.js';
import type { SlackMessageEvent } from './slack.js';
import { webSlackPort, type SlackBlock } from './slackPost.js';
import { ensureDeps, unlinkDeps } from './deps.js';
import { fixStep } from './fixStep.js';
import { freshCopy } from './workspace.js';
import { findOwner, slackLookup } from './steps/owner.js';
import { addReports } from './steps/reports.js';
import type { CodeSteps } from './types.js';
import { classifyCustomerEffect, judge } from './verdict.js';

const codeSteps: CodeSteps = {
  investigate: (input) => investigate(input),
  classifyCustomerEffect: (texts) => classifyCustomerEffect(texts),
  judge,
  fix: (input) => fixStep(input),
};

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
  const env = readEnv();
  if (!env.slackBotToken || !env.slackAppToken) {
    console.error('SLACK_BOT_TOKEN or SLACK_APP_TOKEN is empty in the env file');
    return 2;
  }
  const client = new WebClient(env.slackBotToken);
  const auth = await client.auth.test();
  const own = { botUserId: auth.user_id ?? '', botId: auth.bot_id ?? '' };
  const channelId = await findChannelId(client, config.supportChannel);
  if (!channelId) {
    console.error(`#${config.supportChannel} not found (the bot needs channels:read)`);
    return 1;
  }
  await client.conversations.join({ channel: channelId });

  const slack = webSlackPort(client);
  const lookupSlackUser = slackLookup(env.slackBotToken);
  const queue = new PipelineQueue((group, patternSeconds) =>
    runPipeline(group, { code: codeSteps, slack, patternSeconds, findOwner: (page) => findOwner(page, { lookupSlackUser }) }),
  );

  const app = new App({ token: env.slackBotToken, appToken: env.slackAppToken, socketMode: true, logLevel: LogLevel.WARN });

  const onMessage = makeMessageHandler({
    own,
    channelId,
    addReports,
    enqueue: (group, patternSeconds) => queue.enqueue(group, patternSeconds),
    log: (m) => console.log(m),
  });
  app.event('message', async ({ event }) => onMessage(event as SlackMessageEvent));

  app.action(APPROVE_ACTION_ID, async ({ ack, body }) => {
    await ack();
    try {
      const b = body as {
        user?: { id?: string };
        channel?: { id?: string };
        container?: { channel_id?: string; message_ts?: string; thread_ts?: string };
        message?: { ts?: string; thread_ts?: string; blocks?: SlackBlock[] };
        actions?: { action_id?: string; value?: string }[];
      };
      const action = b.actions?.find((a) => a.action_id === APPROVE_ACTION_ID);
      const result = await handleApprovePress(
        {
          userId: b.user?.id ?? '',
          channel: b.channel?.id ?? b.container?.channel_id ?? '',
          messageTs: b.message?.ts ?? b.container?.message_ts ?? '',
          threadTs: b.message?.thread_ts ?? b.container?.thread_ts,
          value: action?.value ?? '',
          blocks: b.message?.blocks,
        },
        { slack },
      );
      console.log(`[tool] approve press by ${b.user?.id ?? '?'}: ${result}`);
    } catch (err) {
      console.error(`[tool] approve handler failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    }
  });

  await app.start();
  console.log(`Listening in #${config.supportChannel} (${channelId}) as ${own.botUserId}; a group acts at ${config.reportThreshold} reports. Ctrl+C stops.`);
  // Warm the dependency install and the repository mirror now, so the first fix does not pay a cold install (about 18 s, measured 13 Nov).
  void (async () => {
    try {
      const copy = await freshCopy(config.repos[0]!);
      const deps = await ensureDeps(copy.dir);
      await unlinkDeps(copy.dir);
      await copy.remove();
      console.log(`[tool] dependencies for the fix step: ${deps.cold ? 'installed' : 'already warm'} in ${deps.seconds} s`);
    } catch (err) {
      console.error(`[tool] could not warm the fix step's dependencies: ${err instanceof Error ? err.message : String(err)}`);
    }
  })();
  return new Promise<number>(() => undefined);
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
