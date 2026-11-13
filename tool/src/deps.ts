// Dependencies for a fresh copy, fast.
//
// The card app needs node_modules before `npm test`. Installing into every copy costs a full
// `npm ci` per run. Instead one install is kept per package-lock.json, under
// <tmp>/wise-deps/<hash of the lock file>/node_modules, filled once (the cold path), and each copy
// gets a directory junction to it (the warm path, no admin rights needed on Windows).
// The junction is listed in the copy's .git/info/exclude, so git never sees it as a change and
// `git clean -fd` never follows it.

import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { appendFile, lstat, mkdir, readFile, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from './fix.js';

const INSTALL_TIMEOUT_MS = 240_000;
const secondsSince = (t0: number) => Math.round((performance.now() - t0) / 100) / 10;

export interface DepsResult {
  /** True when this call had to install (no warm install for this lock file yet). */
  cold: boolean;
  seconds: number;
  /** The shared install the copy now links to. */
  cacheDir: string;
}

export interface DepsOptions {
  /** Where installs are kept. Default: <tmp>/wise-deps. */
  cacheRoot?: string;
}

export function lockHash(lockText: string): string {
  return createHash('sha256').update(lockText.replace(/\r\n/g, '\n')).digest('hex').slice(0, 16);
}

// One install per lock file at a time in this process.
const installs = new Map<string, Promise<void>>();

async function installInto(cacheDir: string, copyDir: string): Promise<void> {
  const staging = `${cacheDir}.tmp-${randomBytes(3).toString('hex')}`;
  await mkdir(staging, { recursive: true });
  try {
    for (const f of ['package.json', 'package-lock.json']) await writeFile(join(staging, f), await readFile(join(copyDir, f)));
    const r = await run('npm ci --no-audit --no-fund --ignore-scripts --prefer-offline', [], { cwd: staging, timeoutMs: INSTALL_TIMEOUT_MS, shell: true });
    if (r.code !== 0) throw new Error(`npm ci failed (exit ${r.code}${r.timedOut ? ', timed out' : ''}): ${(r.stderr + r.stdout).trim().slice(-500)}`);
    await writeFile(join(staging, '.complete'), new Date().toISOString());
    try {
      await rename(staging, cacheDir);
    } catch (err) {
      // Another process finished first: use its install.
      if (!existsSync(join(cacheDir, '.complete'))) throw err;
      await rm(staging, { recursive: true, force: true, maxRetries: 3 });
    }
  } catch (err) {
    await rm(staging, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
    throw err;
  }
}

/** Makes `<copyDir>/node_modules` a junction to the shared install for the copy's lock file, installing it first when needed. */
export async function ensureDeps(copyDir: string, opts: DepsOptions = {}): Promise<DepsResult> {
  const t0 = performance.now();
  const cacheRoot = opts.cacheRoot ?? join(tmpdir(), 'wise-deps');
  const lock = await readFile(join(copyDir, 'package-lock.json'), 'utf8');
  const cacheDir = join(cacheRoot, lockHash(lock));
  await excludeNodeModules(copyDir);

  let cold = false;
  if (!existsSync(join(cacheDir, '.complete'))) {
    cold = true;
    await mkdir(cacheRoot, { recursive: true });
    let p = installs.get(cacheDir);
    if (!p) {
      p = installInto(cacheDir, copyDir);
      installs.set(cacheDir, p);
      p.catch(() => installs.delete(cacheDir));
    }
    await p;
  }
  await symlink(join(cacheDir, 'node_modules'), join(copyDir, 'node_modules'), 'junction');
  return { cold, seconds: secondsSince(t0), cacheDir };
}

/** Lists node_modules in the copy's own exclude file, so git ignores the junction whatever .gitignore says. */
export async function excludeNodeModules(copyDir: string): Promise<void> {
  const exclude = join(copyDir, '.git', 'info', 'exclude');
  await mkdir(join(copyDir, '.git', 'info'), { recursive: true });
  const text = existsSync(exclude) ? await readFile(exclude, 'utf8') : '';
  if (!/^\/?node_modules\/?$/m.test(text)) await appendFile(exclude, `${text.endsWith('\n') || !text ? '' : '\n'}/node_modules\n`);
}

/** Removes the junction itself, never what it points to. Call before deleting the copy. */
export async function unlinkDeps(copyDir: string): Promise<void> {
  const link = join(copyDir, 'node_modules');
  const st = await lstat(link).catch(() => null);
  if (st?.isSymbolicLink()) await unlink(link).catch(() => rm(link, { force: true }));
}
