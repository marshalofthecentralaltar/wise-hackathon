import { describe, expect, it } from 'vitest';
import type { ThreadMessage } from '../src/autoApprove.js';
import { pickReports, readHandoff, runFullCase, type FullRunDeps, type Problem } from '../src/fullRun.js';
import { buildHandoffMessage } from '../src/handoff.js';
import { handoff } from './fixtures-b2.js';

const BOT = { userId: 'U0BOT', botId: 'B0BOT' };

/** A stand-in world: every outside call recorded; the thread fills in after the reports are posted. */
function world(problem: Problem, over: Partial<FullRunDeps> & { handoffMessage?: ThreadMessage; extraBranchAfter?: string } = {}) {
  const calls: string[] = [];
  let clock = 0;
  let posted = false;
  const h = handoff();
  const message = over.handoffMessage ?? (() => {
    const m = buildHandoffMessage(problem === 'flicker' ? h : { ...h, verdict: { ...h.verdict, severity: 'high' }, fix: { ...h.fix, prUrl: null, prNumber: null } });
    return { ts: '1763050012.000400', thread_ts: '1763050000.000100', text: m.text, bot_id: BOT.botId, blocks: m.blocks };
  })();
  let snapshots = 0;
  const deps: FullRunDeps = {
    problem,
    via: 'direct',
    approve: problem === 'flicker',
    appUrl: 'http://localhost:3400',
    toolAppUrl: 'http://localhost:3400',
    ownBot: BOT,
    reset: async () => (calls.push('reset'), { ok: true, reason: 'not needed' }),
    openToolPulls: async () => (calls.push('openToolPulls'), []),
    appAnswers: async () => (calls.push('appAnswers'), true),
    browserCheck: async (e) => (calls.push(`browserCheck ${e}`), { pass: true, output: '{}' }),
    snapshot: async () => {
      calls.push('snapshot');
      snapshots++;
      return { branches: ['main', 'lane-a', ...(snapshots > 1 && over.extraBranchAfter ? [over.extraBranchAfter] : [])], maxPull: 8 };
    },
    startTool: async () => void calls.push('startTool'),
    post: async () => {
      calls.push('post');
      posted = true;
      return ['1763050000.000100', '1763050003.000100', '1763050006.000100'];
    },
    readThread: async (ts) =>
      posted && ts === '1763050000.000100'
        ? [{ ts, text: 'report 1', user: 'U0SUPPORTDESK' }, { ts: '1763050002.500000', thread_ts: ts, text: '3 reports look like', bot_id: BOT.botId }, message]
        : [],
    permalink: async (ts) => `https://slack.example/p${ts}`,
    approveFromThread: async () => (calls.push('approve'), { pressed: true, result: 'merged', owner: 'U0OWNER01', pr: 9, repo: 'acme/demo-app', messageTs: message.ts! }),
    pullMerged: async () => true,
    waitDeployed: async () => null,
    timingsSince: async () => ({ groupId: 'group-1', startedAt: 'x', secondsByStep: {}, totalSeconds: 40 }),
    sleep: async (ms) => void (clock += ms),
    now: () => clock,
    log: () => undefined,
    ...over,
  };
  return { deps, calls };
}

describe('runFullCase: the starting state', () => {
  it('a tool pull request still open: the run fails with a plain reason before any report is posted', async () => {
    const w = world('flicker', { openToolPulls: async () => [12] });
    const line = await runFullCase(w.deps);
    expect(line.ok).toBe(false);
    expect(line.stoppedBefore).toBe('starting-state');
    expect(line.failed.join(' ')).toMatch(/the tool still has open pull requests: #12/);
    expect(w.calls).not.toContain('post');
    expect(w.calls).not.toContain('startTool');
  });

  it('a card page that does not flicker: the run fails before any report is posted', async () => {
    const w = world('flicker', { browserCheck: async () => ({ pass: false, output: '{"card_picture_replaced":false}' }) });
    const line = await runFullCase(w.deps);
    expect(line.ok).toBe(false);
    expect(line.failed.join(' ')).toMatch(/does not flicker before the run/);
    expect(w.calls).not.toContain('post');
  });

  it('an app the tool cannot read (the silent all-high trap): the amount run fails before posting', async () => {
    const w = world('amount', { appAnswers: async () => false });
    const line = await runFullCase(w.deps);
    expect(line.ok).toBe(false);
    expect(line.failed.join(' ')).toMatch(/does not answer .* would judge every problem high/);
    expect(w.calls).not.toContain('post');
  });

  it('a browser check on another app than the tool reads: fails before posting', async () => {
    const w = world('flicker', { appUrl: 'http://localhost:3000' });
    const line = await runFullCase(w.deps);
    expect(line.failed.join(' ')).toMatch(/must be the same app/);
    expect(w.calls).not.toContain('post');
  });

  it('a reset that did not finish: stops before anything else', async () => {
    const w = world('flicker', { reset: async () => ({ ok: false, reason: 'main was not restored' }) });
    const line = await runFullCase(w.deps);
    expect(line.stoppedBefore).toBe('reset');
    expect(w.calls).toEqual([]);
  });
});

describe('runFullCase: the case rules', () => {
  it('flicker: low, a pull request, approved and merged gives ok, timed from the Slack ts values', async () => {
    const w = world('flicker');
    const line = await runFullCase(w.deps);
    expect(line.failed).toEqual([]);
    expect(line.ok).toBe(true);
    expect(line).toMatchObject({ severity: 'low', commit: 'abcdef1', kind: 'fix', prUrl: 'https://github.com/acme/demo-app/pull/9', merged: true });
    expect(line.seconds.firstToolMessage).toBe(2.5);
    expect(line.seconds.handoff).toBe(12);
    expect(line.seconds.mergedToStable).toBeNull();
    expect(w.calls.indexOf('browserCheck replaced')).toBeLessThan(w.calls.indexOf('post'));
  });

  it('amount: high, no pull request and no new branch gives ok; a new branch on GitHub fails it', async () => {
    const good = await runFullCase(world('amount').deps);
    expect(good.failed).toEqual([]);
    expect(good.ok).toBe(true);
    expect(good.kind).toBe('none');
    const bad = await runFullCase(world('amount', { extraBranchAfter: 'triage/fix-x' }).deps);
    expect(bad.ok).toBe(false);
    expect(bad.failed.join(' ')).toMatch(/new branches on GitHub: triage\/fix-x/);
  });

  it('a reply in the thread from someone other than the tool fails the run', async () => {
    const w = world('amount');
    const base = w.deps.readThread;
    w.deps.readThread = async (ts) => {
      const msgs = await base(ts);
      return msgs.length ? [...msgs, { ts: '1763050013.000000', thread_ts: ts, text: 'Looking into it', user: 'U0OTHERBOT' }] : msgs;
    };
    const line = await runFullCase(w.deps);
    expect(line.ok).toBe(false);
    expect(line.strangerReplies).toEqual(['Looking into it']);
  });
});

describe('readHandoff and pickReports', () => {
  it('reads severity, commit, pull request and kind from the handoff blocks', () => {
    const m = buildHandoffMessage({ ...handoff(), fix: { ...handoff().fix, kind: 'undo' } });
    expect(readHandoff([{ ts: '1.2', blocks: m.blocks }])).toMatchObject({ severity: 'low', commit: 'abcdef1', prUrl: 'https://github.com/acme/demo-app/pull/9', kind: 'undo' });
  });

  it('three English reports per problem, none saying it is a test', () => {
    for (const p of ['flicker', 'amount'] as const) {
      const texts = pickReports(p);
      expect(texts).toHaveLength(3);
      expect(texts.some((t) => /test/i.test(t))).toBe(false);
    }
  });
});
