// Empties the helpdesk inbox for a fresh demo: stops whatever listens on port 3400, sets
// .state/tickets.jsonl aside (renamed, never deleted), and starts node helpdesk/serve.mjs again
// in the background, logging to helpdesk/.state/serve.log. Waits until the inbox answers.
// node helpdesk/restart-empty.mjs
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const stateDir = process.env.HELPDESK_STATE_DIR || join(here, '.state');
const PORT = 3400;
const answers = () => fetch(`http://localhost:${PORT}/api/inbox/tickets`).then((r) => r.ok).catch(() => false);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Pids listening on PORT, from `netstat -ano`: columns proto, local, foreign, state, pid. */
function listeners() {
  try {
    const out = execFileSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8' });
    const pids = out
      .split(/\r?\n/)
      .map((line) => line.trim().split(/ +/))
      .filter((c) => c[3] === 'LISTENING' && (c[1] ?? '').endsWith(`:${PORT}`))
      .map((c) => c[4])
      .filter((p) => p && p !== '0');
    return [...new Set(pids)];
  } catch {
    return [];
  }
}

for (const pid of listeners()) {
  try {
    execFileSync('taskkill', ['/PID', pid, '/F'], { stdio: 'ignore' });
    console.log(`stopped the helpdesk (pid ${pid})`);
  } catch {
    console.error(`could not stop pid ${pid}`);
  }
}
await sleep(800);
if (await answers()) {
  console.error(`port ${PORT} is still answering after the stop: close the helpdesk window by hand, then run this again`);
  process.exit(1);
}

mkdirSync(stateDir, { recursive: true });
const tickets = join(stateDir, 'tickets.jsonl');
if (existsSync(tickets)) {
  const aside = join(stateDir, `tickets-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
  renameSync(tickets, aside);
  console.log(`old tickets set aside: ${aside}`);
}

const log = openSync(join(stateDir, 'serve.log'), 'a');
const child = spawn(process.execPath, [join(here, 'serve.mjs')], { cwd: join(here, '..'), detached: true, stdio: ['ignore', log, log], windowsHide: true });
child.unref();
for (let i = 0; i < 20; i++) {
  await sleep(500);
  if (await answers()) {
    console.log(`helpdesk running again with an empty inbox (pid ${child.pid}): http://localhost:${PORT}/inbox`);
    process.exit(0);
  }
}
console.error('the helpdesk did not answer within 10 s: see helpdesk/.state/serve.log');
process.exit(1);
