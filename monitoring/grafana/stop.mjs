// node monitoring/grafana/stop.mjs
// Stops the Grafana that start.mjs started and confirms that port 3100 refuses connections.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 3100;
const here = path.dirname(fileURLToPath(import.meta.url));
const runDir = path.join(path.dirname(here), '.run');
const pidPath = path.join(runDir, 'grafana.pid');

/** True when connecting to the port fails, which is what stopped means. */
function portRefuses(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    const done = (refuses) => {
      socket.destroy();
      resolve(refuses);
    };
    socket.setTimeout(2000, () => done(false));
    socket.once('connect', () => done(false));
    socket.once('error', () => done(true));
  });
}

if (!fs.existsSync(pidPath)) {
  if (await portRefuses(PORT)) {
    console.log('Grafana is not running');
    process.exit(0);
  }
  console.log(`Port ${PORT} answers but ${pidPath} is missing. Stop that process by hand.`);
  process.exit(1);
}

const pid = Number(fs.readFileSync(pidPath, 'utf8').trim());

if (process.platform === 'win32') {
  // An argument array and no shell, so Git Bash cannot rewrite /PID into a path.
  spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
} else {
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // already gone
  }
}

const deadline = Date.now() + 15_000;
let refuses = await portRefuses(PORT);
while (!refuses && Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 250));
  refuses = await portRefuses(PORT);
}
if (!refuses) {
  console.log(`Port ${PORT} still accepts connections 15 seconds after stopping pid ${pid}`);
  process.exit(1);
}

fs.rmSync(pidPath, { force: true });
console.log('Grafana stopped');
console.log(`Port ${PORT} refuses connections`);
process.exit(0);
