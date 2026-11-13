import { describe, expect, it } from 'vitest';
import { isCustomerReportCandidate, type SlackMessageEvent } from '../src/slack.js';

const BOT = 'U0BOT0001';
// Shapes follow the payloads on docs.slack.dev (reference/events/message and its subtypes).
const typed: SlackMessageEvent = {
  type: 'message',
  channel: 'C0SUPPORT',
  user: 'U0PERSON1',
  text: 'Customer says the greeting says Helo',
  ts: '1763058000.000100',
  channel_type: 'channel',
} as SlackMessageEvent;

describe('isCustomerReportCandidate', () => {
  it('accepts a message typed by a person', () => {
    expect(isCustomerReportCandidate(typed, BOT)).toBe(true);
  });

  it('accepts a thread parent (thread_ts equal to ts)', () => {
    expect(isCustomerReportCandidate({ ...typed, thread_ts: typed.ts }, BOT)).toBe(true);
  });

  it("ignores the tool's own message (GBP app: bot_id and bot_profile, user is the bot)", () => {
    const own = { ...typed, user: BOT, bot_id: 'B0BOT0001', bot_profile: { id: 'B0BOT0001' }, app_id: 'A0APP' };
    expect(isCustomerReportCandidate(own, BOT)).toBe(false);
  });

  it("ignores the tool's own message even if only the user id gives it away", () => {
    expect(isCustomerReportCandidate({ ...typed, user: BOT }, BOT)).toBe(false);
  });

  it('ignores another app posting with bot_id but no subtype', () => {
    expect(isCustomerReportCandidate({ ...typed, user: 'U0OTHERAPP', bot_id: 'B0OTHER' }, BOT)).toBe(false);
  });

  it('ignores a classic bot_message', () => {
    const { user: _user, ...noUser } = typed;
    expect(isCustomerReportCandidate({ ...noUser, subtype: 'bot_message', bot_id: 'B0OLD' }, BOT)).toBe(false);
  });

  it('ignores a thread reply (thread_ts differs from ts)', () => {
    expect(isCustomerReportCandidate({ ...typed, ts: '1763058100.000200', thread_ts: typed.ts }, BOT)).toBe(false);
  });

  it('ignores a thread reply broadcast to the channel', () => {
    expect(
      isCustomerReportCandidate({ ...typed, subtype: 'thread_broadcast', ts: '1763058100.000200', thread_ts: typed.ts }, BOT),
    ).toBe(false);
  });

  it('ignores an edit (message_changed)', () => {
    const { user: _user, text: _text, ...rest } = typed;
    expect(isCustomerReportCandidate({ ...rest, subtype: 'message_changed', hidden: true }, BOT)).toBe(false);
  });

  it('ignores a deletion (message_deleted)', () => {
    const { user: _user, text: _text, ...rest } = typed;
    expect(isCustomerReportCandidate({ ...rest, subtype: 'message_deleted', hidden: true }, BOT)).toBe(false);
  });

  it('ignores a channel join', () => {
    expect(
      isCustomerReportCandidate({ ...typed, subtype: 'channel_join', text: '<@U0PERSON1> has joined the channel' }, BOT),
    ).toBe(false);
  });

  it('ignores an empty message', () => {
    expect(isCustomerReportCandidate({ ...typed, text: '   ' }, BOT)).toBe(false);
  });
});
