import { describe, expect, it } from 'vitest';
import { caseLine, summarizeRuns, type CountedLine } from '../src/countedRuns.js';

const flicker = (n: number, ok = true): CountedLine => ({
  problem: 'flicker',
  ok,
  failed: ok ? [] : ['the card page still flickers after the merge was deployed'],
  severity: 'low',
  kind: 'fix',
  prUrl: `https://github.com/acme/demo-app/pull/${n}`,
  seconds: { firstToolMessage: 2.1, handoff: 61.4, approvalToMerged: 3.2, mergedToStable: 21.5 },
  timings: { groupId: `group-${n}`, startedAt: 'x', secondsByStep: { pattern: 4.1, monitoring: 0.3, changes: 1.2, owner: 0.4, investigation: 30.5, verdict: 6.2, fix: 14.9 }, totalSeconds: 58 },
  monitoringSource: 'prometheus',
  runMonitoringSource: 'prometheus',
  pageCheck: 'checked',
  toolStopped: true,
});
const amount: CountedLine = {
  problem: 'amount',
  ok: true,
  failed: [],
  severity: 'high',
  kind: 'none',
  prUrl: null,
  seconds: { firstToolMessage: 2, handoff: 44, approvalToMerged: null, mergedToStable: null },
  timings: { groupId: 'group-9', startedAt: 'x', secondsByStep: { pattern: 3.9, monitoring: 0.2, changes: 1, owner: 0.3, investigation: 28, verdict: 5.5 }, totalSeconds: 40 },
  monitoringSource: 'prometheus',
  runMonitoringSource: 'prometheus',
  pageCheck: null,
  toolStopped: true,
};
/** A run that printed no line at all (counted-runs records it this way). */
const crashed: CountedLine = { problem: 'amount', ok: false, failed: ['full-run printed no line (exit 1)'] };

describe('counted-runs summary', () => {
  const lines = [flicker(21), flicker(22, false), flicker(23), amount, crashed, { ...amount }];
  const md = summarizeRuns(lines, { command: 'npm run counted-runs -- --flicker 3 --amount 3' });

  it('one row per run with every column, in order', () => {
    const rows = md.split('\n').filter((l) => l.startsWith('| '));
    expect(rows).toHaveLength(2 + 6);
    expect(rows[0]).toBe(
      '| run | problem | ok | severity | outcome | pull request | pattern s | monitoring s | changes s | owner s | investigation s | verdict s | fix s | first report to handoff s | approval to merged s | merged to page stable s | monitoring source | tool monitoring source | page check | tool stopped |',
    );
    expect(rows[2]).toBe('| 1 | flicker | yes | low | fix | #21 | 4.1 | 0.3 | 1.2 | 0.4 | 30.5 | 6.2 | 14.9 | 61.4 | 3.2 | 21.5 | prometheus | prometheus | checked | true |');
    expect(rows[3]).toBe('| 2 | flicker | NO | low | fix | #22 | 4.1 | 0.3 | 1.2 | 0.4 | 30.5 | 6.2 | 14.9 | 61.4 | 3.2 | 21.5 | prometheus | prometheus | checked | true |');
    expect(rows[5]).toBe('| 4 | amount | yes | high | none | - | 3.9 | 0.2 | 1 | 0.3 | 28 | 5.5 | - | 44 | - | - | prometheus | prometheus | - | true |');
    expect(rows[6]).toBe('| 5 | amount | NO | - | none | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - |');
  });

  it('one "k of n" line per case; a failed run in the middle stops the consecutive count there', () => {
    expect(md).toContain('flicker: 2 of 3 ok, consecutive from the first: 1');
    expect(md).toContain('amount: 2 of 3 ok, consecutive from the first: 1');
    expect(caseLine('flicker', [flicker(1), flicker(2), flicker(3)])).toBe('flicker: 3 of 3 ok, consecutive from the first: 3');
    expect(caseLine('amount', [])).toBe('amount: 0 of 0 ok, consecutive from the first: 0');
  });

  it('a flicker line full-run called ok counts only with pageCheck "checked" and a merged-to-stable time', () => {
    const skipped: CountedLine = { ...flicker(31), pageCheck: 'not checked: --no-deploy-check', seconds: { firstToolMessage: 2, handoff: 60, approvalToMerged: 3, mergedToStable: null } };
    const noTime: CountedLine = { ...flicker(32), seconds: { firstToolMessage: 2, handoff: 60, approvalToMerged: 3, mergedToStable: null } };
    const oldLine: CountedLine = { ...flicker(33), pageCheck: undefined };
    for (const l of [skipped, noTime, oldLine]) expect(l.ok).toBe(true);
    expect(caseLine('flicker', [skipped, noTime, oldLine, flicker(34)])).toBe('flicker: 1 of 4 ok, consecutive from the first: 0');
    const out = summarizeRuns([skipped, noTime]);
    expect(out.split('\n').filter((r) => r.startsWith('| 1 ') || r.startsWith('| 2 ')).every((r) => r.split(' | ')[2] === 'NO')).toBe(true);
    expect(out).toContain('- run 1 (flicker): the redeployed page was not checked (not checked: --no-deploy-check)');
    expect(out).toContain('- run 2 (flicker): no merged-to-stable time in the line');
    // The amount case has no page to check: ok stays ok.
    expect(caseLine('amount', [amount])).toBe('amount: 1 of 1 ok, consecutive from the first: 1');
  });

  it('names why each failed run failed', () => {
    expect(md).toContain('- run 2 (flicker): the card page still flickers after the merge was deployed');
    expect(md).toContain('- run 5 (amount): full-run printed no line (exit 1)');
  });
});
