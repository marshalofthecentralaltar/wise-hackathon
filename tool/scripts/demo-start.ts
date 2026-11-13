// npm run demo-start [-- --with-tool]
// Starts everything around the tool for a demo or a test run: the watcher on port 3000 (it deploys
// the card app's main from GitHub and redeploys when main moves), then Prometheus through
// monitoring/start.mjs, and waits until /card answers 200, the deployment file exists and
// Prometheus reports the card-app target up. One line per thing that is ready; exit 0 and the
// watcher (and Prometheus) keep running. --with-tool also starts the tool and waits for
// "Listening in". Refuses (exit 1, nothing started or stopped) when port 3000 or 9090 already
// answers or a start is already recorded. Logs and the pid record: tool/.state/demo/.
// Stop everything with: npm run demo-stop
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readDeployed } from '../src/reset.js';
import { WATCHER_DEFAULTS } from '../src/deployWatcher.js';
import { PORTS, PROMETHEUS_LOG, RECORD_PATH, TOOL_LOG, WATCHER_LOG, readRecord, runMonitoring, stopDemo, writeRecord, type DemoRecord } from './lib/demo.js';
import { DEMO_DIR, TOOL_DIR, TSX_CLI, portAnswers, startLogged, startToolProcess, waitForLine } from './lib/procs.js';

const withTool = process.argv.includes('--with-tool');
const READY_LIMIT_MS = 300_000;
const say = (line: string) => console.log(`[demo-start] ${line}`);
const t0 = performance.now();
const since = () => `${Math.round((performance.now() - t0) / 100) / 10} s`;

// 1. Refuse when anything is already there; nothing is started or stopped.
const recorded = readRecord();
if (recorded) {
  say(`a start is already recorded in ${RECORD_PATH} (started ${recorded.startedAt}, watcher pid ${recorded.watcherPid ?? '-'}, tool pid ${recorded.toolPid ?? '-'}); run npm run demo-stop first`);
  process.exit(1);
}
const busy: string[] = [];
for (const { port, what } of PORTS) if (await portAnswers(port)) busy.push(`port ${port} already answers (${what} or something else)`);
if (busy.length) {
  say(`${busy.join('; ')}; nothing was started. Stop it first (npm run demo-stop stops what demo-start started).`);
  process.exit(1);
}

mkdirSync(DEMO_DIR, { recursive: true });
const record: DemoRecord = { startedAt: new Date().toISOString(), watcherPid: null, prometheus: false, toolPid: null };

async function giveUp(reason: string): Promise<never> {
  say(`FAILED: ${reason}`);
  say('stopping what this start began');
  await stopDemo((l) => say(`  ${l}`));
  process.exit(1);
}

// 2. The watcher, with its defaults (the real GitHub repository), its output in its own log.
writeFileSync(WATCHER_LOG, '');
const watcher = startLogged(process.execPath, [TSX_CLI, join(TOOL_DIR, 'scripts', 'deploy-watch.ts')], { log: WATCHER_LOG });
record.watcherPid = watcher.pid;
writeRecord(record);
say(`watcher started (pid ${watcher.pid}); log ${WATCHER_LOG}`);

// 3. Prometheus (downloads itself once), scraping localhost:3000.
const prom = runMonitoring('start.mjs', 240_000);
writeFileSync(PROMETHEUS_LOG, prom.out);
record.prometheus = true;
writeRecord(record);
if (prom.code !== 0) await giveUp(`monitoring/start.mjs exited ${prom.code}: ${prom.last}`);
say(`${prom.last} (${since()})`);

// 4. Wait for the page, the deployment file and the scraped target.
let exited: number | null | undefined;
void watcher.exited.then((c) => (exited = c));
const ready = { card: false, deployed: false, target: false };
while (!(ready.card && ready.deployed && ready.target)) {
  if (exited !== undefined) await giveUp(`the watcher exited (code ${exited}); last lines of ${WATCHER_LOG}:\n${readFileSync(WATCHER_LOG, 'utf8').trim().split(/\r?\n/).slice(-8).join('\n')}`);
  if (performance.now() - t0 > READY_LIMIT_MS) await giveUp(`not ready within ${READY_LIMIT_MS / 1000} s: ${JSON.stringify(ready)}; see ${WATCHER_LOG}`);
  if (!ready.card) {
    try {
      const r = await fetch('http://localhost:3000/card', { signal: AbortSignal.timeout(3000) });
      if (r.status === 200) {
        ready.card = true;
        say(`card app: http://localhost:3000/card answers 200 (${since()})`);
      }
    } catch {
      // not yet
    }
  }
  if (!ready.deployed) {
    const d = readDeployed(WATCHER_DEFAULTS.dir);
    if (d?.commit) {
      ready.deployed = true;
      say(`deployment file: ${join(WATCHER_DEFAULTS.dir, '.deployed.json')} reports ${d.commit.slice(0, 7)} (${since()})`);
    }
  }
  if (!ready.target) {
    try {
      const r = await fetch('http://localhost:9090/api/v1/targets', { signal: AbortSignal.timeout(3000) });
      const body = (await r.json()) as { data?: { activeTargets?: { labels?: { job?: string }; health?: string }[] } };
      if ((body.data?.activeTargets ?? []).some((t) => t.labels?.job === 'card-app' && t.health === 'up')) {
        ready.target = true;
        say(`Prometheus: the card-app target is "health":"up" (${since()})`);
      }
    } catch {
      // not yet
    }
  }
  if (!(ready.card && ready.deployed && ready.target)) await new Promise((r) => setTimeout(r, 1000));
}

// 5. The watcher's own lines must really be in its log.
const start = await waitForLine(watcher, /"event":"start"/, 10_000, 'the watcher');
if (!start.ok) await giveUp(start.reason);
say(`watcher log holds its "event":"start" line (${WATCHER_LOG})`);

// 6. Optionally the tool.
if (withTool) {
  try {
    const tool = await startToolProcess({ log: TOOL_LOG });
    record.toolPid = tool.pid;
    writeRecord(record);
    say(`tool: listening in #support (pid ${tool.pid}); log ${TOOL_LOG} (${since()})`);
  } catch (err) {
    await giveUp(err instanceof Error ? err.message : String(err));
  }
}

say(`ready in ${since()}. Stop everything with: npm run demo-stop`);
process.exit(0);
