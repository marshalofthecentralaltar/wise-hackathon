// Would undoing the responsible commit apply cleanly? Tried in the run's own fresh copy with
// `git revert --no-commit`, then the copy is put back exactly as it was. Nothing is committed
// and nothing is pushed.

import { run } from './fix.js';

const TIMEOUT_MS = 30_000;

async function git(args: string[], cwd: string) {
  return run('git', args, { cwd, timeoutMs: TIMEOUT_MS });
}

async function headAndStatus(cwd: string): Promise<{ head: string; status: string }> {
  const head = (await git(['rev-parse', 'HEAD'], cwd)).stdout.trim();
  const status = (await git(['status', '--porcelain'], cwd)).stdout.trim();
  return { head, status };
}

/**
 * True when `git revert --no-commit <sha>` applies without conflict, false when it conflicts.
 * Throws when the copy is not clean before the trial or cannot be restored after it.
 */
export async function trialRevert(copyDir: string, sha: string): Promise<boolean> {
  const before = await headAndStatus(copyDir);
  if (!before.head) throw new Error(`trialRevert: ${copyDir} is not a git working copy`);
  if (before.status) throw new Error(`trialRevert: the copy has changes before the trial:\n${before.status}`);

  const parents = (await git(['rev-list', '--parents', '-n', '1', sha], copyDir)).stdout.trim().split(/\s+/);
  if (parents.length < 2) throw new Error(`trialRevert: unknown commit ${sha}`);
  const isMerge = parents.length > 2;

  const attempt = await git(['revert', '--no-commit', '--no-edit', ...(isMerge ? ['-m', '1'] : []), sha], copyDir);
  const clean = attempt.code === 0;

  // Put the copy back: drop any revert state, the index and the working tree changes.
  await git(['revert', '--abort'], copyDir); // fails harmlessly when there is no revert in progress
  await git(['reset', '-q', '--hard', before.head], copyDir);
  await git(['clean', '-fdq'], copyDir);

  const after = await headAndStatus(copyDir);
  if (after.head !== before.head || after.status) {
    throw new Error(`trialRevert: could not restore the copy (HEAD ${after.head}, status ${after.status || 'clean'})`);
  }
  return clean;
}
