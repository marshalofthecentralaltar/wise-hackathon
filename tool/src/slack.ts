// What decides whether a Slack `message` event is a customer report the tool acts on.
//
// From Slack's documentation (read 13 Nov 2026):
// - https://docs.slack.dev/reference/events/message : a plain message has no `subtype`.
//   Edits arrive as subtype `message_changed`, deletions as `message_deleted` (hidden),
//   joins as `channel_join`; `thread_broadcast` is a thread reply also shown in the channel.
// - https://docs.slack.dev/reference/events/message/bot_message : subtype `bot_message`
//   ("A message was posted by an integration") is the classic-app form with a `bot_id`
//   and no user. For current (granular-permission) apps, Slack says to detect bot-sent
//   messages by "the presence of the `bot_id` and `bot_profile` fields in the event
//   payload"; such a message may carry no subtype at all, so the subtype alone is not enough.
// - https://docs.slack.dev/messaging/retrieving-messages : a message with a `thread_ts`
//   is part of a thread; when `thread_ts` equals `ts` it is the parent, when they differ it
//   is a reply. A parent keeps its `thread_ts` even after its replies are deleted.

export interface SlackMessageEvent {
  type?: string;
  subtype?: string;
  channel?: string;
  user?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
  bot_id?: string;
  bot_profile?: unknown;
  app_id?: string;
  hidden?: boolean;
}

/** Subtypes a person produces by typing a new top-level message. */
const TYPED_SUBTYPES = new Set<string | undefined>([undefined, 'file_share']);

export function isCustomerReportCandidate(event: SlackMessageEvent, botUserId: string): boolean {
  if (event.type !== undefined && event.type !== 'message') return false;
  if (!TYPED_SUBTYPES.has(event.subtype)) return false; // edits, deletions, joins, bot_message, broadcasts
  if (event.hidden) return false;
  if (event.bot_id || event.bot_profile || event.app_id) return false; // posted by an app, ours or another
  if (!event.user || event.user === botUserId) return false; // our own messages
  if (event.thread_ts && event.thread_ts !== event.ts) return false; // a reply inside a thread
  if (!event.text || !event.text.trim()) return false;
  return true;
}

export function formatSuccessReply(prUrl: string, seconds: Record<string, number>): string {
  const parts = ['clone', 'claude', 'test', 'push', 'pr']
    .map((k) => `${k} ${seconds[k] ?? 0}s`)
    .join(', ');
  return `Pull request with a fix: ${prUrl}\nTook ${seconds.total ?? 0}s (${parts}).`;
}

export function formatFailureReply(stage: string, message: string, total: number): string {
  return `Could not write a fix: ${message} (stage: ${stage}, after ${total}s). No pull request was opened.`;
}
