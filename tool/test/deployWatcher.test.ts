// The deploy watcher's logic with fake git, npm and app actions: no network, no processes.
import { describe, expect, it } from 'vitest';
import { DeployWatcher, isRequestLogLine, parseWatcherArgs, type DeployOps, type RedeployRecord } from '../src/deployWatcher.js';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);
const D = 'd'.repeat(40);

class FakeRemote implements DeployOps {
  head = A;
  calls: string[] = [];
  checkedOut: string | null = null;
  appRunning: string | null = null;
  lockChanges = new Set<string>(); // "from>to" pairs whose package-lock.json differs
  failBuildOf = new Set<string>();
  failFetches = 0;
  /** When set, build waits for this promise (to move main during a build). */
  buildGate: Promise<void> | null = null;
  clock = 0;

  async remoteHead() {
    this.calls.push('ls-remote');
    return this.head;
  }
  async fetch(commit: string) {
    // Yield to the event loop, so a deploy loop that never ends fails by timeout instead of hanging vitest.
    await new Promise((r) => setImmediate(r));
    if (this.failFetches > 0) {
      this.failFetches--;
      throw new Error('network down');
    }
    this.calls.push(`fetch ${commit[0]}`);
    this.clock += 300;
    return commit;
  }
  async checkout(commit: string) {
    this.calls.push(`checkout ${commit[0]}`);
    this.checkedOut = commit;
  }
  async lockfileChanged(from: string, to: string) {
    return this.lockChanges.has(`${from[0]}>${to[0]}`);
  }
  async install() {
    this.calls.push('install');
    this.clock += 5_000;
  }
  async build() {
    const building = this.checkedOut!;
    this.calls.push(`build ${building[0]}`);
    if (this.buildGate) await this.buildGate;
    this.clock += 1_600;
    if (this.failBuildOf.has(building)) throw new Error('SyntaxError: Unexpected token');
  }
  async stopApp() {
    this.calls.push('stop');
    this.appRunning = null;
    this.clock += 200;
  }
  onExit: ((code: number | null) => void) | null = null;
  failReadyOf = new Set<string>();
  /** What .deployed.json holds: the commit, or null when the file does not exist. */
  deployedFile: string | null = null;
  fileHistory: (string | null)[] = [];
  async startApp(onExit: (code: number | null) => void) {
    this.calls.push(`start ${this.checkedOut![0]}`);
    this.appRunning = this.checkedOut;
    this.onExit = onExit;
  }
  async waitReady() {
    await new Promise((r) => setImmediate(r));
    this.clock += 700;
    if (this.appRunning && this.failReadyOf.has(this.appRunning)) throw new Error('/card did not answer 200');
  }
  async recordDeployed(commit: string | null) {
    this.deployedFile = commit;
    this.fileHistory.push(commit);
  }
  /** The app dies by itself, as an exited process would report it. */
  crash(code = 1) {
    this.calls.push('crash');
    this.appRunning = null;
    this.onExit?.(code);
  }
}

function setup(remote = new FakeRemote()) {
  const records: RedeployRecord[] = [];
  const logs: string[] = [];
  const watcher = new DeployWatcher(remote, {
    now: () => remote.clock,
    log: (l) => logs.push(l),
    onRedeploy: (r) => records.push(r),
  });
  const pollAndSettle = async () => {
    await watcher.poll();
    await watcher.idle();
  };
  return { remote, watcher, records, logs, pollAndSettle };
}

const actions = (calls: string[]) => calls.filter((c) => c !== 'ls-remote');

describe('DeployWatcher', () => {
  it('deploys main at start: fetch, checkout, install, build, start', async () => {
    const { remote, watcher, records, pollAndSettle } = setup();
    await pollAndSettle();
    expect(actions(remote.calls)).toEqual(['fetch a', 'checkout a', 'install', 'build a', 'start a']);
    expect(watcher.deployed).toBe(A);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ event: 'start', from: null, to: A, installed: true });
  });

  it('an unchanged main triggers no redeploy', async () => {
    const { remote, records, pollAndSettle } = setup();
    await pollAndSettle();
    remote.calls = [];
    for (let i = 0; i < 5; i++) await pollAndSettle();
    expect(actions(remote.calls)).toEqual([]);
    expect(remote.calls).toEqual(Array(5).fill('ls-remote'));
    expect(records).toHaveLength(1);
  });

  it('main moving forwards triggers exactly one redeploy, without npm ci when the lockfile is the same', async () => {
    const { remote, watcher, records, pollAndSettle } = setup();
    await pollAndSettle();
    remote.calls = [];
    remote.head = B;
    await pollAndSettle();
    await pollAndSettle();
    expect(actions(remote.calls)).toEqual(['fetch b', 'checkout b', 'build b', 'stop', 'start b']);
    expect(watcher.deployed).toBe(B);
    expect(remote.appRunning).toBe(B);
    expect(records).toHaveLength(2);
    const r = records[1]!;
    expect(r).toMatchObject({ event: 'redeploy', from: A, to: B, installed: false });
    expect(r.seconds).toEqual({ detect_to_fetched: 0.3, install: 0, build: 1.6, restart: 0.9, total: 2.8 });
  });

  it('main moving backwards to an older commit triggers exactly one redeploy of that commit', async () => {
    const { remote, watcher, records, pollAndSettle } = setup();
    await pollAndSettle();
    remote.head = B;
    await pollAndSettle();
    remote.calls = [];
    remote.head = A; // the demo's reset moves main back
    await pollAndSettle();
    await pollAndSettle();
    expect(actions(remote.calls)).toEqual(['fetch a', 'checkout a', 'build a', 'stop', 'start a']);
    expect(watcher.deployed).toBe(A);
    expect(records.map((r) => [r.from?.[0] ?? null, r.to[0]])).toEqual([[null, 'a'], ['a', 'b'], ['b', 'a']]);
  });

  it('runs npm ci only when package-lock.json changed', async () => {
    const { remote, records, pollAndSettle } = setup();
    await pollAndSettle();
    remote.lockChanges.add('a>b');
    remote.head = B;
    await pollAndSettle();
    expect(records[1]).toMatchObject({ installed: true });
    expect(records[1]!.seconds.install).toBe(5);
    remote.head = C; // lock compared with b, where node_modules now comes from
    await pollAndSettle();
    expect(records[2]).toMatchObject({ installed: false });
  });

  it('a failing build does not stop or restart the old app, is not retried, and the next good commit deploys', async () => {
    const { remote, watcher, records, logs, pollAndSettle } = setup();
    await pollAndSettle();
    remote.failBuildOf.add(B);
    remote.head = B;
    remote.calls = [];
    await pollAndSettle();
    expect(actions(remote.calls)).toEqual(['fetch b', 'checkout b', 'build b']);
    expect(remote.appRunning).toBe(A);
    expect(watcher.deployed).toBe(A);
    expect(logs.some((l) => /failed at build: SyntaxError/.test(l) && /from aaaaaaa keeps running/.test(l))).toBe(true);
    remote.calls = [];
    await pollAndSettle(); // same broken main: not tried again
    await pollAndSettle();
    expect(actions(remote.calls)).toEqual([]);
    remote.head = C;
    await pollAndSettle();
    expect(actions(remote.calls)).toEqual(['fetch c', 'checkout c', 'build c', 'stop', 'start c']);
    expect(watcher.deployed).toBe(C);
    expect(records.map((r) => r.to[0])).toEqual(['a', 'c']);
    expect(records[1]!.from).toBe(A);
  });

  it('two changes of main during one build end on the newest commit, skipping the one in between', async () => {
    const { remote, watcher, records, pollAndSettle } = setup();
    await pollAndSettle();
    let release!: () => void;
    remote.buildGate = new Promise((r) => (release = r));
    remote.head = B;
    await watcher.poll(); // the deploy of b starts and waits in its build
    await Promise.resolve();
    remote.head = C;
    await watcher.poll();
    remote.head = D;
    await watcher.poll();
    remote.buildGate = null;
    release();
    await watcher.idle(); // no further poll: the newest commit seen during the build deploys straight away
    expect(watcher.deployed).toBe(D);
    expect(remote.appRunning).toBe(D);
    expect(records.map((r) => r.to[0])).toEqual(['a', 'b', 'd']);
    expect(remote.calls.some((c) => c.endsWith(' c'))).toBe(false);
  });

  it('a failed fetch is logged and retried at the next poll, and the watcher keeps going', async () => {
    const { remote, watcher, logs, pollAndSettle } = setup();
    await pollAndSettle();
    remote.head = B;
    remote.failFetches = 1;
    await pollAndSettle();
    expect(watcher.deployed).toBe(A);
    expect(logs.some((l) => /Fetch of bbbbbbb failed: network down/.test(l))).toBe(true);
    await pollAndSettle();
    expect(watcher.deployed).toBe(B);
  });

  it('a failed ls-remote is logged and does not throw', async () => {
    const remote = new FakeRemote();
    remote.remoteHead = async () => {
      throw new Error('could not resolve host');
    };
    const { watcher, logs } = setup(remote);
    await expect(watcher.poll()).resolves.toBeUndefined();
    expect(logs[0]).toMatch(/could not resolve host/);
    expect(watcher.deployed).toBeNull();
  });
});

describe('.deployed.json', () => {
  it('is written after the first deploy and rewritten after a redeploy forwards and backwards', async () => {
    const { remote, pollAndSettle } = setup();
    await pollAndSettle();
    expect(remote.deployedFile).toBe(A);
    remote.head = B;
    await pollAndSettle();
    expect(remote.deployedFile).toBe(B);
    remote.head = A;
    await pollAndSettle();
    expect(remote.deployedFile).toBe(A);
    expect(remote.fileHistory).toEqual([A, B, A]);
  });

  it('is not touched by a failed build', async () => {
    const { remote, pollAndSettle } = setup();
    await pollAndSettle();
    remote.failBuildOf.add(B);
    remote.head = B;
    await pollAndSettle();
    expect(remote.fileHistory).toEqual([A]);
  });

  it('is removed on shutdown, and nothing deploys after it', async () => {
    const { remote, watcher, pollAndSettle } = setup();
    await pollAndSettle();
    await watcher.shutdown();
    expect(remote.deployedFile).toBeNull();
    remote.head = B;
    remote.calls = [];
    await pollAndSettle();
    expect(actions(remote.calls)).toEqual([]);
  });

  it('is removed after a failed restart that could not bring the old commit back', async () => {
    const { remote, watcher, logs, pollAndSettle } = setup();
    await pollAndSettle();
    remote.failReadyOf.add(B).add(A);
    remote.head = B;
    await pollAndSettle();
    expect(logs.some((l) => /Could not bring back aaaaaaa/.test(l))).toBe(true);
    expect(watcher.deployed).toBeNull();
    expect(remote.deployedFile).toBeNull();
    expect(remote.fileHistory).toEqual([A, null]);
  });

  it('keeps the old commit after a failed restart that recovered', async () => {
    const { remote, watcher, pollAndSettle } = setup();
    await pollAndSettle();
    remote.failReadyOf.add(B);
    remote.head = B;
    await pollAndSettle();
    expect(watcher.deployed).toBe(A);
    expect(remote.deployedFile).toBe(A);
  });
});

describe('an app that exits by itself', () => {
  it('is started again from the same build (no fetch, no build), once, with one log line', async () => {
    const { remote, watcher, logs, records, pollAndSettle } = setup();
    await pollAndSettle();
    remote.calls = [];
    remote.crash(1);
    await watcher.idle();
    expect(actions(remote.calls)).toEqual(['crash', 'start a']);
    expect(remote.appRunning).toBe(A);
    expect(logs.filter((l) => /exited \(code 1\); restarted it, \/card answered 200 after/.test(l))).toHaveLength(1);
    expect(records).toHaveLength(1); // a restart is not a redeploy
    expect(remote.deployedFile).toBe(A);
    remote.calls = [];
    await pollAndSettle(); // stays up the second time: nothing more happens
    expect(actions(remote.calls)).toEqual([]);
  });

  it('after 3 restarts within 60 s a 4th exit ends in one give-up line, no loop, and the file removed', async () => {
    const { remote, watcher, logs } = setup();
    await watcher.poll();
    await watcher.idle();
    for (let i = 0; i < 4; i++) {
      remote.crash(1);
      await watcher.idle();
      remote.clock += 1_000;
    }
    expect(remote.calls.filter((c) => c === 'start a')).toHaveLength(4); // the deploy and 3 restarts
    expect(logs.filter((l) => /giving up/.test(l))).toHaveLength(1);
    expect(logs.find((l) => /giving up/.test(l))).toMatch(/after 3 restarts within 60 s/);
    expect(remote.deployedFile).toBeNull();
    expect(remote.appRunning).toBeNull();
  });

  it('restarts again once the earlier restarts are more than 60 s old', async () => {
    const { remote, watcher, logs } = setup();
    await watcher.poll();
    await watcher.idle();
    for (let i = 0; i < 3; i++) {
      remote.crash(1);
      await watcher.idle();
    }
    remote.clock += 61_000;
    remote.crash(1);
    await watcher.idle();
    expect(logs.some((l) => /giving up/.test(l))).toBe(false);
    expect(remote.appRunning).toBe(A);
  });

  it('an exit reported after shutdown starts nothing', async () => {
    const { remote, watcher } = setup();
    await watcher.poll();
    await watcher.idle();
    await watcher.shutdown();
    remote.calls = [];
    remote.onExit?.(1);
    await watcher.idle();
    expect(actions(remote.calls)).toEqual([]);
  });
});

describe('isRequestLogLine', () => {
  it('hides the app request-log JSON and keeps everything else', () => {
    expect(isRequestLogLine('{"time":"2026-11-13T21:13:00.487Z","level":"info","method":"GET","path":"/card","status":200,"ms":34}')).toBe(true);
    expect(isRequestLogLine('  {"method":"GET","path":"/account","status":500}  ')).toBe(true);
    expect(isRequestLogLine('Demo Bank listening on http://localhost:3000')).toBe(false);
    expect(isRequestLogLine('> node dist-server/index.js')).toBe(false);
    expect(isRequestLogLine('{"level":"error","msg":"boom"}')).toBe(false); // JSON, but not a request line
    expect(isRequestLogLine('{"method":"GET","path":"/card"')).toBe(false); // cut off
    expect(isRequestLogLine('[{"method":"GET","path":"/card","status":200}]')).toBe(false);
    expect(isRequestLogLine('Error: listen EADDRINUSE {"method":"GET","path":"/card","status":200}')).toBe(false);
  });
});

describe('parseWatcherArgs', () => {
  it('has the defaults of the brief', () => {
    expect(parseWatcherArgs([])).toEqual({
      dir: 'C:/Users/ralfs/wise-build/demo-bank-card-app-deploy',
      repo: 'marshalofthecentralaltar/demo-bank-card-app',
      remoteUrl: 'https://github.com/marshalofthecentralaltar/demo-bank-card-app.git',
      port: 3000,
      intervalSeconds: 2,
    });
  });

  it('reads every option, and --remote-url overrides where it clones from', () => {
    expect(parseWatcherArgs(['--dir', 'D:/x', '--repo', 'o/r', '--remote-url', 'C:/tmp/bare.git', '--port', '3300', '--interval=0.5'])).toEqual({
      dir: 'D:/x',
      repo: 'o/r',
      remoteUrl: 'C:/tmp/bare.git',
      port: 3300,
      intervalSeconds: 0.5,
    });
  });

  it('refuses an unknown option and a bad port', () => {
    expect(() => parseWatcherArgs(['--prot', '3000'])).toThrow(/Unknown option --prot/);
    expect(() => parseWatcherArgs(['--port', 'x'])).toThrow(/--port/);
  });
});
