// What demo-start records and what demo-stop undoes. Everything lives under tool/.state/demo/.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { WATCHER_DEFAULTS } from '../../src/deployWatcher.js';
import { DEMO_DIR, REPO_DIR, isAlive, portAnswers, stopTree } from './procs.js';

export const RECORD_PATH = join(DEMO_DIR, 'demo.json');
export const WATCHER_LOG = join(DEMO_DIR, 'watcher.log');
export const TOOL_LOG = join(DEMO_DIR, 'tool.log');
export const PROMETHEUS_LOG = join(DEMO_DIR, 'prometheus-start.log');
export const DEPLOYED_FILE = join(WATCHER_DEFAULTS.dir, '.deployed.json');
export const MONITORING_DIR = join(REPO_DIR, 'monitoring');
export const PORTS = [
  { port: 3000, what: 'the card app (the watcher)' },
  { port: 9090, what: 'Prometheus' },
] as const;

export interface DemoRecord {
  startedAt: string;
  watcherPid: number | null;
  prometheus: boolean;
  toolPid: number | null;
}

export function readRecord(): DemoRecord | null {
  if (!existsSync(RECORD_PATH)) return null;
  try {
    return JSON.parse(readFileSync(RECORD_PATH, 'utf8')) as DemoRecord;
  } catch {
    return { startedAt: '?', watcherPid: null, prometheus: true, toolPid: null };
  }
}

export const writeRecord = (r: DemoRecord) => writeFileSync(RECORD_PATH, JSON.stringify(r, null, 2));

/** node monitoring/<script>.mjs; resolves with its exit code and its last output line. */
export function runMonitoring(script: 'start.mjs' | 'stop.mjs', timeoutMs: number): { code: number | null; last: string; out: string } {
  const r = spawnSync(process.execPath, [join(MONITORING_DIR, script)], { encoding: 'utf8', timeout: timeoutMs, windowsHide: true });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  return { code: r.status, last: out.trim().split(/\r?\n/).at(-1) ?? '', out };
}

/**
 * Stops what a record names (the tool, the watcher and its app), then Prometheus through its own
 * stop script, and confirms both ports refuse connections. Safe to run with nothing running.
 */
export async function stopDemo(say: (line: string) => void): Promise<{ ok: boolean }> {
  const rec = readRecord();
  if (rec?.toolPid) {
    const gone = await stopTree(rec.toolPid);
    say(`tool (pid ${rec.toolPid}): ${gone ? 'stopped' : 'STILL RUNNING'}`);
  }
  if (rec?.watcherPid) {
    const was = isAlive(rec.watcherPid);
    const gone = await stopTree(rec.watcherPid);
    say(`watcher and card app (pid ${rec.watcherPid}): ${!was ? 'was not running' : gone ? 'stopped' : 'STILL RUNNING'}`);
    // Stopped hard, the watcher could not remove its deployment file; no app runs now.
    if (gone && existsSync(DEPLOYED_FILE)) rmSync(DEPLOYED_FILE, { force: true });
  }
  const prom = runMonitoring('stop.mjs', 30_000);
  say(`Prometheus: ${prom.last || `stop.mjs exit ${prom.code}`}`);

  let ok = true;
  for (const { port, what } of PORTS) {
    let open = await portAnswers(port);
    for (let i = 0; open && i < 20; i++) {
      await new Promise((r) => setTimeout(r, 500));
      open = await portAnswers(port);
    }
    say(`port ${port} (${what}): ${open ? 'STILL ANSWERS' : 'refuses connections'}`);
    if (open) ok = false;
  }
  if (ok) rmSync(RECORD_PATH, { force: true });
  return { ok };
}
