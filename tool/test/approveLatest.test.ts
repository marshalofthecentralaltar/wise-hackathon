import { describe, expect, it } from 'vitest';
import { newestThreadWithButton, type ThreadMessage } from '../src/autoApprove.js';
import { APPROVE_ACTION_ID, APPROVE_BLOCK_ID } from '../src/handoff.js';

const withButton = (ts: string): ThreadMessage => ({
  ts,
  blocks: [{ type: 'actions', block_id: APPROVE_BLOCK_ID, elements: [{ type: 'button', action_id: APPROVE_ACTION_ID, value: '{"repo":"a/b","pr":1,"owner":"U1","group":"g"}' }] }] as never,
});
const approved = (ts: string): ThreadMessage => ({ ts, blocks: [{ type: 'section', block_id: APPROVE_BLOCK_ID, text: { type: 'mrkdwn', text: 'Approved' } }] as never });

describe('newestThreadWithButton', () => {
  const threads: Record<string, ThreadMessage[]> = {
    '30.0': [{ ts: '30.0' }, { ts: '31.0', thread_ts: '30.0' }], // newest thread, still working: no handoff yet
    '20.0': [{ ts: '20.0' }, withButton('25.0')], // a handoff waiting for approval
    '10.0': [{ ts: '10.0' }, withButton('15.0')], // an older one, also waiting
    '5.0': [{ ts: '5.0' }, approved('6.0')], // already approved
  };
  const reads: string[] = [];
  const read = async (_c: string, ts: string) => {
    reads.push(ts);
    return threads[ts] ?? [];
  };
  const history = [
    { ts: '40.0' } as ThreadMessage, // a message without replies
    { ts: '30.0', reply_count: 1 } as ThreadMessage,
    { ts: '29.0', thread_ts: '20.0', reply_count: 0 } as ThreadMessage, // a reply broadcast to the channel
    { ts: '20.0', reply_count: 4 } as ThreadMessage,
    { ts: '10.0', reply_count: 4 } as ThreadMessage,
  ];

  it('picks the newest thread that still carries the button, reading no older thread', async () => {
    expect(await newestThreadWithButton(history, 'C1', read)).toBe('20.0');
    expect(reads).toEqual(['30.0', '20.0']);
  });

  it('returns null when every thread is approved or has no handoff', async () => {
    const h = [{ ts: '5.0', reply_count: 1 } as ThreadMessage, { ts: '30.0', reply_count: 1 } as ThreadMessage];
    expect(await newestThreadWithButton(h, 'C1', read)).toBeNull();
  });
});
