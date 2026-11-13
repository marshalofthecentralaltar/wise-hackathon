// Times listRecentChanges() three times and compares its output with a saved baseline.
// Run from tool/: npx tsx scripts/time-changes.ts --save artifacts/b2-changes-before.json
//                 npx tsx scripts/time-changes.ts --compare artifacts/b2-changes-before.json
import { readFileSync, writeFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { listRecentChanges } from '../src/steps/changes.js';

const now = new Date(); // one fixed "now" so before and after ask for the same window
const arg = (name: string) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined);
const savePath = arg('--save');
const comparePath = arg('--compare');
const fixedNow = comparePath ? new Date(JSON.parse(readFileSync(comparePath, 'utf8')).now) : now;
const seconds: number[] = [];
let last: unknown;
for (let i = 0; i < 3; i++) {
  const t0 = performance.now();
  last = await listRecentChanges({ now: fixedNow });
  seconds.push(Math.round((performance.now() - t0) / 100) / 10);
}
console.log(JSON.stringify({ seconds, commits: (last as unknown[]).length }));
if (savePath) writeFileSync(savePath, JSON.stringify({ now: fixedNow.toISOString(), list: last }, null, 2));
if (comparePath) console.log(`EQUAL ${isDeepStrictEqual(JSON.parse(readFileSync(comparePath, 'utf8')).list, JSON.parse(JSON.stringify(last)))}`);
