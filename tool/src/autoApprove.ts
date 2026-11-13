// The unattended approval, for test runs only: reads the handoff back from Slack, takes the real
// "Approve fix" button value from its blocks, and runs the same press handler a click runs, as
// the owner named in that value. Everything after the click is real: the merge with gh, the
// approvals file, the message update. A thread without the button is refused.
import type { WebClient } from '@slack/web-api';
import { handleApprovePress, parseApproveValue, type ApproveDeps, type ApprovePress, type ApproveResult } from './approve.js';
import { APPROVE_ACTION_ID, APPROVE_BLOCK_ID } from './handoff.js';
import type { SlackBlock, SlackPort } from './slackPost.js';

export interface ThreadMessage {
  ts?: string;
  thread_ts?: string;
  text?: string;
  user?: string;
  bot_id?: string;
  blocks?: SlackBlock[];
}

/** Reads a thread as Slack stored it. */
export type ThreadReader = (channel: string, threadTs: string) => Promise<ThreadMessage[]>;

export const slackThreadReader =
  (client: WebClient): ThreadReader =>
  async (channel, threadTs) => {
    const out: ThreadMessage[] = [];
    let cursor: string | undefined;
    do {
      const r = await client.conversations.replies({ channel, ts: threadTs, limit: 200, cursor });
      out.push(...((r.messages ?? []) as ThreadMessage[]));
      cursor = r.response_metadata?.next_cursor || undefined;
    } while (cursor);
    return out;
  };

export interface FoundButton {
  messageTs: string;
  value: string;
  blocks: SlackBlock[];
}

/** The "Approve fix" button in a thread: the message that carries it and the value it holds. */
export function findApproveButton(messages: ThreadMessage[]): FoundButton | null {
  for (const m of messages) {
    for (const b of m.blocks ?? []) {
      if (b.type !== 'actions' || b.block_id !== APPROVE_BLOCK_ID) continue;
      const elements = (b.elements ?? []) as { action_id?: string; value?: string }[];
      const button = elements.find((e) => e.action_id === APPROVE_ACTION_ID && typeof e.value === 'string');
      if (button && m.ts) return { messageTs: m.ts, value: button.value!, blocks: m.blocks! };
    }
  }
  return null;
}

export interface AutoApproveOptions {
  channel: string;
  threadTs: string;
  read: ThreadReader;
  slack: SlackPort;
  /** The press handler; the real one when absent. */
  approve?: (press: ApprovePress, deps: ApproveDeps) => Promise<ApproveResult>;
  /** Passed on to the press handler (gh runner, state path) for tests. */
  approveDeps?: Omit<ApproveDeps, 'slack'>;
}

export type AutoApproveOutcome =
  | { pressed: true; result: ApproveResult; owner: string; pr: number; repo: string; messageTs: string }
  | { pressed: false; refused: string };

export async function approveFromThread(opts: AutoApproveOptions): Promise<AutoApproveOutcome> {
  const messages = await opts.read(opts.channel, opts.threadTs);
  const found = findApproveButton(messages);
  if (!found) return { pressed: false, refused: 'the thread has no "Approve fix" button; nothing was pressed' };
  const value = parseApproveValue(found.value);
  if (!value) return { pressed: false, refused: 'the button carries a value the tool did not write; nothing was pressed' };
  const press: ApprovePress = {
    userId: value.owner,
    channel: opts.channel,
    messageTs: found.messageTs,
    threadTs: opts.threadTs,
    value: found.value,
    blocks: found.blocks,
    unattended: true,
  };
  const result = await (opts.approve ?? handleApprovePress)(press, { ...opts.approveDeps, slack: opts.slack });
  return { pressed: true, result, owner: value.owner, pr: value.pr, repo: value.repo, messageTs: found.messageTs };
}
