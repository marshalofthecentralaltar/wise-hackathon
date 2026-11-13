import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { handleApprovePress, parseApproveValue, type GhRunner } from '../src/approve.js';
import { APPROVE_BLOCK_ID, buildHandoffMessage } from '../src/handoff.js';
import { FakeSlack } from '../src/slackPost.js';
import { handoff } from './fixtures-b2.js';

function recordingGh(code = 0) {
  const calls: string[][] = [];
  const gh: GhRunner = async (args) => {
    calls.push(args);
    return { code, stdout: '', stderr: code === 0 ? '' : 'GraphQL: Pull request is not mergeable' };
  };
  return { gh, calls };
}

function setup(ghCode = 0) {
  const message = buildHandoffMessage(handoff());
  const button = (message.blocks.find((b) => b.type === 'actions') as { elements: { value: string }[] }).elements[0]!;
  const slack = new FakeSlack();
  const { gh, calls } = recordingGh(ghCode);
  const statePath = join(mkdtempSync(join(tmpdir(), 'approve-')), 'approvals.json');
  const press = (userId: string) =>
    handleApprovePress(
      { userId, channel: 'C0SUPPORT', messageTs: '1763060000.000009', threadTs: '1763050000.000100', value: button.value, blocks: message.blocks },
      { slack, gh, statePath, now: () => new Date('2026-11-14T10:44:00Z'), log: () => undefined },
    );
  return { slack, calls, statePath, press, value: button.value };
}

const MERGE = ['pr', 'merge', '9', '--repo', 'acme/demo-app', '--merge'];

describe('Approve fix', () => {
  it('the owner presses: exactly one merge call, the button becomes who approved and when', async () => {
    const { slack, calls, press, statePath } = setup();
    expect(await press('U0OWNER01')).toBe('merged');
    expect(calls).toEqual([MERGE]);
    expect(slack.updates).toHaveLength(1);
    const blocks = slack.updates[0]!.blocks!;
    expect(blocks.some((b) => b.type === 'actions')).toBe(false);
    const line = blocks.find((b) => b.block_id === APPROVE_BLOCK_ID) as { text: { text: string } };
    expect(line.text.text).toBe('Fix approved by <@U0OWNER01> on 14 Nov 2026, 10:44 UTC. Pull request #9 is merged.');
    // The other parts of the handoff stay.
    expect(blocks.filter((b) => String(b.block_id).startsWith('handoff_'))).toHaveLength(8);
    expect(JSON.parse(readFileSync(statePath, 'utf8'))['acme/demo-app#9'].by).toBe('U0OWNER01');
  });

  it('anyone else presses: zero merge calls, an ephemeral line, the message unchanged', async () => {
    const { slack, calls, press } = setup();
    expect(await press('U0SOMEONE')).toBe('not-owner');
    expect(calls).toEqual([]);
    expect(slack.updates).toEqual([]);
    expect(slack.ephemerals).toEqual([
      { channel: 'C0SUPPORT', user: 'U0SOMEONE', threadTs: '1763050000.000100', text: 'Only the owner named in this handoff can approve the fix. Nothing was merged.' },
    ]);
    expect(slack.posted).toEqual([]);
  });

  it('another user first, then the owner: one merge, by the owner', async () => {
    const { calls, press } = setup();
    await press('U0SOMEONE');
    expect(await press('U0OWNER01')).toBe('merged');
    expect(calls).toEqual([MERGE]);
  });

  it('a second press does nothing, also after a restart (state read from the file)', async () => {
    const { calls, press, slack } = setup();
    await press('U0OWNER01');
    expect(await press('U0OWNER01')).toBe('already-approved');
    expect(await press('U0SOMEONE')).toBe('already-approved');
    expect(calls).toHaveLength(1);
    expect(slack.updates).toHaveLength(1);
    expect(slack.ephemerals).toHaveLength(0);
  });

  it('two presses at the same moment merge once', async () => {
    const { calls, press } = setup();
    const results = await Promise.all([press('U0OWNER01'), press('U0OWNER01')]);
    expect(calls).toHaveLength(1);
    expect(results.sort()).toEqual(['in-progress', 'merged']);
  });

  it('a failed merge records nothing and tells the owner; a later press may try again', async () => {
    const { slack, calls, press, statePath } = setup(1);
    expect(await press('U0OWNER01')).toBe('merge-failed');
    expect(slack.updates).toEqual([]);
    expect(slack.ephemerals[0]!.text).toContain('The merge did not go through');
    expect(() => readFileSync(statePath, 'utf8')).toThrow();
    expect(await press('U0OWNER01')).toBe('merge-failed');
    expect(calls).toHaveLength(2);
  });

  it('rejects a value the tool did not write', () => {
    expect(parseApproveValue('not json')).toBeNull();
    expect(parseApproveValue(JSON.stringify({ repo: 'a/b; rm -rf', pr: 1, owner: 'U1' }))).toBeNull();
    expect(parseApproveValue(JSON.stringify({ repo: 'a/b', pr: '1', owner: 'U1' }))).toBeNull();
    expect(parseApproveValue(JSON.stringify({ repo: 'a/b', pr: 1, owner: '' }))).toBeNull();
    expect(parseApproveValue(JSON.stringify({ repo: 'a/b', pr: 1, owner: 'U1', group: 'g' }))).toEqual({ repo: 'a/b', pr: 1, owner: 'U1', group: 'g' });
  });
});
