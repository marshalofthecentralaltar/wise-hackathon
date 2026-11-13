// Timed runs of steps 3 to 8 on one planted problem, each from a clean slate (the reset command).
//   npx tsx scripts/run-fix.ts --problem flicker|amount [--runs 5] [--app-url http://localhost:3200]
// Real findOwner, listRecentChanges, checkMonitoring, investigate (with classifyCustomerEffect
// started alongside), judge and fixStep. The report texts are the fixture's three English
// reports of the problem. No Slack. One JSON line per run on stdout; progress on stderr.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../src/config.js';
import { ensureDeps, unlinkDeps, type DepsResult } from '../src/deps.js';
import { fixStepWithDetails } from '../src/fixStep.js';
import { investigate } from '../src/investigate.js';
import { resetTool } from '../src/reset.js';
import { listRecentChanges } from '../src/steps/changes.js';
import { checkMonitoring } from '../src/steps/monitoring.js';
import { findOwner } from '../src/steps/owner.js';
import type { Page, ReportGroup } from '../src/types.js';
import { classifyCustomerEffect, judge } from '../src/verdict.js';
import { freshCopy } from '../src/workspace.js';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const problem = arg('problem');
if (problem !== 'flicker' && problem !== 'amount') {
  console.error('usage: --problem flicker|amount [--runs 5] [--app-url http://localhost:3200]');
  process.exit(2);
}
const runs = Number(arg('runs', '5'));
const appBaseUrl = arg('app-url', config.appBaseUrl)!;
const repo = config.repos[0]!;

interface Fixture { id: string; text: string; lang: string; problem: string }
const fixtures = JSON.parse(readFileSync(join(here, '..', '..', 'fixtures', 'reports.json'), 'utf8')) as Fixture[];
const P: Record<'flicker' | 'amount', { page: Page; fixtureProblem: string; summary: string }> = {
  flicker: { page: 'card', fixtureProblem: 'card-picture-flicker', summary: 'The picture of the card blinks on the card page, about once a second.' },
  amount: { page: 'transfers', fixtureProblem: 'transfers-amount-wrong', summary: 'A transfer in the transfers list shows the wrong amount.' },
};
const p = P[problem];
const texts = fixtures.filter((f) => f.problem === p.fixtureProblem && f.lang === 'en').slice(0, 3).map((f) => f.text);
if (texts.length !== 3) throw new Error(`expected 3 English fixture reports for ${p.fixtureProblem}, found ${texts.length}`);

const secondsSince = (t0: number) => Math.round((performance.now() - t0) / 100) / 10;
const log = (s: string) => process.stderr.write(s + '\n');

// Tool start: the warm dependency install is filled once (cold) before the first run.
{
  const c = await freshCopy(repo);
  const d: DepsResult = await ensureDeps(c.dir);
  await unlinkDeps(c.dir);
  await c.remove();
  log(`dependencies at tool start: ${d.cold ? 'cold install' : 'already warm'} ${d.seconds} s (${d.cacheDir})`);
}

for (let i = 1; i <= runs; i++) {
  const tr = performance.now();
  const reset = await resetTool();
  const resetSeconds = secondsSince(tr);
  log(`run ${i}: reset closed ${JSON.stringify(reset.closedPullRequests)}, deleted ${reset.deletedBranches.length} branch(es) in ${resetSeconds} s`);

  const group: ReportGroup = {
    id: `run-fix-${problem}-${i}`,
    page: p.page,
    summary: p.summary,
    reports: texts.map((text, k) => ({ channel: 'C-run-fix', ts: `1763060000.00000${k}`, sender: `U-agent-${k + 1}`, text })),
    threadTs: '1763060000.000000',
  };

  const t0 = performance.now();
  const timed = async <T>(f: () => Promise<T>): Promise<[T, number]> => {
    const ts = performance.now();
    const v = await f();
    return [v, secondsSince(ts)];
  };
  const [[monitoring, monitoringS], [commits, changesS], [owner, ownerS]] = await Promise.all([
    timed(() => checkMonitoring(p.page, { appBaseUrl })),
    timed(() => listRecentChanges()),
    timed(() => findOwner(p.page, { lookupSlackUser: async () => null })),
  ]);
  const ti = performance.now();
  const textEffect = classifyCustomerEffect(group.reports.map((r) => r.text));
  const investigation = await investigate({ group, owner, monitoring, commits });
  const investigationS = secondsSince(ti);
  const tv = performance.now();
  const verdict = await judge({ group, monitoring, investigation, textEffect });
  const verdictS = secondsSince(tv);
  const tf = performance.now();
  const fix = await fixStepWithDetails({ group, owner, investigation, verdict }, { log: (s) => log(`run ${i}: ${s}`) });
  const fixS = secondsSince(tf);

  const line = {
    run: i,
    problem,
    commit: investigation.commitSha?.slice(0, 7) ?? null,
    file: investigation.file,
    lines: investigation.lines,
    customerEffect: investigation.customerEffect,
    textEffect: await textEffect,
    monitoringSource: monitoring.source,
    monitoringUnavailable: monitoring.unavailable === true,
    severity: verdict.severity,
    decidedBy: verdict.decidedBy,
    kind: fix.kind,
    prUrl: fix.prUrl,
    branch: fix.branch,
    filesChanged: fix.filesChanged,
    testsPassed: fix.testsPassed,
    fallbackReason: fix.fallbackReason,
    note: fix.note,
    seconds: {
      reset: resetSeconds,
      monitoring: monitoringS,
      changes: changesS,
      owner: ownerS,
      investigation: investigationS,
      verdict: verdictS,
      fix: fixS,
      fixStages: fix.stages,
      total: secondsSince(t0),
    },
  };
  console.log(JSON.stringify(line));
  log(`run ${i}: ${line.commit} ${line.severity} ${line.kind} ${line.prUrl ?? '-'} total ${line.seconds.total} s (fix ${fixS} s)`);
}
