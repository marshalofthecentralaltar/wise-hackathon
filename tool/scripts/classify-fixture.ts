// Criterion 7: the text-only customer-effect judgement on the labelled fixture problems.
// 3 calls per problem, 3 report texts per call. Flicker calls include r09, r33 and r47.
//   npx tsx scripts/classify-fixture.ts
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyCustomerEffect, CLASSIFY_MODEL, isLowEffect } from '../src/verdict.js';

interface Fixture { id: string; text: string; problem: string | null; severity: 'low' | 'high' | null }
const here = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(readFileSync(join(here, '..', '..', 'fixtures', 'reports.json'), 'utf8')) as Fixture[];
const byId = new Map(fixtures.map((f) => [f.id, f]));

const CALLS: Record<string, string[][]> = {
  'card-picture-flicker': [['r09', 'r33', 'r47'], ['r01', 'r09', 'r53'], ['r14', 'r33', 'r47']],
  'account-name-cut-off': [['r08', 'r21', 'r31'], ['r43', 'r52', 'r58'], ['r08', 'r43', 'r58']],
  'transfers-amount-wrong': [['r03', 'r10', 'r18'], ['r26', 'r32', 'r40'], ['r49', 'r57', 'r03']],
  'card-payment-declined': [['r05', 'r15', 'r27'], ['r37', 'r46', 'r55'], ['r05', 'r37', 'r55']],
};

const jobs = Object.entries(CALLS).flatMap(([problem, triples]) => triples.map((ids) => ({ problem, ids })));
const results: { problem: string; ids: string[]; effect: string; seconds: number; ok: boolean }[] = [];

async function worker() {
  for (let job = jobs.shift(); job; job = jobs.shift()) {
    const fx = job.ids.map((id) => byId.get(id)!);
    if (fx.some((f) => f.problem !== job.problem)) throw new Error(`fixture mismatch in ${job.ids.join(',')}`);
    const expected = fx[0]!.severity!;
    const t0 = performance.now();
    const effect = await classifyCustomerEffect(fx.map((f) => f.text));
    const seconds = Math.round((performance.now() - t0) / 100) / 10;
    const ok = (isLowEffect(effect) ? 'low' : 'high') === expected;
    results.push({ problem: job.problem, ids: job.ids, effect, seconds, ok });
    console.log(`${job.problem} [${job.ids.join(', ')}] -> ${effect} (${isLowEffect(effect) ? 'low' : 'high'}-class, expected ${expected}) ${ok ? 'ok' : 'MISS'} ${seconds}s`);
  }
}

console.log(`model ${CLASSIFY_MODEL}`);
await Promise.all([worker(), worker(), worker()]);
console.log('');
for (const problem of Object.keys(CALLS)) {
  const rs = results.filter((r) => r.problem === problem);
  console.log(`${problem}: ${rs.filter((r) => r.ok).length} of ${rs.length} right`);
}
const misses = results.filter((r) => !r.ok);
console.log(`misses: ${misses.length ? misses.map((m) => `${m.problem} [${m.ids.join(',')}] -> ${m.effect}`).join('; ') : 'none'}`);
