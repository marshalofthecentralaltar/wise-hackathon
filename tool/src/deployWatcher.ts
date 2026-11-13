// Deploy on merge: watches the card app's `main` on its remote and redeploys the local copy when it
// moves, forwards or backwards. The logic (DeployWatcher) takes its git, npm and process actions as
// DeployOps, so it is tested without a network; realDeployOps() are the actions on this machine.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { killTree, run } from './fix.js';
import { paths } from './paths.js';

export interface WatcherOptions {
  dir: string;
  repo: string;
  remoteUrl: string;
  port: number;
  intervalSeconds: number;
}

export const WATCHER_DEFAULTS = {
  dir: paths.deployDir,
  repo: 'marshalofthecentralaltar/demo-bank-card-app',
  port: 3000,
  intervalSeconds: 2,
} as const;

export function parseWatcherArgs(argv: string[]): WatcherOptions {
  const value = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    if (i !== -1) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new Error(`--${name} needs a value`);
      return v;
    }
    const eq = argv.find((a) => a.startsWith(`--${name}=`));
    return eq === undefined ? undefined : eq.slice(name.length + 3);
  };
  const known = new Set(['dir', 'repo', 'remote-url', 'port', 'interval']);
  for (const a of argv) {
    if (a.startsWith('--') && !known.has(a.slice(2).split('=')[0]!)) throw new Error(`Unknown option ${a}`);
  }
  const repo = value('repo') ?? WATCHER_DEFAULTS.repo;
  const port = Number(value('port') ?? WATCHER_DEFAULTS.port);
  const intervalSeconds = Number(value('interval') ?? WATCHER_DEFAULTS.intervalSeconds);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`--port must be a port number, got ${value('port')}`);
  if (!(intervalSeconds > 0)) throw new Error(`--interval must be a number of seconds above 0, got ${value('interval')}`);
  return {
    dir: value('dir') ?? WATCHER_DEFAULTS.dir,
    repo,
    remoteUrl: value('remote-url') ?? `https://github.com/${repo}.git`,
    port,
    intervalSeconds,
  };
}

/** Everything the watcher does to the outside world. Each action throws with a readable reason on failure. */
export interface DeployOps {
  /** The commit the remote's `main` points at now. */
  remoteHead(): Promise<string>;
  /** Makes sure the checkout exists and holds `commit`; returns the commit to deploy (normally `commit`). */
  fetch(commit: string): Promise<string>;
  checkout(commit: string): Promise<void>;
  /** True when package-lock.json differs between the two commits. */
  lockfileChanged(from: string, to: string): Promise<boolean>;
  install(): Promise<void>;
  build(): Promise<void>;
  stopApp(): Promise<void>;
  /** Starts the built app. `onExit` is called when it exits without stopApp having stopped it. */
  startApp(onExit: (code: number | null) => void): Promise<void>;
  /** Resolves when the page answers 200; throws when it does not in time. */
  waitReady(): Promise<void>;
  /** Writes `<dir>/.deployed.json` for the running commit, or removes it (null) when no app runs. */
  recordDeployed(commit: string | null): Promise<void>;
}

/** Restarts of an app that exited by itself allowed within RESTART_WINDOW_MS before the watcher gives up. */
export const MAX_RESTARTS = 3;
export const RESTART_WINDOW_MS = 60_000;

export interface RedeployRecord {
  event: 'start' | 'redeploy';
  from: string | null;
  to: string;
  installed: boolean;
  seconds: {
    detect_to_fetched: number;
    install: number;
    build: number;
    restart: number;
    total: number;
  };
  at: string;
}

export interface WatcherHooks {
  now?: () => number;
  log?: (line: string) => void;
  onRedeploy?: (record: RedeployRecord) => void;
}

const secs = (ms: number) => Math.round(ms / 10) / 100;
const short = (c: string | null) => (c ? c.slice(0, 7) : 'nothing');
const reason = (err: unknown) => (err instanceof Error ? err.message : String(err));

export class DeployWatcher {
  /** The commit the running app was built from (null before the first deploy). */
  deployed: string | null = null;
  /** The commit node_modules was installed from. */
  private installedFrom: string | null = null;
  /** The newest commit seen on the remote, and when a poll first saw it. */
  private latest: { commit: string; seenAt: number } | null = null;
  /** A commit whose deploy failed; it is not tried again until the remote moves elsewhere. */
  private failed: string | null = null;
  private running: Promise<void> | null = null;
  /** When the watcher restarted an app that exited by itself (within the last minute). */
  private restarts: number[] = [];
  private stopped = false;
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  private readonly onRedeploy: (record: RedeployRecord) => void;

  constructor(private readonly ops: DeployOps, hooks: WatcherHooks = {}) {
    this.now = hooks.now ?? Date.now;
    this.log = hooks.log ?? (() => {});
    this.onRedeploy = hooks.onRedeploy ?? (() => {});
  }

  /** One poll of the remote. Never throws. Starts a deploy when `main` points somewhere new. */
  async poll(): Promise<void> {
    let head: string;
    try {
      head = await this.ops.remoteHead();
    } catch (err) {
      this.log(`Could not read the remote's main: ${reason(err)}. Trying again at the next poll.`);
      return;
    }
    if (this.latest?.commit !== head) {
      this.latest = { commit: head, seenAt: this.now() };
      if (this.failed !== null && this.failed !== head) this.failed = null;
      if (this.deployed !== null && head !== this.deployed) this.log(`main moved: ${short(this.deployed)} -> ${short(head)}`);
    }
    this.kick();
  }

  /** Resolves when no deploy or app restart is running. */
  async idle(): Promise<void> {
    while (this.running) await this.running;
  }

  /** Stops the app and removes the deployed-commit file. The watcher does nothing after this. */
  async shutdown(): Promise<void> {
    this.stopped = true;
    await this.ops.stopApp();
    await this.record(null);
  }

  private async record(commit: string | null): Promise<void> {
    try {
      await this.ops.recordDeployed(commit);
    } catch (err) {
      this.log(`Could not ${commit ? 'write' : 'remove'} .deployed.json: ${reason(err)}`);
    }
  }

  private readonly onAppExit = (code: number | null): void => {
    // A deploy or restart in progress handles its own app (waitReady fails); after shutdown nothing restarts.
    if (this.stopped || this.running || this.deployed === null) return;
    this.running = (async () => {
      try {
        await this.restartApp(code);
      } finally {
        this.running = null;
      }
      this.kick();
    })();
  };

  /** The deployed app exited by itself: start the same build again, at most MAX_RESTARTS times a minute. */
  private async restartApp(code: number | null): Promise<void> {
    const commit = this.deployed!;
    for (;;) {
      const now = this.now();
      this.restarts = this.restarts.filter((t) => now - t < RESTART_WINDOW_MS);
      if (this.restarts.length >= MAX_RESTARTS) {
        this.log(`The app from ${short(commit)} exited (code ${code}) after ${MAX_RESTARTS} restarts within ${RESTART_WINDOW_MS / 1000} s; giving up. It stays down until the next change of main.`);
        await this.record(null);
        return;
      }
      this.restarts.push(now);
      try {
        await this.ops.startApp(this.onAppExit);
        await this.ops.waitReady();
        this.log(`The app from ${short(commit)} exited (code ${code}); restarted it, /card answered 200 after ${secs(this.now() - now)} s.`);
        return;
      } catch (err) {
        this.log(`Restart of the app from ${short(commit)} failed: ${reason(err)}.`);
        code = null;
      }
    }
  }

  private wanted(): { commit: string; seenAt: number } | null {
    const l = this.latest;
    if (!l || l.commit === this.deployed || l.commit === this.failed) return null;
    return l;
  }

  private kick(): void {
    if (this.stopped || this.running || !this.wanted()) return;
    this.running = (async () => {
      try {
        for (let next = this.wanted(); next; next = this.wanted()) {
          if (!(await this.deploy(next))) break; // a failed fetch is retried at the next poll
        }
      } finally {
        this.running = null;
      }
    })();
  }

  /** Returns false only when the fetch failed, so the caller waits for the next poll. */
  private async deploy(target: { commit: string; seenAt: number }): Promise<boolean> {
    const from = this.deployed;
    const first = from === null;
    let to = target.commit;
    let stage = 'fetch';
    try {
      try {
        to = await this.ops.fetch(target.commit);
      } catch (err) {
        this.log(`Fetch of ${short(target.commit)} failed: ${reason(err)}. Trying again at the next poll.`);
        return false;
      }
      const fetchedAt = this.now();
      if (to !== target.commit) {
        // main moved again between the poll and the fetch
        if (this.latest?.commit === target.commit) this.latest = { commit: to, seenAt: target.seenAt };
        if (to === this.deployed) return true;
      }
      stage = 'checkout';
      await this.ops.checkout(to);

      stage = 'install';
      const t0 = this.now();
      const install = this.installedFrom === null || (await this.ops.lockfileChanged(this.installedFrom, to));
      if (install) {
        await this.ops.install();
        this.installedFrom = to;
      }
      const t1 = this.now();

      stage = 'build';
      await this.ops.build(); // the old app keeps serving meanwhile
      const t2 = this.now();

      stage = 'restart';
      if (!first) await this.ops.stopApp();
      await this.ops.startApp(this.onAppExit);
      await this.ops.waitReady();
      const t3 = this.now();

      this.deployed = to;
      this.failed = null;
      this.restarts = [];
      await this.record(to);
      this.onRedeploy({
        event: first ? 'start' : 'redeploy',
        from,
        to,
        installed: install,
        seconds: {
          detect_to_fetched: secs(fetchedAt - target.seenAt),
          install: secs(t1 - t0),
          build: secs(t2 - t1),
          restart: secs(t3 - t2),
          total: secs(t3 - target.seenAt),
        },
        at: new Date(t3).toISOString(),
      });
    } catch (err) {
      this.failed = to;
      if (stage === 'install') this.installedFrom = null; // node_modules may be half written
      const keeps = stage === 'restart' ? 'the app may be down' : from === null ? 'no app is running yet' : `the app from ${short(from)} keeps running`;
      this.log(`Deploy of ${short(to)} failed at ${stage}: ${reason(err)}. ${keeps}; trying again at the next change of main.`);
      if (stage === 'restart' && from !== null) await this.recover(from);
    }
    return true;
  }

  /** After a failed restart: rebuild and start the commit that ran before. */
  private async recover(commit: string): Promise<void> {
    try {
      await this.ops.stopApp();
      await this.ops.checkout(commit);
      if (this.installedFrom !== null && (await this.ops.lockfileChanged(this.installedFrom, commit))) {
        await this.ops.install();
        this.installedFrom = commit;
      }
      await this.ops.build();
      await this.ops.startApp(this.onAppExit);
      await this.ops.waitReady();
      await this.record(commit);
      this.log(`Recovered: the app from ${short(commit)} runs again.`);
    } catch (err) {
      this.deployed = null;
      await this.record(null);
      this.log(`Could not bring back ${short(commit)}: ${reason(err)}. The app is down until the next change of main.`);
    }
  }
}

const READY_TIMEOUT_MS = 60_000;

/** Written in the checkout after every successful deploy: {"commit":"<full sha>","at":"<ISO time>"}. */
export const DEPLOYED_FILE = '.deployed.json';

/** True for the app's own request-log lines (one JSON object with method, path and status), which are not echoed. */
export function isRequestLogLine(line: string): boolean {
  const t = line.trim();
  if (!t.startsWith('{')) return false;
  try {
    const o = JSON.parse(t) as unknown;
    return typeof o === 'object' && o !== null && !Array.isArray(o) && 'method' in o && 'path' in o && 'status' in o;
  } catch {
    return false;
  }
}

/** Keeps .deployed.json out of `git status` in the checkout, via .git/info/exclude. */
async function excludeFromGit(dir: string): Promise<void> {
  const exclude = join(dir, '.git', 'info', 'exclude');
  const line = `/${DEPLOYED_FILE}`;
  let text = '';
  try {
    text = await readFile(exclude, 'utf8');
  } catch {
    await mkdir(dirname(exclude), { recursive: true });
  }
  if (text.split(/\r?\n/).includes(line)) return;
  await writeFile(exclude, `${text}${text === '' || text.endsWith('\n') ? '' : '\n'}${line}\n`);
}

const tail = (text: string, lines = 15) => text.trim().split(/\r?\n/).slice(-lines).join('\n');

/** True when nothing listens on the port (checked on every address, as the card app listens on all). */
export function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen(port, () => server.close(() => resolve(true)));
  });
}

export interface RealOpsHandle {
  ops: DeployOps;
  /** Stops the app this watcher started, if any. */
  stopApp(): Promise<void>;
}

/** The watcher's actions on this machine: git, npm and the app process. */
export function realDeployOps(opts: WatcherOptions, log: (line: string) => void = () => {}): RealOpsHandle {
  const NET = 60_000;
  let app: ChildProcess | null = null;
  let appExited = false;

  const git = async (args: string[], cwd = opts.dir, timeoutMs = 30_000) => {
    const r = await run('git', args, { cwd, timeoutMs });
    if (r.code !== 0) throw new Error(`git ${args[0]} ${r.timedOut ? 'timed out' : `exited ${r.code}`}: ${tail(r.stderr || r.stdout, 5)}`);
    return r.stdout.trim();
  };
  const npm = async (args: string[], timeoutMs: number) => {
    const r = await run('npm', args, { cwd: opts.dir, timeoutMs, shell: process.platform === 'win32' });
    if (r.code !== 0) throw new Error(`npm ${args.join(' ')} ${r.timedOut ? 'timed out' : `exited ${r.code}`}:\n${tail(r.stdout + '\n' + r.stderr)}`);
  };
  const hasCommit = async (commit: string) => {
    try {
      await git(['cat-file', '-e', `${commit}^{commit}`]);
      return true;
    } catch {
      return false;
    }
  };

  const stopApp = async () => {
    const child = app;
    app = null;
    if (!child || child.pid === undefined) return;
    if (!appExited) killTree(child.pid);
    const deadline = Date.now() + 10_000;
    while (!(await portIsFree(opts.port)) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
  };

  const ops: DeployOps = {
    async remoteHead() {
      const out = await git(['ls-remote', opts.remoteUrl, 'refs/heads/main'], existsSync(opts.dir) ? opts.dir : dirname(opts.dir), NET);
      const sha = out.split(/\s+/)[0] ?? '';
      if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`no refs/heads/main in ls-remote output: ${out.slice(0, 200) || '(empty)'}`);
      return sha;
    },
    async fetch(commit) {
      if (!existsSync(opts.dir)) {
        await mkdir(dirname(opts.dir), { recursive: true });
        log(`Cloning ${opts.remoteUrl} into ${opts.dir}`);
        await git(['clone', '--no-checkout', opts.remoteUrl, opts.dir], dirname(opts.dir), 5 * NET);
      }
      await git(['fetch', '--quiet', opts.remoteUrl, '+refs/heads/main:refs/remotes/origin/main'], opts.dir, NET);
      if (await hasCommit(commit)) return commit;
      // main moved again between the poll and the fetch: deploy what it points at now.
      return git(['rev-parse', 'refs/remotes/origin/main']);
    },
    async checkout(commit) {
      // Detached at the commit, wherever main went: never reset --hard, never a pull.
      await git(['-c', 'advice.detachedHead=false', 'checkout', '--quiet', '--force', '--detach', commit]);
    },
    async lockfileChanged(from, to) {
      const r = await run('git', ['diff', '--quiet', from, to, '--', 'package-lock.json'], { cwd: opts.dir, timeoutMs: 30_000 });
      if (r.code === 0) return false;
      if (r.code === 1) return true;
      return true; // unknown: install to be safe
    },
    async install() {
      await npm(['ci', '--no-audit', '--no-fund'], 10 * NET);
    },
    async build() {
      await npm(['run', 'build'], 5 * NET);
    },
    stopApp,
    async recordDeployed(commit) {
      const file = join(opts.dir, DEPLOYED_FILE);
      if (commit === null) {
        await rm(file, { force: true });
        return;
      }
      await excludeFromGit(opts.dir);
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify({ commit, at: new Date().toISOString() }) + '\n');
      // Rename is atomic on one volume; a reader holding the old file open can make Windows refuse it for a moment.
      for (let i = 0; ; i++) {
        try {
          await rename(tmp, file);
          return;
        } catch (err) {
          if (i >= 20) {
            await rm(tmp, { force: true });
            throw err;
          }
          await new Promise((r) => setTimeout(r, 50));
        }
      }
    },
    async startApp(onExit) {
      appExited = false;
      const child = spawn('npm', ['start'], {
        cwd: opts.dir,
        env: { ...process.env, PORT: String(opts.port) },
        shell: process.platform === 'win32',
        windowsHide: true,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      app = child;
      const prefix = (d: Buffer) =>
        d.toString().split(/\r?\n/).filter((l) => l.trim() && !isRequestLogLine(l)).forEach((l) => log(`[app] ${l}`));
      child.stdout?.on('data', prefix);
      child.stderr?.on('data', prefix);
      child.on('exit', (code) => {
        if (app === child) {
          // Not stopped by stopApp (which clears `app` first): the app died by itself.
          appExited = true;
          log(`[app] exited with code ${code}`);
          onExit(code);
        }
      });
    },
    async waitReady() {
      // 60 s: under load (a build or a browser running alongside) the app once took over 30 s to answer.
      const deadline = Date.now() + READY_TIMEOUT_MS;
      let last = 'no answer';
      while (Date.now() < deadline) {
        if (appExited) throw new Error('the app exited before /card answered');
        try {
          const res = await fetch(`http://localhost:${opts.port}/card`, { signal: AbortSignal.timeout(2_000) });
          await res.arrayBuffer();
          if (res.status === 200) return;
          last = `status ${res.status}`;
        } catch (err) {
          last = reason(err);
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error(`/card did not answer 200 within ${READY_TIMEOUT_MS / 1000} seconds (last: ${last})`);
    },
  };
  return { ops, stopApp };
}
