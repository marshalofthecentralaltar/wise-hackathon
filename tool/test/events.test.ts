// The events file (src/events.ts) as the pipeline writes it, checked against the contract in
// issue #20 ("The file it reads"). The sample files in test/fixtures/ are made by this file:
// WRITE_EVENT_SAMPLES=1 npx vitest run test/events.test.ts
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeEventWriter, type ToolEvent } from '../src/events.js';
import { capDiff, DIFF_CAP, lastCommitDiff } from '../src/fix.js';
import { runPipeline, type PipelineDeps, type PipelineResult } from '../src/pipeline.js';
import { FakeSlack } from '../src/slackPost.js';
import { checkMonitoring, errorRateQuery, upQuery } from '../src/steps/monitoring.js';
import type { CodeSteps, FixOutcome, Investigation, MonitoringFinding, Owner, RecentCommit, ReportGroup, Verdict } from '../src/types.js';
import { FIX_PR, INVESTIGATION, LOW, MONITORING, OWNER, group } from './fixtures-b2.js';
import { newRepo, writeAndCommit } from './gitRepo.js';

/** Issue #20, "The file it reads": the evidence fields of each step's done line. */
const CONTRACT: Record<string, string[]> = {
  reports: ['page', 'summary', 'reports'],
  monitoring: ['source', 'query', 'errorsPerSecond', 'errorCount5xx', 'alertsFiring', 'p95Seconds', 'logLinesRead', 'logErrors', 'showsProblem', 'summary'],
  changes: ['days', 'commits'],
  owner: ['codePath', 'ownersLine'],
  investigation: ['found', 'commitSha', 'commitAuthor', 'file', 'lines', 'whatIsWrong', 'customerEffect', 'revertsCleanly'],
  verdict: ['severity', 'reason', 'decidedBy'],
  fix: ['kind', 'prUrl', 'prNumber', 'filesChanged', 'testsPassed', 'note', 'diff'],
  handoff: ['sentenceForCustomers', 'threadUrl'],
};
const sorted = (a: string[]) => [...a].sort();
const TRACED = ['monitoring', 'changes', 'owner', 'investigation', 'verdict', 'fix', 'handoff'];

const dir = mkdtempSync(join(tmpdir(), 'events-'));
let n = 0;
const freshPath = () => join(dir, `run-${++n}`, 'events.jsonl');

function readEvents(path: string): ToolEvent[] {
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as ToolEvent);
}

/** Every line has the envelope; every done line has seconds and exactly the contract's evidence fields. */
function checkAgainstContract(events: ToolEvent[]) {
  for (const e of events) {
    expect(e.v).toBe(1);
    expect(Number.isNaN(Date.parse(e.at))).toBe(false);
    expect(typeof e.groupId).toBe('string');
    expect(['start', 'done', 'failed']).toContain(e.state);
    if (e.state === 'start') expect(Object.keys(e).sort()).toEqual(['at', 'groupId', 'state', 'step', 'v']);
    if (e.state === 'failed') {
      expect(typeof e.seconds).toBe('number');
      expect(typeof e.error).toBe('string');
    }
    if (e.state !== 'done') continue;
    expect(typeof e.seconds).toBe('number');
    const ev = e.evidence as Record<string, unknown>;
    expect(sorted(Object.keys(ev)), e.step).toEqual(sorted(CONTRACT[e.step]!));
    if (e.step === 'reports') {
      for (const r of ev.reports as Record<string, unknown>[]) {
        expect(sorted(Object.keys(r))).toEqual(['at', 'text']);
        expect(Number.isNaN(Date.parse(String(r.at)))).toBe(false);
      }
    }
    if (e.step === 'changes') {
      for (const c of ev.commits as Record<string, unknown>[]) expect(sorted(Object.keys(c))).toEqual(sorted(['sha', 'author', 'mergedAt', 'message', 'files']));
    }
  }
}

const COMMIT: RecentCommit = {
  repo: 'acme/demo-app',
  sha: 'abcdef1234567890abcdef1234567890abcdef12',
  author: 'someauthor',
  mergedAt: '2026-11-12T10:05:00Z',
  message: 'Card: refresh the picture',
  files: ['src/pages/card/Card.tsx'],
  pullRequest: { number: 7, title: 'Card', body: 'secret-ish body', url: 'https://github.com/acme/demo-app/pull/7', comments: [] },
};
const MON_WITH_QUERY: MonitoringFinding = { ...MONITORING, errorCount5xx: 0, query: errorRateQuery('/card') };

function code(over: Partial<CodeSteps> = {}): CodeSteps {
  return {
    investigate: async () => INVESTIGATION,
    classifyCustomerEffect: async () => 'appearance',
    judge: async () => LOW,
    fix: async () => ({ ...FIX_PR, diff: '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n' }),
    ...over,
  };
}

function deps(c: CodeSteps, slack: FakeSlack, over: Partial<PipelineDeps> = {}): PipelineDeps {
  return {
    code: c,
    slack,
    checkMonitoring: async () => MON_WITH_QUERY,
    listRecentChanges: async () => [COMMIT],
    findOwner: async () => OWNER,
    customerSentence: async () => 'We know about the blinking picture and are working on it.',
    patternSeconds: 2.34,
    timingsPath: null,
    log: () => undefined,
    ...over,
  };
}

async function runWithWriter(c: CodeSteps, over: Partial<PipelineDeps> = {}) {
  const path = freshPath();
  const logs: string[] = [];
  const emit = makeEventWriter(path, (l) => logs.push(l));
  const slack = new FakeSlack();
  const result = await runPipeline(group(), deps(c, slack, { emit, ...over }));
  await emit.idle();
  return { result, events: readEvents(path), raw: readFileSync(path, 'utf8'), slack, logs };
}

describe('events file: a whole run', () => {
  it('writes reports done, then start and done for each step, with the contract evidence', async () => {
    const { result, events, raw } = await runWithWriter(code());
    expect(result.ok).toBe(true);
    checkAgainstContract(events);
    const seq = events.map((e) => `${e.step}:${e.state}`);
    expect(seq[0]).toBe('reports:done');
    for (const s of TRACED) {
      expect(seq.filter((x) => x === `${s}:start`)).toHaveLength(1);
      expect(seq.filter((x) => x === `${s}:done`)).toHaveLength(1);
      expect(seq.indexOf(`${s}:start`)).toBeLessThan(seq.indexOf(`${s}:done`));
    }
    // Monitoring, changes and owner start together; the rest follow one after another.
    const firstDone = Math.min(...['monitoring', 'changes', 'owner'].map((s) => seq.indexOf(`${s}:done`)));
    for (const s of ['monitoring', 'changes', 'owner']) expect(seq.indexOf(`${s}:start`)).toBeLessThan(firstDone);
    const lastParallelDone = Math.max(...['monitoring', 'changes', 'owner'].map((s) => seq.indexOf(`${s}:done`)));
    expect(seq.slice(lastParallelDone + 1)).toEqual(['investigation:start', 'investigation:done', 'verdict:start', 'verdict:done', 'fix:start', 'fix:done', 'handoff:start', 'handoff:done']);
    expect(seq).toHaveLength(1 + 2 * TRACED.length);
    expect(seq).not.toContain('post:start');
    expect(seq).not.toContain('permalinks:start');

    // One run id on every line: the group id and the run's start, so a restarted tool's group-1 is a new run.
    expect(new Set(events.map((e) => e.groupId))).toEqual(new Set([`group-1@${result.timings.startedAt}`]));

    const by = (step: string) => events.find((e) => e.step === step && e.state === 'done')!.evidence as Record<string, unknown>;
    expect(events[0]!.seconds).toBe(2.3);
    expect(by('reports')).toEqual({
      page: 'card',
      summary: 'The card picture blinks on the card page',
      reports: [0, 1, 2].map((i) => ({ at: new Date(Number(`1763050000.00010${i}`) * 1000).toISOString(), text: `card picture blinks, report ${i + 1}` })),
    });
    expect(by('monitoring').query).toBe('sum(rate(http_requests_total{path="/card",status=~"5.."}[1h]))');
    expect(by('changes')).toEqual({ days: 7, commits: [{ sha: COMMIT.sha, author: 'someauthor', mergedAt: COMMIT.mergedAt, message: COMMIT.message, files: COMMIT.files }] });
    expect(by('owner')).toEqual({ codePath: 'src/pages/card/', ownersLine: '/src/pages/card/ @ownerlogin' });
    expect(by('fix').diff).toBe('--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n');
    expect(by('fix').prNumber).toBe(9);
    expect(by('handoff')).toEqual({
      sentenceForCustomers: result.handoff!.sentenceForCustomers,
      threadUrl: 'https://example.slack.com/archives/C0SUPPORT/p1763050000000100',
    });
    // No Slack id of the owner or of a reporter, no pull request body.
    for (const secret of ['U0OWNER01', 'U0AGENT01', 'U0AGENT02', 'U0AGENT03', 'secret-ish body', 'slackUserId', 'sender']) expect(raw).not.toContain(secret);
  });

  it('a fix stand-in without a diff gives diff null; a monitoring finding without a query gives query null', async () => {
    const { events } = await runWithWriter(code({ fix: async () => FIX_PR }), { checkMonitoring: async () => MONITORING });
    checkAgainstContract(events);
    const by = (step: string) => events.find((e) => e.step === step && e.state === 'done')!.evidence as Record<string, unknown>;
    expect(by('fix').diff).toBeNull();
    expect(by('monitoring').query).toBeNull();
    expect(by('monitoring').errorCount5xx).toBeNull();
  });
});

describe('events file: a step that throws', () => {
  const boom = () => new Error('investigation broke for ownerlogin (U0OWNER01)');

  it('writes failed with the scrubbed error, nothing after it, and the result is unchanged', async () => {
    const c = code({ investigate: async () => Promise.reject(boom()) });
    const { result, events, raw } = await runWithWriter(c);
    const plain = await runPipeline(group(), deps(code({ investigate: async () => Promise.reject(boom()) }), new FakeSlack()));
    expect(result.ok).toBe(false);
    expect(result.failedStep).toBe('investigation');
    expect({ ...result, timings: null }).toEqual({ ...plain, timings: null });

    checkAgainstContract(events);
    const failed = events.filter((e) => e.state === 'failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]!.step).toBe('investigation');
    expect(failed[0]!.error).toBe('investigation broke for the owner (the owner)');
    expect(failed[0]!.error).toBe(result.error); // the same scrub the Slack message gets
    expect(events.at(-1)).toBe(events.find((e) => e.state === 'failed'));
    expect(raw).not.toContain('ownerlogin (');
    expect(raw).not.toContain('U0OWNER01');
  });

  it('a failed fix writes fix failed and the run carries on to the handoff', async () => {
    const { result, events } = await runWithWriter(code({ fix: async () => Promise.reject(new Error('push refused for ownerlogin')) }));
    expect(result.ok).toBe(true);
    checkAgainstContract(events);
    const seq = events.map((e) => `${e.step}:${e.state}`);
    expect(seq.slice(-4)).toEqual(['fix:start', 'fix:failed', 'handoff:start', 'handoff:done']);
    expect(events.find((e) => e.state === 'failed')!.error).toBe('push refused for the owner');
  });

  it('a monitoring failure writes monitoring failed and the run stops as today', async () => {
    const { result, events } = await runWithWriter(code(), { checkMonitoring: async () => Promise.reject(new Error('prometheus exploded')) });
    expect(result).toMatchObject({ ok: false, failedStep: 'monitoring', error: 'prometheus exploded' });
    expect(events.find((e) => e.state === 'failed')).toMatchObject({ step: 'monitoring', error: 'prometheus exploded' });
    expect(events.map((e) => e.step)).not.toContain('investigation');
  });
});

describe('events file: the writer never changes a run (metamorphic)', () => {
  const blocker = join(dir, 'a-file');
  writeFileSync(blocker, 'not a folder');
  const unwritable = join(blocker, 'events.jsonl'); // its parent is a file: mkdir and append fail

  type Way = 'none' | 'writer' | 'unwritable' | 'throws';
  async function runWay(way: Way, c: () => CodeSteps) {
    const slack = new FakeSlack();
    const logs: string[] = [];
    const writer =
      way === 'writer' ? makeEventWriter(freshPath(), (l) => logs.push(l)) : way === 'unwritable' ? makeEventWriter(unwritable, (l) => logs.push(l)) : undefined;
    const emit = way === 'throws' ? () => { throw new Error('writer exploded'); } : writer;
    const result = await runPipeline(group(), deps(c(), slack, { ...(emit ? { emit } : {}), log: (l) => logs.push(l) }));
    await writer?.idle();
    return { result, slack, logs };
  }
  const shape = (r: PipelineResult) => ({ ...r, timings: { ...r.timings, startedAt: null, secondsByStep: Object.keys(r.timings.secondsByStep).sort(), totalSeconds: null } });
  const calls = (s: FakeSlack) => s.posted.map(({ channel, threadTs, text, blocks }) => ({ channel, threadTs, text, blocks }));

  for (const [name, c] of [
    ['a passing run', () => code()],
    ['a run whose investigation throws', () => code({ investigate: async () => Promise.reject(new Error('no copy for ownerlogin')) })],
    ['a run whose fix throws', () => code({ fix: async () => Promise.reject(new Error('push refused')) })],
  ] as const) {
    it(`${name}: no emit, a writer, an unwritable path and a throwing emit give the same result and Slack calls`, async () => {
      const base = await runWay('none', c);
      for (const way of ['writer', 'unwritable', 'throws'] as const) {
        const other = await runWay(way, c);
        expect(shape(other.result), way).toEqual(shape(base.result));
        expect(calls(other.slack), way).toEqual(calls(base.slack));
      }
    });

    it(`${name}: a failed write is logged once by the writer, a throwing emit once by the pipeline`, async () => {
      for (const way of ['writer', 'unwritable', 'throws'] as const) {
        const { logs } = await runWay(way, c);
        expect(logs.filter((l) => l.startsWith('[events]')), way).toHaveLength(way === 'unwritable' ? 1 : 0);
        expect(logs.filter((l) => l.includes('could not emit')), way).toHaveLength(way === 'throws' ? 1 : 0);
      }
    });
  }
});

describe('events file: the monitoring query is the one really sent', () => {
  let prom: Server;
  let promUrl = '';
  let closedUrl = '';
  const sent: string[] = [];
  const listen = (s: Server) => new Promise<string>((resolve) => s.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(s.address() as AddressInfo).port}`)));
  const NOW = new Date('2026-11-14T00:00:00Z');

  beforeAll(async () => {
    prom = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://x');
      res.setHeader('content-type', 'application/json');
      if (url.pathname === '/api/v1/alerts') return void res.end(JSON.stringify({ status: 'success', data: { alerts: [] } }));
      const q = url.searchParams.get('query') ?? '';
      sent.push(q);
      const value = q === upQuery() ? '1' : '0';
      res.end(JSON.stringify({ status: 'success', data: { resultType: 'vector', result: [{ metric: {}, value: [NOW.getTime() / 1000, value] }] } }));
    });
    promUrl = await listen(prom);
    const closed = createServer();
    closedUrl = await listen(closed);
    await new Promise((r) => closed.close(r));
  });
  afterAll(() => new Promise((r) => prom.close(r)));

  it('evidence.query equals the decoded rate query the monitoring step requested', async () => {
    const logFile = join(dir, 'no-such.log');
    const { events } = await runWithWriter(code(), {
      checkMonitoring: (page) => checkMonitoring(page, { prometheusUrl: promUrl, appBaseUrl: closedUrl, logFile, now: NOW }),
    });
    const ev = events.find((e) => e.step === 'monitoring' && e.state === 'done')!.evidence as Record<string, unknown>;
    const rateSent = sent.filter((q) => q.startsWith('sum(rate('));
    expect(rateSent).toHaveLength(1);
    expect(ev.query).toBe(rateSent[0]);
    expect(ev.source).toBe('prometheus');
  });

  it('when Prometheus does not answer, the fallback reading carries no query', async () => {
    const { events } = await runWithWriter(code(), {
      checkMonitoring: (page) => checkMonitoring(page, { prometheusUrl: closedUrl, appBaseUrl: closedUrl, logFile: join(dir, 'no-such.log'), now: NOW }),
    });
    const ev = events.find((e) => e.step === 'monitoring' && e.state === 'done')!.evidence as Record<string, unknown>;
    expect(ev.source).toBe('metrics-endpoint');
    expect(ev.query).toBeNull();
  });
});

// Samples for the process screen: stand-in values, run through the real pipeline and writer.
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

function sampleRun(kind: 'flicker' | 'amount') {
  const flicker = kind === 'flicker';
  const g: ReportGroup = {
    id: 'group-1',
    page: flicker ? 'card' : 'transfers',
    summary: flicker
      ? 'On Chrome, the card image on the card page blinks on and off about every second.'
      : 'The transfers page shows sent amounts ten times too large.',
    threadTs: '1794614522.104219',
    reports: (flicker
      ? ['the picture of my card keeps flashing on the card page', 'card image blinks every second in Chrome, is that normal?', 'Card page: the card graphic disappears and comes back all the time']
      : ['I sent 25 EUR but the transfers page says 250 EUR??', 'transfer list shows the wrong amount, 10x what I sent', 'Amounts on the transfers page look wrong, one extra zero']
    ).map((text, i) => ({ channel: 'C0SUPPORT', ts: `17946145${22 + i * 3}.10421${9 - i}`, sender: `U0AGENT0${i + 1}`, text })),
  };
  const owner: Owner = {
    repo: 'acme/wise-demo',
    codePath: flicker ? 'src/pages/card/' : 'src/pages/transfers/',
    githubLogin: 'ownerlogin',
    slackUserId: 'U0OWNER01',
    ownersLine: flicker ? '/src/pages/card/ @ownerlogin' : '/src/pages/transfers/ @ownerlogin',
  };
  const path = flicker ? '/card' : '/transfers';
  const monitoring: MonitoringFinding = {
    source: 'prometheus',
    query: errorRateQuery(path),
    errorsPerSecond: 0,
    errorCount5xx: 0,
    alertsFiring: [],
    p95Seconds: flicker ? 0.012 : 0.018,
    logLinesRead: flicker ? 212 : 148,
    logErrors: 0,
    logWarnings: 0,
    showsProblem: false,
    summary: `Nothing found. Prometheus shows no responses with status 5xx on ${path} in the last hour, no firing alert, 95th percentile response time ${flicker ? '0.012' : '0.018'} s. The request log has ${flicker ? 212 : 148} lines for ${path} in the last hour, none at warn or error level.`,
  };
  const commits: RecentCommit[] = [
    { repo: owner.repo, sha: 'bb0ea0b5c1d2e3f405162738495a6b7c8d9e0f1a', author: 'someauthor', mergedAt: '2026-11-13T19:40:00Z', message: 'Transfers: show amounts with thousands separators', files: ['src/pages/transfers/formatAmount.ts'] },
    { repo: owner.repo, sha: 'bd477eb2a3b4c5d6e7f8091a2b3c4d5e6f708192', author: 'someauthor', mergedAt: '2026-11-13T19:31:00Z', message: 'Card page: keep the balance live while the page is open', files: ['src/pages/card/CardPage.tsx', 'src/pages/card/useBalance.ts'] },
  ];
  const investigation: Investigation = flicker
    ? { found: true, repo: owner.repo, commitSha: commits[1]!.sha, commitAuthor: 'someauthor', mergedAt: commits[1]!.mergedAt, pullRequestUrl: 'https://github.com/acme/wise-demo/pull/12', file: 'src/pages/card/CardPage.tsx', lines: '14-31', whatIsWrong: 'A component is defined inside CardPage, so React builds a new one on every balance update and the card picture is removed and added again.', customerEffect: 'appearance', revertsCleanly: true, nextSteps: ['Merge the fix'], seconds: 11.5 }
    : { found: true, repo: owner.repo, commitSha: commits[0]!.sha, commitAuthor: 'someauthor', mergedAt: commits[0]!.mergedAt, pullRequestUrl: 'https://github.com/acme/wise-demo/pull/11', file: 'src/pages/transfers/formatAmount.ts', lines: '3-9', whatIsWrong: 'formatAmount multiplies the amount in cents by 10 instead of dividing by 100 before adding the separators, so every amount shows ten times too large.', customerEffect: 'figure', revertsCleanly: true, nextSteps: ['Fix formatAmount and add a test'], seconds: 13.2 };
  const verdict: Verdict = flicker
    ? { severity: 'low', reason: 'Appearance only; monitoring shows no errors; a commit was named.', decidedBy: 'rule' }
    : { severity: 'high', reason: 'A figure the customer sees is wrong, so a person decides the change.', decidedBy: 'rule' };
  const fix: FixOutcome = flicker
    ? {
        kind: 'fix',
        prUrl: 'https://github.com/acme/wise-demo/pull/13',
        prNumber: 13,
        branch: 'triage/fix-card-blink',
        filesChanged: ['src/pages/card/CardPage.tsx'],
        testsPassed: true,
        note: null,
        seconds: 41.3,
        diff: [
          'diff --git a/src/pages/card/CardPage.tsx b/src/pages/card/CardPage.tsx',
          'index 3f1c2aa..8e0d9b1 100644',
          '--- a/src/pages/card/CardPage.tsx',
          '+++ b/src/pages/card/CardPage.tsx',
          '@@ -11,12 +11,12 @@ import { useBalance } from "./useBalance";',
          '+function CardPicture({ src }: { src: string }) {',
          '+  return <img className="card-picture" src={src} alt="Your card" />;',
          '+}',
          '+',
          ' export function CardPage() {',
          '   const balance = useBalance();',
          '-  function CardPicture({ src }: { src: string }) {',
          '-    return <img className="card-picture" src={src} alt="Your card" />;',
          '-  }',
          '   return (',
          '',
        ].join('\n'),
      }
    : { kind: 'none', prUrl: null, prNumber: null, branch: null, filesChanged: [], testsPassed: null, note: null, seconds: 0, diff: null };
  const c: CodeSteps = {
    investigate: async () => (await pause(flicker ? 450 : 520), investigation),
    classifyCustomerEffect: async () => (flicker ? 'appearance' : 'figure'),
    judge: async () => (await pause(20), verdict),
    fix: async () => (await pause(flicker ? 600 : 10), fix),
  };
  const slack = new FakeSlack();
  return {
    group: g,
    deps: deps(c, slack, {
      checkMonitoring: async () => (await pause(120), monitoring),
      listRecentChanges: async () => (await pause(300), commits),
      findOwner: async () => (await pause(60), owner),
      customerSentence: async () =>
        flicker ? 'We know the card picture blinks on the card page and are fixing it.' : 'We know some transfer amounts show wrongly on the transfers page; your money was sent as you asked.',
      patternSeconds: flicker ? 5.8 : 6.4,
    }),
  };
}

describe('events file: samples for the process screen', () => {
  if (process.env.WRITE_EVENT_SAMPLES === '1') {
    it('writes the samples', async () => {
      mkdirSync(FIXTURES, { recursive: true });
      for (const kind of ['flicker', 'amount'] as const) {
        const target = join(FIXTURES, `events-${kind}.jsonl`);
        const tmp = freshPath();
        const emit = makeEventWriter(tmp);
        const s = sampleRun(kind);
        const r = await runPipeline(s.group, { ...s.deps, emit });
        await emit.idle();
        expect(r.ok).toBe(true);
        writeFileSync(target, readFileSync(tmp, 'utf8').replace(/\r\n/g, '\n'));
      }
    }, 20_000);
  }

  for (const kind of ['flicker', 'amount'] as const) {
    it(`events-${kind}.jsonl parses line by line and follows the contract`, () => {
      const events = readEvents(join(FIXTURES, `events-${kind}.jsonl`));
      checkAgainstContract(events);
      expect(events[0]).toMatchObject({ step: 'reports', state: 'done' });
      expect(events.at(-1)).toMatchObject({ step: 'handoff', state: 'done' });
      expect(events).toHaveLength(15);
      const raw = readFileSync(join(FIXTURES, `events-${kind}.jsonl`), 'utf8');
      expect(raw).not.toContain('U0OWNER01');
      expect(raw).not.toContain('U0AGENT0');
      const verdict = events.find((e) => e.step === 'verdict' && e.state === 'done')!.evidence as Verdict;
      expect(verdict.severity).toBe(kind === 'flicker' ? 'low' : 'high');
    });
  }
});

describe('fix diff: what FixOutcome.diff is made from', () => {
  it('lastCommitDiff gives the last commit, new files included; capDiff keeps it within 4,000 characters', async () => {
    const repo = newRepo('events-diff-');
    try {
      writeAndCommit(repo.dir, { 'src/pages/card/Card.tsx': 'line 1\nstate bad\n' }, 'base');
      writeAndCommit(repo.dir, { 'src/pages/card/Card.tsx': 'line 1\nstate good\n', 'src/pages/card/New.tsx': 'export const x = 1;\n' }, 'fix');
      const diff = await lastCommitDiff(repo.dir);
      expect(diff).toContain('-state bad');
      expect(diff).toContain('+state good');
      expect(diff).toContain('+++ b/src/pages/card/New.tsx');
      expect(await lastCommitDiff(join(repo.dir, 'no-such-folder'))).toBeNull();
    } finally {
      repo.cleanup();
    }
    const long = 'x'.repeat(10_000);
    expect(capDiff(long).length).toBe(DIFF_CAP);
    expect(capDiff(long)).toMatch(/diff cut at 4,000 characters/);
    expect(capDiff('short')).toBe('short');
  });
});
