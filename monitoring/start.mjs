// node monitoring/start.mjs [--target localhost:3000] [--scheme http]
// Downloads Prometheus once, writes its settings for the target and starts it on 127.0.0.1:9090.
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROMETHEUS_VERSION = '3.15.1';
const PORT = 9090;

const here = path.dirname(fileURLToPath(import.meta.url));
const binDir = path.join(here, '.bin');
const runDir = path.join(here, '.run');

function option(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && process.argv[i + 1] !== undefined) return process.argv[i + 1];
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.slice(name.length + 3) : fallback;
}

function fail(message) {
  console.log(message);
  process.exit(1);
}

// 1. Check the port, before anything is downloaded.
function portIsFree() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(PORT, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}
if (!(await portIsFree())) fail(`Port ${PORT} is already in use`);

// 2. Pick the release for this system.
const platforms = {
  'win32-x64': 'windows-amd64',
  'linux-x64': 'linux-amd64',
  'darwin-x64': 'darwin-amd64',
  'darwin-arm64': 'darwin-arm64',
};
const osArch = platforms[`${process.platform}-${process.arch}`];
if (!osArch) fail(`No Prometheus release for ${process.platform}-${process.arch}`);
const releaseName = `prometheus-${PROMETHEUS_VERSION}.${osArch}`;
const archiveName = `${releaseName}.tar.gz`;
const releaseUrl = `https://github.com/prometheus/prometheus/releases/download/v${PROMETHEUS_VERSION}`;
const unpackedDir = path.join(binDir, releaseName);

// 3 to 5. Download once, check the SHA-256, unpack.
if (!fs.existsSync(unpackedDir)) {
  fs.mkdirSync(binDir, { recursive: true });
  const archivePath = path.join(binDir, archiveName);
  console.log(`Downloading ${archiveName}`);
  const res = await fetch(`${releaseUrl}/${archiveName}`);
  if (!res.ok) fail(`Download of ${archiveName} answered ${res.status}`);
  fs.writeFileSync(archivePath, Buffer.from(await res.arrayBuffer()));

  const sumsRes = await fetch(`${releaseUrl}/sha256sums.txt`);
  if (!sumsRes.ok) fail(`Download of sha256sums.txt answered ${sumsRes.status}`);
  const sums = await sumsRes.text();
  const line = sums.split(/\r?\n/).find((l) => l.trim().endsWith(`  ${archiveName}`) || l.trim().split(/\s+/)[1] === archiveName);
  const expected = line ? line.trim().split(/\s+/)[0].toLowerCase() : '(no line for this file in sha256sums.txt)';
  const actual = crypto.createHash('sha256').update(fs.readFileSync(archivePath)).digest('hex');
  if (actual !== expected) {
    fs.rmSync(archivePath, { force: true });
    fail(`SHA-256 mismatch for ${archiveName}\nexpected ${expected}\nactual   ${actual}`);
  }

  // The bare file name with cwd set: GNU tar in Git Bash reads C:\... as a remote host.
  const tar = spawnSync('tar', ['-xzf', archiveName], { cwd: binDir, encoding: 'utf8' });
  if (tar.status !== 0 || !fs.existsSync(unpackedDir)) {
    fail(`tar could not unpack ${archiveName}: ${tar.error ? String(tar.error) : (tar.stderr || '').trim()}`);
  }
  fs.rmSync(archivePath, { force: true });
}

// 6. Write the settings.
const target = option('target', 'localhost:3000');
const scheme = option('scheme', 'http');
fs.mkdirSync(runDir, { recursive: true });
const template = fs.readFileSync(path.join(here, 'prometheus.template.yml'), 'utf8');
fs.writeFileSync(path.join(runDir, 'prometheus.yml'), template.replaceAll('{{TARGET}}', target).replaceAll('{{SCHEME}}', scheme));
fs.copyFileSync(path.join(here, 'rules.yml'), path.join(runDir, 'rules.yml'));

// 7. Start Prometheus as a process that outlives this script.
const exePath = path.join(unpackedDir, process.platform === 'win32' ? 'prometheus.exe' : 'prometheus');
const logPath = path.join(runDir, 'prometheus.log');
const out = fs.openSync(logPath, 'a');
const child = spawn(exePath, [
  `--config.file=${path.join(runDir, 'prometheus.yml')}`,
  `--storage.tsdb.path=${path.join(runDir, 'data')}`,
  '--web.listen-address=127.0.0.1:9090',
], { detached: true, stdio: ['ignore', out, out], windowsHide: true });
child.unref();
fs.writeFileSync(path.join(runDir, 'pid'), String(child.pid));

// 8. Wait until it is ready.
const deadline = Date.now() + 60_000;
while (Date.now() < deadline) {
  try {
    const res = await fetch(`http://localhost:${PORT}/-/ready`, { signal: AbortSignal.timeout(2_000) });
    if (res.status === 200) {
      console.log(`Prometheus ready at http://localhost:${PORT}`);
      process.exit(0);
    }
  } catch {
    // not up yet
  }
  await new Promise((r) => setTimeout(r, 500));
}
const logLines = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8').split(/\r?\n/).filter(Boolean).slice(-20) : [];
console.log(`Prometheus did not become ready within 60 seconds. Last lines of ${logPath}:`);
console.log(logLines.join('\n'));
process.exit(1);
