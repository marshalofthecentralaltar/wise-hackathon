// npm run deploy-watch -- [--dir <checkout>] [--repo owner/name] [--remote-url <url>] [--port 3000] [--interval 2]
// Deploys the card app's main on the port and redeploys it whenever main moves (forwards or backwards).
// One JSON line per deploy on stdout; everything else is a "[deploy-watch]" line. Ctrl+C stops the app too.
import { DeployWatcher, parseWatcherArgs, portIsFree, realDeployOps } from '../src/deployWatcher.js';

let opts;
try {
  opts = parseWatcherArgs(process.argv.slice(2));
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(2);
}

const log = (line: string) => console.log(`[deploy-watch] ${new Date().toISOString()} ${line}`);

if (!(await portIsFree(opts.port))) {
  log(`Port ${opts.port} is already in use; stop whatever listens there first.`);
  process.exit(1);
}

const real = realDeployOps(opts, log);
const watcher = new DeployWatcher(real.ops, { log, onRedeploy: (r) => console.log(JSON.stringify(r)) });
log(`Watching main of ${opts.remoteUrl} every ${opts.intervalSeconds} s; checkout ${opts.dir}; app on port ${opts.port}`);

let stopping = false;
const shutdown = async (signal: string) => {
  if (stopping) return;
  stopping = true;
  log(`${signal}: stopping the app`);
  await real.stopApp();
  log('stopped');
  process.exit(0);
};
for (const s of ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP'] as const) process.on(s, () => void shutdown(s));

while (!stopping) {
  await watcher.poll();
  await new Promise((r) => setTimeout(r, opts.intervalSeconds * 1000));
}
