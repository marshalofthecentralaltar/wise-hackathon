import { describe, expect, it } from 'vitest';
import type { ThreadMessage } from '../src/autoApprove.js';
import { pickReports, readHandoff, runFullCase, type FullRunDeps, type Problem } from '../src/fullRun.js';
import { buildHandoffMessage } from '../src/handoff.js';
import type { MonitoringFinding } from '../src/types.js';
import { handoff } from './fixtures-b2.js';

const quiet = (over: Partial<MonitoringFinding> = {}): MonitoringFinding => ({
  source: 'prometheus',
  errorsPerSecond: 0,
  alertsFiring: [],
  p95Seconds: null,
  logLinesRead: 0,
  logErrors: 0,
  logWarnings: 0,
  showsProblem: false,
  summary: 'Nothing found. 0 errors per second on /card.',
  ...over,
} as MonitoringFinding);

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
    monitoring: async (page) => (calls.push(`monitoring ${page}`), quiet()),
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
    waitDeployed: async () => ({ ok: true, note: 'deployed' }),
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
    expect(line.seconds.mergedToStable).toBe(0);
    expect(line.pageCheck).toBe('checked');
    expect(line.monitoringSource).toBe('prometheus');
    expect(w.calls.indexOf('browserCheck replaced')).toBeLessThan(w.calls.indexOf('post'));
    expect(w.calls.indexOf('monitoring card')).toBeLessThan(w.calls.indexOf('post'));
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

describe('runFullCase: the stable check cannot be skipped silently', () => {
  it('flicker with --approve and no deployment file: fails with a plain reason', async () => {
    const w = world('flicker', { waitDeployed: async () => null });
    const line = await runFullCase(w.deps);
    expect(line.ok).toBe(false);
    expect(line.merged).toBe(true);
    expect(line.failed).toContain('the redeployed page was not checked: no deployment file');
    expect(line.pageCheck).toBe('not checked: no deployment file');
    expect(w.calls).not.toContain('browserCheck stable');
  });

  it('with --no-deploy-check: passes, does not wait for a deployment, and the line says the page was not checked', async () => {
    let waited = false;
    const w = world('flicker', { deployCheck: false, waitDeployed: async () => ((waited = true), null) });
    const line = await runFullCase(w.deps);
    expect(line.failed).toEqual([]);
    expect(line.ok).toBe(true);
    expect(line.pageCheck).toBe('not checked: --no-deploy-check');
    expect(line.seconds.mergedToStable).toBeNull();
    expect(waited).toBe(false);
  });
});

describe('runFullCase: the starting state reads monitoring the way the tool will', () => {
  it('monitoring that cannot be read stops the run before any report is posted', async () => {
    const w = world('amount', { monitoring: async () => quiet({ source: 'metrics-endpoint', unavailable: true, showsProblem: false, summary: 'Monitoring could not be read. Prometheus and /metrics did not answer.' }) });
    const line = await runFullCase(w.deps);
    expect(line.ok).toBe(false);
    expect(line.stoppedBefore).toBe('starting-state');
    expect(line.failed.join(' ')).toMatch(/could not be read before the run .*Prometheus and \/metrics did not answer/);
    expect(line.monitoringSource).toBe('metrics-endpoint');
    expect(w.calls).not.toContain('post');
    expect(w.calls).not.toContain('startTool');
  });

  it('monitoring that already shows a problem on the page stops the run before any report is posted', async () => {
    let asked = '';
    const w = world('flicker', { monitoring: async (page) => ((asked = page), quiet({ showsProblem: true, errorsPerSecond: 0.2, summary: '0.2 errors per second on /card; CardPageErrors firing.' })) });
    const line = await runFullCase(w.deps);
    expect(line.ok).toBe(false);
    expect(line.stoppedBefore).toBe('starting-state');
    expect(line.failed.join(' ')).toMatch(/already shows a problem on the card page .*CardPageErrors firing/);
    expect(line.monitoringSource).toBe('prometheus');
    expect(asked).toBe('card');
    expect(w.calls).not.toContain('post');
  });

  it('--require-prometheus: a reading from the /metrics fallback stops the run; without the flag it goes on', async () => {
    const fallback = async () => quiet({ source: 'metrics-endpoint', summary: 'Nothing found (from /metrics).' });
    const w = world('amount', { requirePrometheus: true, monitoring: fallback });
    const line = await runFullCase(w.deps);
    expect(line.ok).toBe(false);
    expect(line.stoppedBefore).toBe('starting-state');
    expect(line.failed.join(' ')).toMatch(/came from metrics-endpoint, not prometheus \(--require-prometheus\)/);
    expect(line.monitoringSource).toBe('metrics-endpoint');
    expect(w.calls).not.toContain('post');
    const relaxed = await runFullCase(world('amount', { monitoring: fallback }).deps);
    expect(relaxed.ok).toBe(true);
    expect(relaxed.monitoringSource).toBe('metrics-endpoint');
  });

  it('--require-prometheus: the tool\'s own step 3 reading from /metrics during the run fails it; the line names the source', async () => {
    const timings = (src?: 'prometheus' | 'metrics-endpoint') => async () => ({ groupId: 'group-1', startedAt: 'x', secondsByStep: {}, totalSeconds: 40, ...(src ? { monitoringSource: src } : {}) });
    const fellBack = await runFullCase(world('amount', { requirePrometheus: true, timingsSince: timings('metrics-endpoint') }).deps);
    expect(fellBack.ok).toBe(false);
    expect(fellBack.monitoringSource).toBe('prometheus');
    expect(fellBack.runMonitoringSource).toBe('metrics-endpoint');
    expect(fellBack.failed.join(' ')).toMatch(/the tool's own monitoring step read metrics-endpoint, not prometheus/);
    const unrecorded = await runFullCase(world('amount', { requirePrometheus: true, timingsSince: timings() }).deps);
    expect(unrecorded.ok).toBe(false);
    expect(unrecorded.failed.join(' ')).toMatch(/read no recorded source, not prometheus/);
    const good = await runFullCase(world('amount', { requirePrometheus: true, timingsSince: timings('prometheus') }).deps);
    expect(good.ok).toBe(true);
    expect(good.runMonitoringSource).toBe('prometheus');
    const relaxed = await runFullCase(world('amount', { timingsSince: timings('metrics-endpoint') }).deps);
    expect(relaxed.ok).toBe(true);
    expect(relaxed.runMonitoringSource).toBe('metrics-endpoint');
  });

  it('a tool that does not start: the run fails with the reason and posts nothing', async () => {
    const w = world('amount', { startTool: async () => { throw new Error('no "Listening in" line within 60 s'); } });
    const line = await runFullCase(w.deps);
    expect(line.ok).toBe(false);
    expect(line.failed.join(' ')).toMatch(/the tool did not start: no "Listening in" line within 60 s/);
    expect(w.calls).not.toContain('post');
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
