// node monitoring/stop.mjs
// Stops the Prometheus that start.mjs started and waits until port 9090 is free.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 9090;
const here = path.dirname(fileURLToPath(import.meta.url));
const pidFile = path.join(here, '.run', 'pid');

if (!fs.existsSync(pidFile)) {
  console.log('Prometheus is not running');
  process.exit(0);
}
const pid = Number(fs.readFileSync(pidFile, 'utf8').trim());

if (process.platform === 'win32') {
  // An argument array and no shell: Git Bash would rewrite /PID into a path.
  spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
} else {
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // already gone
  }
}

function portIsFree() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(PORT, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

const deadline = Date.now() + 10_000;
let free = await portIsFree();
while (!free && Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 250));
  free = await portIsFree();
}
if (!free) {
  console.log(`Port ${PORT} is still in use after 10 seconds (pid ${pid})`);
  process.exit(1);
}
fs.rmSync(pidFile, { force: true });
console.log('Prometheus stopped');
process.exit(0);
