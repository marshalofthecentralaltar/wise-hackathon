// The tool's wiring, startable from main.ts (npm run tool) and from a script (full-run --via
// direct). Listens in #support, groups reports, runs steps 3 to 10 once for each group that
// reaches the threshold, one group at a time, and handles the "Approve fix" button.
import { App, LogLevel } from '@slack/bolt';
import { WebClient } from '@slack/web-api';
import { type ApprovePress, type ApproveResult } from './approve.js';
import { approveWithProof, withReproduction } from './browserProof.js';
import { config } from './config.js';
import { ensureDeps, unlinkDeps } from './deps.js';
import { readEnv } from './env.js';
import { fixStep } from './fixStep.js';
import { APPROVE_ACTION_ID } from './handoff.js';
import { investigate } from './investigate.js';
import { makeRunEvents } from './events.js';
import { makeMessageHandler } from './listener.js';
import { PipelineQueue, runPipeline } from './pipeline.js';
import type { OwnIdentity, SlackMessageEvent } from './slack.js';
import { webSlackPort, type SlackBlock, type SlackPort } from './slackPost.js';
import { findOwner, slackLookup } from './steps/owner.js';
import { addReports } from './steps/reports.js';
import type { CodeSteps } from './types.js';
import { classifyCustomerEffect, judge } from './verdict.js';
import { freshCopy } from './workspace.js';

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

export class StartError extends Error {
  constructor(
    message: string,
    readonly exitCode: number,
  ) {
    super(message);
  }
}

export interface StartToolOptions {
  /** false: no Socket Mode connection; events come only through the returned handlers. Default true. */
  listen?: boolean;
  /** Warm the fix step's dependency install at start. Default true. */
  warmDeps?: boolean;
  log?: (line: string) => void;
  logError?: (line: string) => void;
}

export interface RunningTool {
  /** The listener's handler for one Slack `message` event: the same code a typed message reaches. */
  onMessage: (event: SlackMessageEvent) => Promise<void>;
  /** What a press of "Approve fix" runs. */
  onApprove: (press: ApprovePress) => Promise<ApproveResult>;
  /** The tool's bot identity and the #support channel id. */
  own: OwnIdentity;
  channelId: string;
  client: WebClient;
  slack: SlackPort;
  queue: PipelineQueue;
  /** The dependency warm-up; resolves when it has finished (never rejects). */
  warmed: Promise<void>;
  /** Stops the Socket Mode connection, if any. */
  stop: () => Promise<void>;
}

/** Starts the tool. Throws StartError (with the exit code main.ts used) when it cannot start. */
export async function startTool(opts: StartToolOptions = {}): Promise<RunningTool> {
  const log = opts.log ?? ((m: string) => console.log(m));
  const logError = opts.logError ?? ((m: string) => console.error(m));
  const env = readEnv();
  if (!env.slackBotToken || !env.slackAppToken) throw new StartError('SLACK_BOT_TOKEN or SLACK_APP_TOKEN is empty in the env file', 2);
  const client = new WebClient(env.slackBotToken);
  const auth = await client.auth.test();
  const own = { botUserId: auth.user_id ?? '', botId: auth.bot_id ?? '' };
  const channelId = await findChannelId(client, config.supportChannel);
  if (!channelId) throw new StartError(`#${config.supportChannel} not found (the bot needs channels:read)`, 1);
  await client.conversations.join({ channel: channelId });

  const slack = webSlackPort(client);
  const lookupSlackUser = slackLookup(env.slackBotToken);
  const events = makeRunEvents(); // the events file (events.ts): the pipeline and the browser proof write one run id
  const proof = { slack, log, emit: events.emitBare }; // browser proof (browserProof.ts): reproduction beside investigate, page checked after a merge
  const queue = new PipelineQueue((group, patternSeconds) =>
    runPipeline(group, { code: withReproduction(codeSteps, proof), slack, patternSeconds, emit: events.emit, findOwner: (page) => findOwner(page, { lookupSlackUser }) }),
  );

  const onMessage = makeMessageHandler({
    own,
    channelId,
    addReports,
    enqueue: (group, patternSeconds) => queue.enqueue(group, patternSeconds),
    log,
  });
  const onApprove = (press: ApprovePress) => approveWithProof(proof)(press, { slack });

  let app: App | undefined;
  if (opts.listen !== false) {
    app = new App({ token: env.slackBotToken, appToken: env.slackAppToken, socketMode: true, logLevel: LogLevel.WARN });
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
        const result = await onApprove({
          userId: b.user?.id ?? '',
          channel: b.channel?.id ?? b.container?.channel_id ?? '',
          messageTs: b.message?.ts ?? b.container?.message_ts ?? '',
          threadTs: b.message?.thread_ts ?? b.container?.thread_ts,
          value: action?.value ?? '',
          blocks: b.message?.blocks,
        });
        log(`[tool] approve press by ${b.user?.id ?? '?'}: ${result}`);
      } catch (err) {
        logError(`[tool] approve handler failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
      }
    });
    await app.start();
    log(`Listening in #${config.supportChannel} (${channelId}) as ${own.botUserId}; a group acts at ${config.reportThreshold} reports. Ctrl+C stops.`);
  } else {
    log(`Started without a Slack connection for #${config.supportChannel} (${channelId}) as ${own.botUserId}; events are handed in by the caller.`);
  }

  // Warm the dependency install and the repository mirror now, so the first fix does not pay a cold install (about 18 s, measured 13 Nov).
  const warmed =
    opts.warmDeps === false
      ? Promise.resolve()
      : (async () => {
          try {
            const copy = await freshCopy(config.repos[0]!);
            const deps = await ensureDeps(copy.dir);
            await unlinkDeps(copy.dir);
            await copy.remove();
            log(`[tool] dependencies for the fix step: ${deps.cold ? 'installed' : 'already warm'} in ${deps.seconds} s`);
          } catch (err) {
            logError(`[tool] could not warm the fix step's dependencies: ${err instanceof Error ? err.message : String(err)}`);
          }
        })();

  return {
    onMessage,
    onApprove,
    own,
    channelId,
    client,
    slack,
    queue,
    warmed,
    stop: async () => {
      if (app) await app.stop();
    },
  };
}
