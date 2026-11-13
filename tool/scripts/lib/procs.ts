// Long-running children for full-run, demo-start and demo-stop: started from Node with their output
// in a log file (never through a shell, so the Windows pid is the real one), waited on by a line in
// that log, and stopped with their whole process tree. Paths come from this file's own location.
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SECRETS_FILE } from './secretsLine.js';

/** tool/ */
export const TOOL_DIR = fileURLToPath(new URL('../../', import.meta.url));
/** The repository root (tool/..). */
export const REPO_DIR = join(TOOL_DIR, '..');
export const TSX_CLI = join(TOOL_DIR, 'node_modules', 'tsx', 'dist', 'cli.mjs');
export const DEMO_DIR = join(TOOL_DIR, '.state', 'demo');
export const ARTIFACTS_DIR = join(TOOL_DIR, 'artifacts');

/** What `npm run tool` runs, as an argument array for process.execPath. */
export const TOOL_ARGS = [TSX_CLI, `--env-file-if-exists=${SECRETS_FILE}`, join(TOOL_DIR, 'src', 'main.ts')];
export const LISTENING_LINE = /Listening in #/;

export interface Started {
  pid: number;
  log: string;
  /** Resolves with the exit code when the child exits. */
  exited: Promise<number | null>;
}

/** Starts a child with stdout and stderr appended to `log`. Detached: it outlives this process. */
export function startLogged(command: string, args: string[], opts: { log: string; cwd?: string; env?: NodeJS.ProcessEnv }): Started {
  mkdirSync(dirname(opts.log), { recursive: true });
  const fd = openSync(opts.log, 'a');
  const child = spawn(command, args, { cwd: opts.cwd ?? TOOL_DIR, env: opts.env ?? process.env, stdio: ['ignore', fd, fd], detached: true, windowsHide: true });
  closeSync(fd);
  const exited = new Promise<number | null>((resolve) => {
    child.on('exit', (code) => resolve(code));
    child.on('error', () => resolve(-1));
  });
  child.unref();
  if (!child.pid) throw new Error(`${command} did not start`);
  return { pid: child.pid, log: opts.log, exited };
}

const readText = (path: string) => (existsSync(path) ? readFileSync(path, 'utf8') : '');

/**
 * Waits until `log` holds a line matching `re`. Fails (never throws) when the limit passes or the
 * child exits first, with a plain reason naming the log.
 */
export async function waitForLine(started: Started, re: RegExp, limitMs: number, what: string, pollMs = 250): Promise<{ ok: true; seconds: number } | { ok: false; reason: string }> {
  const t0 = performance.now();
  let exitCode: number | null | undefined;
  void started.exited.then((c) => (exitCode = c));
  for (;;) {
    if (re.test(readText(started.log))) return { ok: true, seconds: Math.round((performance.now() - t0) / 100) / 10 };
    if (exitCode !== undefined) return { ok: false, reason: `${what} exited (code ${exitCode}) before printing ${re}; see ${started.log}` };
    if (performance.now() - t0 >= limitMs) return { ok: false, reason: `${what} did not print ${re} within ${Math.round(limitMs / 1000)} s; see ${started.log}` };
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

/** Stops a process and every child it started. Safe when it is already gone. */
export function killTree(pid: number): void {
  if (process.platform === 'win32') {
    // An argument array and no shell: Git Bash would rewrite /PID into a path.
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  } else {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // already gone
      }
    }
  }
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Kills the tree and waits (up to 10 s) until the pid is gone. */
export async function stopTree(pid: number): Promise<boolean> {
  killTree(pid);
  for (let i = 0; i < 40 && isAlive(pid); i++) await new Promise((r) => setTimeout(r, 250));
  return !isAlive(pid);
}

/** Starts the tool (what `npm run tool` runs) and waits for its "Listening in" line. Kills it on failure. */
export async function startToolProcess(opts: { log: string; limitMs?: number; command?: string; args?: string[] }): Promise<Started> {
  const started = startLogged(opts.command ?? process.execPath, opts.args ?? TOOL_ARGS, { log: opts.log });
  const w = await waitForLine(started, LISTENING_LINE, opts.limitMs ?? 60_000, 'the tool');
  if (!w.ok) {
    await stopTree(started.pid);
    throw new Error(w.reason);
  }
  return started;
}

/** True when something accepts a connection on the port (IPv4 or IPv6 loopback). */
export async function portAnswers(port: number): Promise<boolean> {
  const one = (host: string) =>
    new Promise<boolean>((resolve) => {
      const s = net.connect({ host, port });
      const done = (v: boolean) => {
        s.destroy();
        resolve(v);
      };
      s.setTimeout(1500, () => done(false));
      s.once('connect', () => done(true));
      s.once('error', () => done(false));
    });
  return (await one('127.0.0.1')) || (await one('::1'));
}

/** A UTC stamp for file names: 2026-11-13T22-40-05Z. */
export const fileStamp = (d = new Date()) => d.toISOString().replace(/\.\d+Z$/, 'Z').replace(/:/g, '-');
