// A fresh copy of a repository for one run, fast.
//
// A full `git clone` from GitHub costs a network round trip per run. Instead the tool keeps one
// bare mirror per repository in the temp folder, fetches it (one round trip, about 1.3 s
// measured on 13 Nov), and clones the copy locally from the mirror (about 0.3 s measured).
// The mirror is only ever fetched into, never pushed to or checked out, so nothing a run does
// in its copy (edits, commits, branches) can reach the next run's copy.

import { mkdtemp, mkdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from './fix.js';

const NETWORK_TIMEOUT_MS = 60_000;
const LOCAL_TIMEOUT_MS = 30_000;

export interface FreshCopy {
  repo: string;
  /** The working tree: the default branch at its newest commit, full history. */
  dir: string;
  branch: string;
  head: string;
  seconds: number;
  fetchSeconds: number;
  cloneSeconds: number;
  /** Deletes the copy (not the mirror). */
  remove(): Promise<void>;
}

export interface FreshCopyOptions {
  /** Where mirrors are kept. Default: <tmp>/wise-mirrors. */
  mirrorRoot?: string;
  /** Where the source lives. Default: https://github.com/<repo>.git. Tests pass a local path. */
  sourceUrl?: string;
}

const secondsSince = (t0: number) => Math.round((performance.now() - t0) / 100) / 10;

async function git(args: string[], cwd: string, timeoutMs = LOCAL_TIMEOUT_MS): Promise<string> {
  const r = await run('git', args, { cwd, timeoutMs });
  if (r.code !== 0) {
    const why = r.timedOut ? `timed out after ${timeoutMs / 1000} s` : `exit ${r.code}`;
    throw new Error(`git ${args.slice(0, 3).join(' ')} failed (${why}): ${(r.stderr + r.stdout).trim().slice(0, 500)}`);
  }
  return r.stdout.trim();
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

// One fetch-and-clone at a time per mirror: two runs fetching one mirror at once would fight over its locks.
const mirrorLocks = new Map<string, Promise<unknown>>();
function withMirrorLock<T>(mirror: string, work: () => Promise<T>): Promise<T> {
  const before = mirrorLocks.get(mirror) ?? Promise.resolve();
  const next = before.then(work, work);
  mirrorLocks.set(mirror, next.catch(() => undefined));
  return next;
}

export function mirrorPathFor(repo: string, mirrorRoot = join(tmpdir(), 'wise-mirrors')): string {
  return join(mirrorRoot, repo.replace(/[\\/]/g, '__') + '.git');
}

export async function freshCopy(repo: string, opts: FreshCopyOptions = {}): Promise<FreshCopy> {
  const t0 = performance.now();
  const sourceUrl = opts.sourceUrl ?? `https://github.com/${repo}.git`;
  const mirrorRoot = opts.mirrorRoot ?? join(tmpdir(), 'wise-mirrors');
  const mirror = mirrorPathFor(repo, mirrorRoot);
  const workdir = await mkdtemp(join(tmpdir(), 'copy-'));
  const dir = join(workdir, 'repo');
  let fetchSeconds = 0;
  let cloneSeconds = 0;

  try {
    await withMirrorLock(mirror, async () => {
      // 1. Bring the mirror up to date (create it on first use).
      const tf = performance.now();
      if (await exists(join(mirror, 'HEAD'))) {
        await git(['--git-dir', mirror, 'fetch', '-q', '--prune', 'origin'], mirrorRoot, NETWORK_TIMEOUT_MS);
      } else {
        await mkdir(mirrorRoot, { recursive: true });
        await rm(mirror, { recursive: true, force: true, maxRetries: 3 });
        await git(['clone', '-q', '--mirror', sourceUrl, mirror], mirrorRoot, NETWORK_TIMEOUT_MS);
      }
      fetchSeconds = secondsSince(tf);

      // 2. A new working copy of the mirror's default branch.
      const tc = performance.now();
      await git(['clone', '-q', mirror, dir], workdir);
      cloneSeconds = secondsSince(tc);
    });
    // The copy's origin is the real repository, so a later step pushes there, never to the mirror.
    await git(['remote', 'set-url', 'origin', sourceUrl], dir);
    const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], dir);
    const head = await git(['rev-parse', 'HEAD'], dir);
    return {
      repo,
      dir,
      branch,
      head,
      seconds: secondsSince(t0),
      fetchSeconds,
      cloneSeconds,
      remove: () => rm(workdir, { recursive: true, force: true, maxRetries: 5 }),
    };
  } catch (err) {
    await rm(workdir, { recursive: true, force: true, maxRetries: 5 }).catch(() => undefined);
    throw err;
  }
}
