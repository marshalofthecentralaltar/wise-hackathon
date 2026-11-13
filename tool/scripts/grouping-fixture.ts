// Grouping on the real fixture with the real model: all 60 messages of fixtures/reports.json
// in file order, in batches of 3, twice, each time from an empty store.
// Run from tool/: npx tsx scripts/grouping-fixture.ts   (writes artifacts/grouping-fixture.json)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Report } from '../src/types.js';
import { ReportStore } from '../src/steps/reports.js';

interface Fixture {
  id: string;
  text: string;
  lang: string;
  is_report: boolean;
  page: string | null;
  problem: string | null;
}

const fixtures = JSON.parse(readFileSync(fileURLToPath(new URL('../../fixtures/reports.json', import.meta.url)), 'utf8')) as Fixture[];
// Arguments: [runs] [--seed=N]. With a seed the 60 messages are fed in a shuffled order.
const runs = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) ?? 2);
const seedArg = process.argv.find((a) => a.startsWith('--seed='));
const seed = seedArg ? Number(seedArg.slice('--seed='.length)) : null;

/** Fisher-Yates with mulberry32, so a seed always gives the same order. */
function shuffled<T>(items: T[], s: number): T[] {
  let a = s >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
const tsOf = (i: number) => `1700000000.${String(i).padStart(6, '0')}`;
const idByTs = new Map(fixtures.map((f, i) => [tsOf(i), f.id]));
const fixtureById = new Map(fixtures.map((f) => [f.id, f]));
const problems = [...new Set(fixtures.map((f) => f.problem).filter((p): p is string => p !== null))];

interface ProblemRow {
  problem: string;
  messages: number;
  inLargestGroup: number;
  largestGroup: string | null;
  foreignInThatGroup: string[];
  missedIds: string[];
}

async function oneRun(run: number) {
  const logs: string[] = [];
  const store = new ReportStore({ statePath: null, threshold: 3, log: (m) => logs.push(m) });
  const t0 = performance.now();
  const all: Report[] = fixtures.map((f, i) => ({ channel: 'C-FIXTURE', ts: tsOf(i), sender: 'U-FIXTURE', text: f.text }));
  const order = seed === null ? all : shuffled(all, seed);
  if (seed !== null) console.log(`\nRun ${run} order (seed ${seed}): ${order.map((r) => idByTs.get(r.ts)).join(',')}`);
  for (let i = 0; i < order.length; i += 3) await store.addReports(order.slice(i, i + 3));
  const seconds = Math.round((performance.now() - t0) / 100) / 10;
  const state = store.state();
  const groups = state.groups.map((g) => ({ id: g.id, page: g.page, summary: g.summary, ids: g.reports.map((r) => idByTs.get(r.ts)!) }));

  const rows: ProblemRow[] = problems.map((problem) => {
    const ids = fixtures.filter((f) => f.problem === problem).map((f) => f.id);
    let best: (typeof groups)[number] | null = null;
    let bestCount = 0;
    for (const g of groups) {
      const n = g.ids.filter((id) => ids.includes(id)).length;
      if (n > bestCount) [best, bestCount] = [g, n];
    }
    return {
      problem,
      messages: ids.length,
      inLargestGroup: bestCount,
      largestGroup: best?.id ?? null,
      foreignInThatGroup: best ? best.ids.filter((id) => !ids.includes(id)) : [],
      missedIds: ids.filter((id) => !best?.ids.includes(id)),
    };
  });
  const grouped = new Set(groups.flatMap((g) => g.ids));
  const chatterAccepted = fixtures.filter((f) => !f.is_report && grouped.has(f.id)).map((f) => f.id);
  const reportsRejected = state.chatter.map((r) => idByTs.get(r.ts)!).filter((id) => fixtureById.get(id)!.is_report);
  const ungrouped = state.ungrouped.map((r) => idByTs.get(r.ts)!);

  const row = (p: string) => rows.find((r) => r.problem === p)!;
  const flicker = row('card-picture-flicker');
  const amount = row('transfers-amount-wrong');
  const declinedIds = fixtures.filter((f) => f.problem === 'card-payment-declined').map((f) => f.id);
  const flickerGroup = groups.find((g) => g.id === flicker.largestGroup);
  const declinedInFlicker = declinedIds.filter((id) => flickerGroup?.ids.includes(id));
  const checks = {
    flicker20InOneGroupNoForeign: flicker.inLargestGroup === 20 && flicker.foreignInThatGroup.length === 0,
    amount8InOneGroupNoForeign: amount.inLargestGroup === 8 && amount.foreignInThatGroup.length === 0,
    declinedNotInFlickerGroup: declinedInFlicker.length === 0,
    chatterAcceptedAtMost1: chatterAccepted.length <= 1,
  };

  console.log(`\nRun ${run}: ${store.calls} model calls, ${seconds} s, ${groups.length} groups, ${ungrouped.length} ungrouped`);
  console.log('| problem | messages | in its largest group | foreign in that group | missed ids |');
  console.log('|---|---|---|---|---|');
  for (const r of rows) {
    console.log(`| ${r.problem} | ${r.messages} | ${r.inLargestGroup} (${r.largestGroup}) | ${r.foreignInThatGroup.length}${r.foreignInThatGroup.length ? ' ' + r.foreignInThatGroup.join(',') : ''} | ${r.missedIds.join(',') || '-'} |`);
  }
  console.log(`chatter accepted as reports: ${chatterAccepted.length} of ${fixtures.filter((f) => !f.is_report).length}${chatterAccepted.length ? ' ' + chatterAccepted.join(',') : ''}`);
  console.log(`reports rejected as chatter: ${reportsRejected.length}${reportsRejected.length ? ' ' + reportsRejected.join(',') : ''}`);
  console.log(`declined-payment messages in the flicker group: ${declinedInFlicker.length}${declinedInFlicker.length ? ' ' + declinedInFlicker.join(',') : ''}`);
  console.log(`ungrouped after failed calls: ${ungrouped.length}${ungrouped.length ? ' ' + ungrouped.join(',') : ''}`);
  console.log(`checks: ${JSON.stringify(checks)}`);
  if (logs.length) console.log(`log:\n  ${logs.join('\n  ')}`);
  return { run, calls: store.calls, seconds, groups, rows, chatterAccepted, reportsRejected, declinedInFlicker, ungrouped, checks, logs };
}

const results = [];
for (let run = 1; run <= runs; run++) results.push(await oneRun(run));
mkdirSync(fileURLToPath(new URL('../artifacts/', import.meta.url)), { recursive: true });
writeFileSync(fileURLToPath(new URL(`../artifacts/grouping-fixture${seed === null ? '' : `-seed${seed}`}.json`, import.meta.url)), JSON.stringify(results, null, 2));
const pass = results.every((r) => Object.values(r.checks).every(Boolean));
console.log(`\n${pass ? 'PASS' : 'FAIL'}: ${results.map((r) => `run ${r.run} ${Object.values(r.checks).every(Boolean) ? 'pass' : 'fail'}`).join(', ')}`);
process.exitCode = pass ? 0 : 1;
