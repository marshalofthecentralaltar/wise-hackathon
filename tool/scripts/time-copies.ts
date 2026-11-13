// Three fresh copies of the real card app repository: seconds per copy, and proof that what
// copy 1 does (an edited file, a new branch, a commit) is absent from copy 2 and copy 3.
//   npx tsx scripts/time-copies.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../src/config.js';
import { run } from '../src/fix.js';
import { freshCopy } from '../src/workspace.js';

const repo = config.repos[0]!;
const git = async (cwd: string, ...args: string[]) => (await run('git', args, { cwd, timeoutMs: 30_000 })).stdout.trim();

const c1 = await freshCopy(repo);
const pkg = join(c1.dir, 'package.json');
writeFileSync(pkg, readFileSync(pkg, 'utf8') + '\n// edited by copy 1\n');
await git(c1.dir, 'checkout', '-q', '-b', 'copy-1-branch');
await git(c1.dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qam', 'copy 1 commit');
console.log(`copy 1: ${c1.seconds} s (fetch ${c1.fetchSeconds}, clone ${c1.cloneSeconds}) head ${c1.head.slice(0, 7)}; dirtied: branch ${await git(c1.dir, 'branch', '--show-current')}`);

for (const n of [2, 3]) {
  const c = await freshCopy(repo);
  const edited = readFileSync(join(c.dir, 'package.json'), 'utf8').includes('edited by copy 1');
  const branch = await git(c.dir, 'branch', '-a', '--list', '*copy-1*');
  const commit = (await git(c.dir, 'log', '--all', '--format=%s')).includes('copy 1 commit');
  const status = await git(c.dir, 'status', '--porcelain');
  console.log(
    `copy ${n}: ${c.seconds} s (fetch ${c.fetchSeconds}, clone ${c.cloneSeconds}) head ${c.head.slice(0, 7)} branch ${c.branch}; ` +
      `edit present: ${edited}; copy-1 branch present: ${branch !== ''}; copy-1 commit present: ${commit}; status: ${status || 'clean'}`,
  );
  await c.remove();
}
await c1.remove();
