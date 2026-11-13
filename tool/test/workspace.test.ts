import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { freshCopy } from '../src/workspace.js';
import { git, newRepo, writeAndCommit } from './gitRepo.js';

describe('freshCopy', () => {
  const source = newRepo('source-');
  const mirrorRoot = mkdtempSync(join(tmpdir(), 'mirrors-'));
  afterAll(() => {
    source.cleanup();
    rmSync(mirrorRoot, { recursive: true, force: true, maxRetries: 5 });
  });

  it('a file edited and a branch created in copy 1 are absent from copy 2; each copy has the newest commit', async () => {
    writeAndCommit(source.dir, { 'src/a.txt': 'original\n' }, 'first');
    const opts = { sourceUrl: source.dir, mirrorRoot };
    const seconds: number[] = [];

    const c1 = await freshCopy('test/repo', opts);
    seconds.push(c1.seconds);
    expect(c1.branch).toBe('main');
    writeFileSync(join(c1.dir, 'src', 'a.txt'), 'edited by run 1\n');
    writeFileSync(join(c1.dir, 'stray.txt'), 'new file from run 1\n');
    git(c1.dir, 'checkout', '-q', '-b', 'run-1-branch');
    git(c1.dir, 'add', '-A');
    git(c1.dir, 'commit', '-q', '-m', 'run 1 commit');

    // The real repository moves on between runs.
    const newest = writeAndCommit(source.dir, { 'src/b.txt': 'added later\n' }, 'second');

    const c2 = await freshCopy('test/repo', opts);
    seconds.push(c2.seconds);
    expect(c2.dir).not.toBe(c1.dir);
    // The copy checks out with this machine's line endings (CRLF on Windows).
    expect(readFileSync(join(c2.dir, 'src', 'a.txt'), 'utf8').replace(/\r\n/g, '\n')).toBe('original\n');
    expect(() => readFileSync(join(c2.dir, 'stray.txt'))).toThrow();
    expect(git(c2.dir, 'status', '--porcelain')).toBe('');
    expect(git(c2.dir, 'branch', '-a', '--list', '*run-1*')).toBe('');
    expect(git(c2.dir, 'log', '--all', '--format=%s')).not.toContain('run 1 commit');
    expect(c2.head).toBe(newest);
    expect(c2.branch).toBe('main');
    // The copy pushes to the real repository, never to the mirror.
    expect(git(c2.dir, 'remote', 'get-url', 'origin')).toBe(source.dir);

    const c3 = await freshCopy('test/repo', opts);
    seconds.push(c3.seconds);
    expect(git(c3.dir, 'status', '--porcelain')).toBe('');

    for (const c of [c1, c2, c3]) await c.remove();
    console.log(`freshCopy seconds for 3 copies (local source): ${seconds.join(', ')}`);
  }, 60_000);
});
