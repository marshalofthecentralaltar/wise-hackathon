import { describe, expect, it } from 'vitest';
import { judge, moreSerious } from '../src/verdict.js';
import { CUSTOMER_EFFECTS, type CustomerEffect } from '../src/investigate.js';
import type { Investigation, MonitoringFinding, ReportGroup } from '../src/types.js';

const group: ReportGroup = {
  id: 'g1',
  page: 'card',
  summary: 'The card picture blinks.',
  reports: [{ channel: 'C1', ts: '1.0', sender: 'U1', text: 'card picture blinks' }],
  threadTs: '1.0',
};

const healthy: MonitoringFinding = {
  source: 'prometheus', errorsPerSecond: 0, alertsFiring: [], p95Seconds: 0.02,
  logLinesRead: 100, logErrors: 0, logWarnings: 0, showsProblem: false, summary: 'Nothing found.',
};
const failing: MonitoringFinding = { ...healthy, errorsPerSecond: 0.4, showsProblem: true, summary: '0.4 errors per second on /card.' };

const found = (customerEffect: CustomerEffect): Investigation => ({
  found: true, repo: 'o/r', commitSha: 'a'.repeat(40), commitAuthor: 'dev', mergedAt: '2026-11-13T10:00:00Z',
  pullRequestUrl: null, file: 'src/pages/card/Card.tsx', lines: '10-12', whatIsWrong: 'x', customerEffect,
  revertsCleanly: true, nextSteps: [], seconds: 1,
});
const notFound: Investigation = { ...found('appearance'), found: false, commitSha: null, file: null, lines: null };

const HIGH: CustomerEffect[] = ['figure', 'payment', 'customer-data', 'action-blocked', 'unknown'];
const LOW: CustomerEffect[] = ['appearance', 'wording'];

describe('judge: the written rules, in order', () => {
  it('monitoring showing a problem is high even when the effect is appearance', async () => {
    const v = await judge({ group, monitoring: failing, investigation: found('appearance'), textEffect: 'appearance' });
    expect(v).toMatchObject({ severity: 'high', decidedBy: 'rule' });
    expect(v.reason).toMatch(/Monitoring/);
  });

  it('no responsible commit is high, even when both effects say appearance', async () => {
    const v = await judge({ group, monitoring: healthy, investigation: notFound, textEffect: 'appearance' });
    expect(v).toMatchObject({ severity: 'high', decidedBy: 'rule' });
    expect(v.reason).toMatch(/could not name the commit/);
  });

  it.each(HIGH)('effect "%s" from both judgements is high', async (e) => {
    const v = await judge({ group, monitoring: healthy, investigation: found(e), textEffect: e });
    expect(v).toMatchObject({ severity: 'high', decidedBy: 'rule' });
  });

  it.each(LOW)('effect "%s" from both judgements is low', async (e) => {
    const v = await judge({ group, monitoring: healthy, investigation: found(e), textEffect: e });
    expect(v).toMatchObject({ severity: 'low', decidedBy: 'rule' });
  });

  it('the two judgements disagreeing: the more serious wins, whichever side it is on', async () => {
    for (const low of LOW) {
      for (const high of HIGH) {
        const codeHigh = await judge({ group, monitoring: healthy, investigation: found(high), textEffect: low });
        const textHigh = await judge({ group, monitoring: healthy, investigation: found(low), textEffect: high });
        expect(codeHigh).toMatchObject({ severity: 'high', decidedBy: 'rule' });
        expect(textHigh).toMatchObject({ severity: 'high', decidedBy: 'rule' });
        expect(textHigh.reason).toContain(`the reports say "${high}"`);
      }
    }
  });

  it('a text judgement that fails counts as unknown, so high', async () => {
    const v = await judge({ group, monitoring: healthy, investigation: found('appearance'), textEffect: Promise.reject(new Error('timeout')) });
    expect(v).toMatchObject({ severity: 'high', decidedBy: 'rule' });
  });

  it('every effect is decided by a rule; the model never decides the severity', async () => {
    for (const a of CUSTOMER_EFFECTS) {
      for (const b of CUSTOMER_EFFECTS) {
        const v = await judge({ group, monitoring: healthy, investigation: found(a), textEffect: b });
        expect(v.decidedBy).toBe('rule');
        expect(v.severity).toBe(LOW.includes(a) && LOW.includes(b) ? 'low' : 'high');
      }
    }
  });

  it('moreSerious is symmetric in class', () => {
    expect(moreSerious('appearance', 'figure')).toBe('figure');
    expect(moreSerious('figure', 'appearance')).toBe('figure');
    expect(moreSerious('wording', 'appearance')).toBe('wording');
  });
});
