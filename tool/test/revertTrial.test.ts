import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { trialRevert } from '../src/revertTrial.js';
import { git, newRepo, numbered, writeAndCommit } from './gitRepo.js';

describe('trialRevert', () => {
  let cleanup: (() => void) | undefined;
  afterEach(() => cleanup?.());

  it('true for a commit that reverts cleanly, false when a later commit changed its lines, and the copy is unchanged after each', async () => {
    const repo = newRepo('revert-');
    cleanup = repo.cleanup;
    const { dir } = repo;
    writeAndCommit(dir, { 'a.txt': numbered(20), 'b.txt': numbered(5) }, 'start');
    const clean = writeAndCommit(dir, { 'b.txt': numbered(5, { 3: 'changed in b' }) }, 'change b line 3');
    const conflicted = writeAndCommit(dir, { 'a.txt': numbered(20, { 10: 'first change' }) }, 'change a line 10');
    writeAndCommit(dir, { 'a.txt': numbered(20, { 10: 'second change, on top' }) }, 'change a line 10 again');
    const head = git(dir, 'rev-parse', 'HEAD');

    expect(await trialRevert(dir, clean)).toBe(true);
    expect(git(dir, 'status', '--porcelain')).toBe('');
    expect(git(dir, 'rev-parse', 'HEAD')).toBe(head);

    expect(await trialRevert(dir, conflicted)).toBe(false);
    expect(git(dir, 'status', '--porcelain')).toBe('');
    expect(git(dir, 'rev-parse', 'HEAD')).toBe(head);
    // No revert left half done.
    expect(() => git(dir, 'rev-parse', '-q', '--verify', 'REVERT_HEAD')).toThrow();
  }, 30_000);

  it('refuses to run in a copy that already has changes', async () => {
    const repo = newRepo('revert-');
    cleanup = repo.cleanup;
    const sha = writeAndCommit(repo.dir, { 'a.txt': 'x\n' }, 'start');
    writeAndCommit(repo.dir, { 'a.txt': 'y\n' }, 'next');
    writeFileSync(join(repo.dir, 'a.txt'), 'uncommitted\n');
    await expect(trialRevert(repo.dir, sha)).rejects.toThrow(/changes before the trial/);
    expect(readFileSync(join(repo.dir, 'a.txt'), 'utf8')).toBe('uncommitted\n'); // left alone
  }, 30_000);
});
