import { describe, expect, it } from 'vitest';
import { isCustomerReportCandidate, type SlackMessageEvent } from '../src/slack.js';

const OWN = { botUserId: 'U0BOT0001', botId: 'B0BOT0001' };
// Shapes follow the payloads on docs.slack.dev (reference/events/message and its subtypes).
const typed: SlackMessageEvent = {
  type: 'message',
  channel: 'C0SUPPORT',
  user: 'U0PERSON1',
  text: 'Customer says the greeting says Helo',
  ts: '1763058000.000100',
};

describe('isCustomerReportCandidate', () => {
  it('accepts a message typed by a person', () => {
    expect(isCustomerReportCandidate(typed, OWN)).toBe(true);
  });

  it('accepts a thread parent (thread_ts equal to ts)', () => {
    expect(isCustomerReportCandidate({ ...typed, thread_ts: typed.ts }, OWN)).toBe(true);
  });

  it("accepts another app's message (bot_id, bot_profile, no subtype)", () => {
    const other = { ...typed, user: 'U0OTHERAPP', bot_id: 'B0OTHER', bot_profile: { id: 'B0OTHER' }, app_id: 'A0OTHER' };
    expect(isCustomerReportCandidate(other, OWN)).toBe(true);
  });

  it('accepts a classic bot_message from another integration', () => {
    const { user: _user, ...noUser } = typed;
    expect(isCustomerReportCandidate({ ...noUser, subtype: 'bot_message', bot_id: 'B0OLD' }, OWN)).toBe(true);
  });

  it('rejects our own message by bot_id alone', () => {
    const { user: _user, ...noUser } = typed;
    expect(isCustomerReportCandidate({ ...noUser, bot_id: OWN.botId }, OWN)).toBe(false);
    expect(isCustomerReportCandidate({ ...typed, user: 'U0SOMEONE', bot_id: OWN.botId }, OWN)).toBe(false);
  });

  it('rejects our own message by user alone', () => {
    expect(isCustomerReportCandidate({ ...typed, user: OWN.botUserId }, OWN)).toBe(false);
  });

  it('rejects our own classic bot_message by bot_id', () => {
    const { user: _user, ...noUser } = typed;
    expect(isCustomerReportCandidate({ ...noUser, subtype: 'bot_message', bot_id: OWN.botId }, OWN)).toBe(false);
  });

  it('rejects a thread reply (thread_ts differs from ts)', () => {
    expect(isCustomerReportCandidate({ ...typed, ts: '1763058100.000200', thread_ts: typed.ts }, OWN)).toBe(false);
  });

  it("rejects another app's thread reply", () => {
    const reply = { ...typed, bot_id: 'B0OTHER', ts: '1763058100.000200', thread_ts: typed.ts };
    expect(isCustomerReportCandidate(reply, OWN)).toBe(false);
  });

  it('rejects a thread reply broadcast to the channel', () => {
    expect(
      isCustomerReportCandidate({ ...typed, subtype: 'thread_broadcast', ts: '1763058100.000200', thread_ts: typed.ts }, OWN),
    ).toBe(false);
  });

  it('rejects an edit (message_changed)', () => {
    const { user: _user, text: _text, ...rest } = typed;
    expect(isCustomerReportCandidate({ ...rest, subtype: 'message_changed', hidden: true }, OWN)).toBe(false);
  });

  it('rejects a deletion (message_deleted)', () => {
    const { user: _user, text: _text, ...rest } = typed;
    expect(isCustomerReportCandidate({ ...rest, subtype: 'message_deleted', hidden: true }, OWN)).toBe(false);
  });

  it('rejects a channel join', () => {
    expect(
      isCustomerReportCandidate({ ...typed, subtype: 'channel_join', text: '<@U0PERSON1> has joined the channel' }, OWN),
    ).toBe(false);
  });

  it('rejects an empty message', () => {
    expect(isCustomerReportCandidate({ ...typed, text: '   ' }, OWN)).toBe(false);
  });
});
