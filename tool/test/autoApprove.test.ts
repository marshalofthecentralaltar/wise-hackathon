import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { handleApprovePress, type ApprovePress, type GhRunner } from '../src/approve.js';
import { approveFromThread, findApproveButton, type ThreadMessage } from '../src/autoApprove.js';
import { APPROVE_BLOCK_ID, buildHandoffMessage } from '../src/handoff.js';
import { FakeSlack } from '../src/slackPost.js';
import { handoff } from './fixtures-b2.js';

const CHANNEL = 'C0SUPPORT';
const THREAD = '1763050000.000100';

/** A thread as conversations.replies returns it: the first report, two progress lines, the handoff. */
function thread(withButton: boolean): ThreadMessage[] {
  const h = handoff();
  const message = buildHandoffMessage(withButton ? h : { ...h, fix: { ...h.fix, prUrl: null, prNumber: null } });
  return [
    { ts: THREAD, text: 'the card picture blinks', user: 'U0AGENT01' },
    { ts: '1763050000.000200', thread_ts: THREAD, text: '3 reports look like the same problem', bot_id: 'B0BOT' },
    { ts: '1763050000.000300', thread_ts: THREAD, text: 'Severity: low. Writing the smallest fix.', bot_id: 'B0BOT' },
    { ts: '1763050000.000400', thread_ts: THREAD, text: message.text, bot_id: 'B0BOT', blocks: message.blocks },
  ];
}

function harness(messages: ThreadMessage[]) {
  const slack = new FakeSlack();
  const presses: ApprovePress[] = [];
  const ghCalls: string[][] = [];
  const gh: GhRunner = async (args) => {
    ghCalls.push(args);
    return { code: 0, stdout: '', stderr: '' };
  };
  const statePath = join(mkdtempSync(join(tmpdir(), 'auto-approve-')), 'approvals.json');
  const run = () =>
    approveFromThread({
      channel: CHANNEL,
      threadTs: THREAD,
      read: async (c, t) => (c === CHANNEL && t === THREAD ? messages : []),
      slack,
      // The real handler, counted.
      approve: (press, deps) => {
        presses.push(press);
        return handleApprovePress(press, deps);
      },
      approveDeps: { gh, statePath, log: () => undefined },
    });
  return { slack, presses, ghCalls, run };
}

describe('approveFromThread', () => {
  it('a handoff with the button: one press of the real handler, as the owner named in the value; it merges and replaces the button', async () => {
    const h = harness(thread(true));
    const out = await h.run();
    expect(h.presses).toHaveLength(1);
    const press = h.presses[0]!;
    const value = JSON.parse(press.value) as { owner: string; pr: number; repo: string };
    expect(press.userId).toBe(value.owner);
    expect(press.userId).toBe('U0OWNER01');
    expect(press.messageTs).toBe('1763050000.000400');
    expect(press.threadTs).toBe(THREAD);
    expect(out).toMatchObject({ pressed: true, result: 'merged', owner: 'U0OWNER01', pr: 9 });
    expect(h.ghCalls).toEqual([['pr', 'merge', '9', '--repo', 'acme/demo-app', '--merge']]);
    expect(h.slack.updates).toHaveLength(1);
    expect(h.slack.updates[0]!.blocks!.some((b) => b.type === 'actions')).toBe(false);
    const line = h.slack.updates[0]!.blocks!.find((b) => b.block_id === APPROVE_BLOCK_ID) as { text: { text: string } };
    expect(line.text.text).toMatch(/^Fix approved by <@U0OWNER01> on /);
  });

  it('a thread without the button: a refusal and no call', async () => {
    const h = harness(thread(false));
    const out = await h.run();
    expect(out).toEqual({ pressed: false, refused: expect.stringMatching(/no "Approve fix" button/) });
    expect(h.presses).toHaveLength(0);
    expect(h.ghCalls).toHaveLength(0);
    expect(h.slack.updates).toHaveLength(0);
  });

  it('a button already replaced by the approved line is not found again', () => {
    const msgs = thread(true);
    const last = msgs[3]!;
    last.blocks = last.blocks!.map((b) => (b.block_id === APPROVE_BLOCK_ID ? { type: 'section', block_id: APPROVE_BLOCK_ID, text: { type: 'mrkdwn', text: 'Fix approved by <@U0OWNER01>' } } : b));
    expect(findApproveButton(msgs)).toBeNull();
  });

  it('a button with a value the tool did not write: a refusal and no call', async () => {
    const msgs = thread(true);
    const actions = msgs[3]!.blocks!.find((b) => b.type === 'actions') as { elements: { value: string }[] };
    actions.elements[0]!.value = '{"repo":"x/y","pr":1}';
    const h = harness(msgs);
    const out = await h.run();
    expect(out.pressed).toBe(false);
    expect(h.presses).toHaveLength(0);
  });
});
