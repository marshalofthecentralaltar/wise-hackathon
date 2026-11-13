// Runs steps 2 to 5 once for three fixture messages about the card picture and prints each
// step's result with its seconds, then the total. Step 2 runs first; steps 3, 4 and 5 do not
// depend on each other and run at the same time.
// Run from tool/: npx tsx scripts/try-steps.ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Report } from '../src/types.js';
import { ReportStore } from '../src/steps/reports.js';
import { checkMonitoring } from '../src/steps/monitoring.js';
import { listRecentChanges } from '../src/steps/changes.js';
import { findOwner } from '../src/steps/owner.js';

interface Fixture {
  id: string;
  text: string;
  lang: string;
  problem: string | null;
}

const fixtures = JSON.parse(readFileSync(fileURLToPath(new URL('../../fixtures/reports.json', import.meta.url)), 'utf8')) as Fixture[];
const flicker = fixtures.filter((f) => f.problem === 'card-picture-flicker');
// One message per language, as on stage.
const picked = ['en', 'et', 'ru'].map((lang) => flicker.find((f) => f.lang === lang)!).filter(Boolean);

const secondsSince = (t0: number) => Math.round((performance.now() - t0) / 100) / 10;
const base = Math.floor(Date.now() / 1000);
const reports: Report[] = picked.map((f, i) => ({ channel: 'C-TRY', ts: `${base}.00000${i}`, sender: 'U-TRY', text: f.text }));

async function timed<T>(fn: () => Promise<T>): Promise<{ seconds: number; result?: T; error?: string }> {
  const t0 = performance.now();
  try {
    const result = await fn();
    return { seconds: secondsSince(t0), result };
  } catch (err) {
    return { seconds: secondsSince(t0), error: err instanceof Error ? err.message : String(err) };
  }
}

async function main() {
  const tStart = performance.now();
  console.log(JSON.stringify({ fixtureIds: picked.map((f) => f.id) }));

  const store = new ReportStore({ statePath: null, threshold: 3 });
  const pattern = await timed(() => store.addReports(reports));
  const group = pattern.result?.[0];
  console.log(JSON.stringify({ step: 'pattern', seconds: pattern.seconds, modelCalls: store.calls, triggered: pattern.result ?? null, error: pattern.error }, null, 2));
  if (!group) {
    console.log(JSON.stringify({ stopped: 'no group reached the threshold', state: store.state() }, null, 2));
    process.exitCode = 1;
    return;
  }

  const tParallel = performance.now();
  const [monitoring, changes, owner] = await Promise.all([
    timed(() => checkMonitoring(group.page)),
    timed(() => listRecentChanges()),
    timed(() => findOwner(group.page)),
  ]);
  const parallelSeconds = secondsSince(tParallel);
  console.log(JSON.stringify({ step: 'monitoring', ...monitoring }, null, 2));
  console.log(
    JSON.stringify(
      {
        step: 'changes',
        seconds: changes.seconds,
        error: changes.error,
        count: changes.result?.length,
        commits: changes.result?.map((c) => ({
          sha: c.sha.slice(0, 7),
          mergedAt: c.mergedAt,
          author: c.author,
          message: c.message.split(/\r?\n/)[0],
          files: c.files.length,
          pullRequest: c.pullRequest ? { number: c.pullRequest.number, comments: c.pullRequest.comments.length, bodyChars: c.pullRequest.body.length } : null,
        })),
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ step: 'owner', ...owner }, null, 2));
  console.log(
    JSON.stringify({
      seconds: { pattern: pattern.seconds, monitoring: monitoring.seconds, changes: changes.seconds, owner: owner.seconds, steps3to5AtOnce: parallelSeconds, total: secondsSince(tStart) },
    }),
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
