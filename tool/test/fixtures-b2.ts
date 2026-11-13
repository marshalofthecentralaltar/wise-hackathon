// Shared values for the handoff, approve and pipeline tests. Invented: no real commit or person.
import type { FixOutcome, Handoff, Investigation, MonitoringFinding, Owner, ReportGroup, Verdict } from '../src/types.js';

export const OWNER: Owner = {
  repo: 'acme/demo-app',
  codePath: 'src/pages/card/',
  githubLogin: 'ownerlogin',
  slackUserId: 'U0OWNER01',
  ownersLine: '/src/pages/card/ @ownerlogin',
};

export function group(id = 'group-1'): ReportGroup {
  return {
    id,
    page: 'card',
    summary: 'The card picture blinks on the card page',
    threadTs: '1763050000.000100',
    reports: [1, 2, 3].map((i) => ({
      channel: 'C0SUPPORT',
      ts: `1763050000.00010${i - 1}`,
      sender: `U0AGENT0${i}`,
      text: `card picture blinks, report ${i}`,
    })),
  };
}

export const MONITORING: MonitoringFinding = {
  source: 'prometheus',
  errorsPerSecond: 0,
  alertsFiring: [],
  p95Seconds: 0.02,
  logLinesRead: 40,
  logErrors: 0,
  logWarnings: 0,
  showsProblem: false,
  summary: 'Prometheus shows no errors and no firing alert for /card. The log has no error lines.',
};

export const INVESTIGATION: Investigation = {
  found: true,
  repo: 'acme/demo-app',
  commitSha: 'abcdef1234567890abcdef1234567890abcdef12',
  commitAuthor: 'someauthor',
  mergedAt: '2026-11-12T10:05:00Z',
  pullRequestUrl: 'https://github.com/acme/demo-app/pull/7',
  file: 'src/pages/card/Card.tsx',
  lines: '12-20',
  whatIsWrong: 'An interval toggles the picture every second.',
  customerEffect: 'appearance',
  revertsCleanly: true,
  nextSteps: ['Merge the fix', 'Add a test for the picture'],
  seconds: 14,
};

export const LOW: Verdict = { severity: 'low', reason: 'Only how the page looks is affected.', decidedBy: 'rule' };
export const HIGH: Verdict = { severity: 'high', reason: 'A figure the customer sees is wrong.', decidedBy: 'rule' };

export const FIX_PR: FixOutcome = {
  kind: 'fix',
  prUrl: 'https://github.com/acme/demo-app/pull/9',
  prNumber: 9,
  branch: 'fix/picture',
  filesChanged: ['src/pages/card/Card.tsx'],
  testsPassed: true,
  note: null,
  seconds: 40,
};
export const FIX_NONE: FixOutcome = { kind: 'none', prUrl: null, prNumber: null, branch: null, filesChanged: [], testsPassed: null, note: null, seconds: 0 };

export function handoff(over: Partial<Handoff> = {}): Handoff {
  const g = group();
  g.reports.forEach((r, i) => (r.permalink = `https://x.slack.com/archives/C0SUPPORT/p${i}`));
  return {
    group: g,
    monitoring: MONITORING,
    owner: OWNER,
    investigation: INVESTIGATION,
    verdict: LOW,
    fix: FIX_PR,
    sentenceForCustomers: 'We know the card picture blinks and are fixing it.',
    ...over,
  };
}
