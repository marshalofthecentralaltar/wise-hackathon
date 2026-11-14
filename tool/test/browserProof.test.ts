import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { handleApprovePress, type ApprovePress, type GhRunner } from '../src/approve.js';
import {
  approveWithProof,
  fixedLine,
  realCheckRunner,
  reproductionLine,
  settleProofs,
  withReproduction,
  PAGE_CHECKS,
  type CheckRun,
  type CheckRunner,
  type ProofDeps,
  type ProofEvent,
} from '../src/browserProof.js';
import { buildHandoffMessage } from '../src/handoff.js';
import { runPipeline, type PipelineDeps } from '../src/pipeline.js';
import { FakeSlack } from '../src/slackPost.js';
import type { CodeSteps, Page, ReportGroup } from '../src/types.js';
import { FIX_NONE, FIX_PR, HIGH, INVESTIGATION, LOW, MONITORING, OWNER, group, handoff } from './fixtures-b2.js';

const FLICKER_REPRODUCED: CheckRun = {
  ran: true,
  pass: true,
  seconds: 7.2,
  result: { card_picture_replaced: true, balance_changed: true, min_opacity_seen: 0.05, samples: 49, console_errors: 0, card_picture_replacements: 5, seconds_watched: 5 },
};
const FLICKER_STABLE: CheckRun = {
  ran: true,
  pass: true,
  seconds: 7.0,
  result: { card_picture_replaced: false, balance_changed: true, min_opacity_seen: 1, samples: 49, console_errors: 0, card_picture_replacements: 0, seconds_watched: 5 },
};
const FLICKER_STILL: CheckRun = { ...FLICKER_REPRODUCED, pass: false };
const AMOUNT_WRONG: CheckRun = {
  ran: true,
  pass: true,
  seconds: 2.1,
  result: { rows: 6, rows_differ: 1, differ: [{ row: 3, id: 't3', stored_cents: 204000, shown: '2,40.00 EUR', shown_cents: 24000 }] },
};
const NO_BROWSER: CheckRun = { ran: false, pass: false, seconds: 0.4, result: { error: 'browserType.launch: Chromium distribution not found' }, error: 'browserType.launch: Chromium distribution not found' };

const tmp = (prefix: string) => mkdtempSync(join(tmpdir(), prefix));

function groupOn(page: Page, id: string): ReportGroup {
  return { ...group(id), page };
}

/** Stand-ins for steps 6 to 8; `fix` gives a pull request for low and nothing for high. */
function steps(verdict = LOW): CodeSteps {
  return {
    investigate: async () => {
      await new Promise((r) => setTimeout(r, 5));
      return INVESTIGATION;
    },
    classifyCustomerEffect: async () => 'appearance',
    judge: async () => verdict,
    fix: async () => (verdict.severity === 'low' ? FIX_PR : FIX_NONE),
  };
}

function pipelineDeps(code: CodeSteps, slack: FakeSlack): PipelineDeps {
  return {
    code,
    slack,
    checkMonitoring: async () => MONITORING,
    listRecentChanges: async () => [],
    findOwner: async () => OWNER,
    customerSentence: async () => 'We know about the blinking picture and are working on it.',
    timingsPath: null,
    log: () => undefined,
  };
}

function proofDeps(slack: FakeSlack, over: Partial<ProofDeps> = {}): ProofDeps & { logs: string[]; events: ProofEvent[] } {
  const logs: string[] = [];
  const events: ProofEvent[] = [];
  return {
    slack,
    statePath: join(tmp('proof-'), 'reproductions.json'),
    deployDir: tmp('deploy-'),
    baseUrl: 'http://localhost:1',
    retryMs: 5,
    pollMs: 5,
    proofWindowMs: 2_000,
    enabled: true,
    log: (m) => logs.push(m),
    emit: (e) => events.push(e),
    logs,
    events,
    ...over,
  };
}

/** A real press of "Approve fix" for the handoff of group `id`, with a fake gh. */
function press(id: string, slack: FakeSlack) {
  const message = buildHandoffMessage(handoff({ group: group(id) }));
  const button = (message.blocks.find((b) => b.type === 'actions') as { elements: { value: string }[] }).elements[0]!;
  const gh: GhRunner = async () => ({ code: 0, stdout: '', stderr: '' });
  const p: ApprovePress = { userId: 'U0OWNER01', channel: 'C0SUPPORT', messageTs: '1763060000.000009', threadTs: group(id).threadTs, value: button.value, blocks: message.blocks };
  const approveDeps = { slack, gh, statePath: join(tmp('approve-'), 'approvals.json'), now: () => new Date('2026-11-14T10:44:00Z'), log: () => undefined };
  return { p, approveDeps };
}

const texts = (slack: FakeSlack) => slack.posted.map((m) => m.text);
const handoffPost = (slack: FakeSlack) => slack.posted.find((m) => m.blocks);

describe('the lines', () => {
  it('a reproduced flicker names the count and the seconds from the check', () => {
    expect(reproductionLine('card', FLICKER_REPRODUCED)).toBe('Reproduced in a browser: the card picture was replaced 5 times in 5 seconds.');
  });
  it('a reproduced wrong amount names the row, the stored and the shown amount', () => {
    expect(reproductionLine('transfers', AMOUNT_WRONG)).toBe(
      'Reproduced in a browser: 1 of 6 rows on the transfers page shows an amount that differs from the stored one (row 3: stored 2,040.00, shown 2,40.00 EUR).',
    );
  });
  it('a check that measured no problem says what it measured', () => {
    expect(reproductionLine('card', { ...FLICKER_STABLE, pass: false })).toBe(
      'Could not reproduce in a browser: the card picture was not replaced in 5 seconds (lowest opacity seen 1, the balance changed).',
    );
    expect(reproductionLine('transfers', { ran: true, pass: false, seconds: 1, result: { rows: 6, rows_differ: 0, differ: [] } })).toBe(
      'Could not reproduce in a browser: all 6 rows on the transfers page show the stored amount.',
    );
  });
  it('a browser that cannot start is said plainly', () => {
    expect(reproductionLine('card', NO_BROWSER)).toBe('Could not open the card page in a browser to reproduce the reports: browserType.launch: Chromium distribution not found.');
  });
  it('the fixed line carries the measurement and the count before the fix', () => {
    const before = { groupId: 'g', page: 'card' as const, channel: 'C', threadTs: 't', check: 'check-flicker.mjs', startedAt: '', ran: true, reproduced: true, result: FLICKER_REPRODUCED.result };
    expect(fixedLine('card', FLICKER_STABLE, before)).toBe('Deployed. Checked the card page in a browser: the card picture was not replaced in 5 seconds (before the fix: replaced 5 times).');
  });
  it('the account page has no check', () => {
    expect(PAGE_CHECKS.account).toBeUndefined();
  });
});

describe('the reproduction beside investigate', () => {
  it('posts the line in the thread before the handoff and changes nothing in the handoff', async () => {
    const slack = new FakeSlack();
    const d = proofDeps(slack, { runCheck: async () => FLICKER_REPRODUCED });
    await runPipeline(group('g-repro'), pipelineDeps(withReproduction(steps(), d), slack));
    await settleProofs(5_000);
    const line = 'Reproduced in a browser: the card picture was replaced 5 times in 5 seconds.';
    expect(texts(slack)).toContain(line);
    expect(slack.posted.find((m) => m.text === line)?.threadTs).toBe(group('g-repro').threadTs);
    expect(d.events.map((e) => `${e.step}:${e.state}`)).toEqual(['reproduction:start', 'reproduction:done']);
  });

  it('a check that never finishes does not hold up investigate', async () => {
    const slack = new FakeSlack();
    let release: (r: CheckRun) => void = () => undefined;
    const d = proofDeps(slack, { runCheck: () => new Promise<CheckRun>((r) => (release = r)) });
    const wrapped = withReproduction(steps(), d);
    const r = await wrapped.investigate({ group: group('g-hang'), owner: OWNER, monitoring: MONITORING, commits: [] });
    expect(r).toBe(INVESTIGATION);
    expect(slack.posted).toEqual([]);
    // Let the check end, so no background work outlives this test.
    release(FLICKER_REPRODUCED);
    await settleProofs(5_000);
    expect(texts(slack)).toEqual(['Reproduced in a browser: the card picture was replaced 5 times in 5 seconds.']);
  });

  it('a page with no check posts nothing', async () => {
    const slack = new FakeSlack();
    let calls = 0;
    const d = proofDeps(slack, { runCheck: async () => (calls++, FLICKER_REPRODUCED) });
    await withReproduction(steps(), d).investigate({ group: groupOn('account', 'g-acc'), owner: OWNER, monitoring: MONITORING, commits: [] });
    await settleProofs(5_000);
    expect(calls).toBe(0);
    expect(slack.posted).toEqual([]);
  });
});

describe('criterion 3: a browser that cannot start does not stop a run', () => {
  it('the runner rejects: investigate returns its result, the approval returns merged, the thread says it plainly', async () => {
    const slack = new FakeSlack();
    const d = proofDeps(slack, { runCheck: async () => Promise.reject(new Error('spawn EACCES: no browser')) });
    const code = withReproduction(steps(), d);
    const r = await code.investigate({ group: group('g-nob'), owner: OWNER, monitoring: MONITORING, commits: [] });
    expect(r).toBe(INVESTIGATION);
    await settleProofs(5_000);
    expect(texts(slack)).toEqual(['Could not open the card page in a browser to reproduce the reports: spawn EACCES: no browser.']);

    const { p, approveDeps } = press('g-nob', slack);
    expect(await approveWithProof(d)(p, approveDeps)).toBe('merged');
    await settleProofs(10_000);
    expect(texts(slack).at(-1)).toBe('The pull request is merged, but the card page could not be checked in a browser within 2 seconds: spawn EACCES: no browser.');
  });

  it('the real runner with a browser that does not exist measures nothing and does not throw', async () => {
    const saved = process.env.BROWSER_CHANNEL;
    process.env.BROWSER_CHANNEL = 'no-such-browser';
    try {
      const run = await realCheckRunner(PAGE_CHECKS.card!.file, 'replaced', 'http://localhost:1');
      expect(run.ran).toBe(false);
      expect(run.pass).toBe(false);
      expect(run.error).toBeTruthy();
    } finally {
      if (saved === undefined) delete process.env.BROWSER_CHANNEL;
      else process.env.BROWSER_CHANNEL = saved;
    }
  }, 30_000);

  it('a missing check file measures nothing', async () => {
    const run = await realCheckRunner(join(tmp('nocheck-'), 'check-missing.mjs'), 'replaced', 'http://localhost:1');
    expect(run).toMatchObject({ ran: false, pass: false });
    expect(run.error).toContain('missing');
  });
});

describe('criterion 4: with the proof and without it, the same inputs give the same results', () => {
  const cases: { name: string; page: Page; verdict: typeof LOW; run: CheckRun }[] = [
    { name: 'flicker, reproduced', page: 'card', verdict: LOW, run: FLICKER_REPRODUCED },
    { name: 'flicker, no browser', page: 'card', verdict: LOW, run: NO_BROWSER },
    { name: 'wrong amount, reproduced', page: 'transfers', verdict: HIGH, run: AMOUNT_WRONG },
    { name: 'account, no check', page: 'account', verdict: LOW, run: FLICKER_REPRODUCED },
  ];
  for (const c of cases) {
    it(c.name, async () => {
      const outcome = async (on: boolean) => {
        const slack = new FakeSlack();
        const judged: unknown[] = [];
        const investigated: unknown[] = [];
        const base = steps(c.verdict);
        const recorded: CodeSteps = {
          ...base,
          investigate: async (input) => {
            const r = await base.investigate(input);
            investigated.push(r);
            return r;
          },
          judge: async (input) => {
            const v = await base.judge(input);
            judged.push(v);
            return v;
          },
        };
        const d = proofDeps(slack, { enabled: on, runCheck: async () => c.run, proofWindowMs: 300 });
        const g = groupOn(c.page, `g-meta-${c.page}`);
        await runPipeline(g, pipelineDeps(withReproduction(recorded, d), slack));
        const hand = handoffPost(slack);
        let approval: string | null = null;
        if (c.verdict.severity === 'low') {
          const { p, approveDeps } = press(g.id, new FakeSlack());
          approval = await approveWithProof(d)(p, approveDeps);
        }
        await settleProofs(5_000);
        return { investigated, judged, handoffText: hand?.text, handoffBlocks: hand?.blocks, approval, lines: texts(slack) };
      };
      const off = await outcome(false);
      const on = await outcome(true);
      expect(on.investigated).toEqual(off.investigated);
      expect(on.judged).toEqual(off.judged);
      expect(on.handoffText).toEqual(off.handoffText);
      expect(on.handoffBlocks).toEqual(off.handoffBlocks);
      expect(on.approval).toEqual(off.approval);
      // Off: no line from the proof at all.
      expect(off.lines.some((t) => /in a browser/.test(t))).toBe(false);
      if (c.page !== 'account') expect(on.lines.some((t) => /in a browser/.test(t))).toBe(true);
    });
  }
});

describe('the after-fix proof', () => {
  it('waits for the redeploy, then posts the measured line with the count before the fix', async () => {
    const slack = new FakeSlack();
    const calls: string[] = [];
    let deployed = false;
    const d = proofDeps(slack, {
      proofWindowMs: 5_000,
      runCheck: async (_f, expectArg) => {
        calls.push(`${expectArg}:${deployed ? 'new' : 'old'}`);
        return expectArg === 'replaced' ? FLICKER_REPRODUCED : FLICKER_STABLE;
      },
    });
    writeFileSync(join(d.deployDir!, '.deployed.json'), JSON.stringify({ commit: 'aaaaaaa', at: 'x' }));
    await withReproduction(steps(), d).investigate({ group: group('g-after'), owner: OWNER, monitoring: MONITORING, commits: [] });
    await settleProofs(5_000);
    const { p, approveDeps } = press('g-after', slack);
    expect(await approveWithProof(d)(p, approveDeps)).toBe('merged');
    await new Promise((r) => setTimeout(r, 60));
    expect(calls).toEqual(['replaced:old']);
    deployed = true;
    writeFileSync(join(d.deployDir!, '.deployed.json'), JSON.stringify({ commit: 'bbbbbbb', at: 'y' }));
    await settleProofs(10_000);
    expect(calls).toEqual(['replaced:old', 'stable:new']);
    expect(texts(slack).at(-1)).toBe('Deployed. Checked the card page in a browser: the card picture was not replaced in 5 seconds (before the fix: replaced 5 times).');
    expect(d.events.map((e) => `${e.step}:${e.state}`)).toEqual([
      'reproduction:start',
      'reproduction:done',
      'approval:done',
      'deploy:start',
      'deploy:done',
      'proof:start',
      'proof:done',
    ]);
    const proof = d.events.at(-1)!.evidence as { check: string; before: unknown; after: unknown; pass: boolean; summary: string };
    expect(proof).toMatchObject({ check: 'check-flicker.mjs', before: FLICKER_REPRODUCED.result, after: FLICKER_STABLE.result, pass: true });
  });

  it('a page that still flickers after the window says so with the last measurement', async () => {
    const slack = new FakeSlack();
    const d = proofDeps(slack, { proofWindowMs: 200, runCheck: async (_f, e) => (e === 'replaced' ? FLICKER_REPRODUCED : FLICKER_STILL) });
    await withReproduction(steps(), d).investigate({ group: group('g-still'), owner: OWNER, monitoring: MONITORING, commits: [] });
    await settleProofs(5_000);
    const { p, approveDeps } = press('g-still', slack);
    await approveWithProof(d)(p, approveDeps);
    await settleProofs(5_000);
    expect(texts(slack).at(-1)).toBe(
      'The pull request is merged, but the page still shows the problem after 0 seconds (last check: the card picture was replaced 5 times in 5 seconds).',
    );
  });

  it('a press that does not merge starts no proof', async () => {
    const slack = new FakeSlack();
    let calls = 0;
    const d = proofDeps(slack, { runCheck: async () => (calls++, FLICKER_STABLE) });
    const { p, approveDeps } = press('g-notowner', slack);
    expect(await approveWithProof(d)({ ...p, userId: 'U0SOMEONE' }, approveDeps)).toBe('not-owner');
    await settleProofs(5_000);
    expect(calls).toBe(0);
  });
});

describe('criterion 5: a throwing emit changes nothing', () => {
  it('the reproduction line, the approval result and the proof line all survive', async () => {
    const slack = new FakeSlack();
    const d = proofDeps(slack, {
      emit: () => {
        throw new Error('the process screen is down');
      },
      runCheck: async (_f, e) => (e === 'replaced' ? FLICKER_REPRODUCED : FLICKER_STABLE),
    });
    await runPipeline(group('g-emit'), pipelineDeps(withReproduction(steps(), d), slack));
    await settleProofs(5_000);
    expect(texts(slack)).toContain('Reproduced in a browser: the card picture was replaced 5 times in 5 seconds.');
    const { p, approveDeps } = press('g-emit', slack);
    expect(await approveWithProof(d)(p, approveDeps)).toBe('merged');
    await settleProofs(5_000);
    expect(texts(slack).at(-1)).toBe('Deployed. Checked the card page in a browser: the card picture was not replaced in 5 seconds (before the fix: replaced 5 times).');
    expect(d.logs.some((l) => l.includes('emit threw'))).toBe(true);
  });
});

describe('the default approval handler is the real one', () => {
  it('approveWithProof with nothing injected calls handleApprovePress', () => {
    expect(approveWithProof({ slack: new FakeSlack(), enabled: false })).toBe(handleApprovePress);
  });
});
