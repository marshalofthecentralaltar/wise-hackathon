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

let pids = [];
try {
  const out = execFileSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8' });
  pids = [...new Set(out.split('\n').filter((l) => /LISTENING/.test(l) && new RegExp(`:${PORT}\s`).test(l)).map((l) => l.trim().split(/\s+/).at(-1)).filter((p) => p && p !== '0'))];
} catch {}
for (const pid of pids) {
  try {
    execFileSync('taskkill', ['/PID', pid, '/F'], { stdio: 'ignore' });
    console.log(`stopped the helpdesk (pid ${pid})`);
  } catch {}
}
await new Promise((r) => setTimeout(r, 800));

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
  await new Promise((r) => setTimeout(r, 500));
  const ok = await fetch(`http://localhost:${PORT}/api/inbox/tickets`).then((r) => r.ok).catch(() => false);
  if (ok) {
    console.log(`helpdesk running again with an empty inbox (pid ${child.pid}): http://localhost:${PORT}/inbox`);
    process.exit(0);
  }
}
console.error('the helpdesk did not answer within 10 s: see helpdesk/.state/serve.log');
process.exit(1);
