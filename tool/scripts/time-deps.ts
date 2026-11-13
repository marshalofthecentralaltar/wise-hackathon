// Cold and warm timings of the fix step's dependencies, and that tests and build work through the junction.
//   npx tsx scripts/time-deps.ts [--cache-root <dir>]
// Cold: no install yet for this package-lock.json. Warm: a second copy links to the first install.
import { config } from '../src/config.js';
import { ensureDeps, unlinkDeps } from '../src/deps.js';
import { run } from '../src/fix.js';
import { freshCopy } from '../src/workspace.js';

const i = process.argv.indexOf('--cache-root');
const cacheRoot = i >= 0 ? process.argv[i + 1] : undefined;
const repo = config.repos[0]!;
const secondsSince = (t0: number) => Math.round((performance.now() - t0) / 100) / 10;

const out: Record<string, unknown> = {};
const a = await freshCopy(repo);
out.copySeconds = a.seconds;
const cold = await ensureDeps(a.dir, { cacheRoot });
out.first = { cold: cold.cold, seconds: cold.seconds, cacheDir: cold.cacheDir };
const b = await freshCopy(repo);
const warm = await ensureDeps(b.dir, { cacheRoot });
out.second = { cold: warm.cold, seconds: warm.seconds };
let t0 = performance.now();
const test = await run('npm test', [], { cwd: b.dir, timeoutMs: 120_000, shell: true });
out.npmTest = { code: test.code, seconds: secondsSince(t0) };
t0 = performance.now();
const build = await run('npm run build', [], { cwd: b.dir, timeoutMs: 120_000, shell: true });
out.npmBuild = { code: build.code, seconds: secondsSince(t0), tail: build.code === 0 ? '' : (build.stdout + build.stderr).slice(-600) };
out.gitStatusWithJunction = (await run('git', ['status', '--porcelain'], { cwd: b.dir, timeoutMs: 10_000 })).stdout.trim() || 'clean';
for (const c of [a, b]) {
  await unlinkDeps(c.dir);
  await c.remove();
}
const { existsSync } = await import('node:fs');
out.cacheSurvivesCopyRemoval = existsSync(`${cold.cacheDir}/node_modules/vitest/package.json`);
console.log(JSON.stringify(out, null, 1));
