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
//   payload"; such a message may carry no subtype at all.
// - https://docs.slack.dev/messaging/retrieving-messages : a message with a `thread_ts`
//   is part of a thread; when `thread_ts` equals `ts` it is the parent, when they differ it
//   is a reply. A parent keeps its `thread_ts` even after its replies are deleted.
//
// What is rejected, and why:
// - Our own messages: `user` equals our bot user id, or `bot_id` equals our bot id (both
//   from auth.test). Either alone is enough, so the tool never answers itself.
// - Thread replies (`thread_ts` differs from `ts`) and `thread_broadcast`: the tool talks
//   in threads; a report is a new top-level message.
// - Edits, deletions, joins and every other subtype except `bot_message` and `file_share`:
//   they are not new reports.
// - Empty text.
// Messages from other apps are accepted, with or without the classic `bot_message`
// subtype: reports reach real support channels through integrations, and the full-run
// script posts its test reports from a second app. Nothing else about the sender matters.

export interface OwnIdentity {
  botUserId: string;
  botId: string;
}

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

/** Subtypes that are a new top-level message, typed by a person or posted by another app. */
const NEW_MESSAGE_SUBTYPES = new Set<string | undefined>([undefined, 'file_share', 'bot_message']);

export function isCustomerReportCandidate(event: SlackMessageEvent, own: OwnIdentity): boolean {
  if (event.type !== undefined && event.type !== 'message') return false;
  if (!NEW_MESSAGE_SUBTYPES.has(event.subtype)) return false; // edits, deletions, joins, broadcasts
  if (event.hidden) return false;
  if (own.botUserId && event.user === own.botUserId) return false; // ours, by user id
  if (own.botId && event.bot_id === own.botId) return false; // ours, by bot id
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
