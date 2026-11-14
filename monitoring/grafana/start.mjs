// node monitoring/grafana/start.mjs
// One command: downloads one fixed Grafana OSS for Windows (SHA-256 checked), unpacks it under
// monitoring/.run/grafana, points it at the Prometheus kit on http://localhost:9090 and starts it
// on http://localhost:3100 with anonymous viewing. Node 22 built-ins only, no packages.
//
// It only touches monitoring/.run/ (ignored by git) and reads the files beside it.
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '13.3.1';
const ARCHIVE = `grafana-${VERSION}.windows-amd64.zip`;
const ARCHIVE_URL = `https://dl.grafana.com/oss/release/${ARCHIVE}`;
// The SHA-256 published beside the release: https://dl.grafana.com/oss/release/<archive>.sha256
const ARCHIVE_SHA256 = 'a5e6fa38c86f44af466f0361ad516651663dd0f3574d771e1c031978c91f69dd';
const ARCHIVE_BYTES = 498_574_922;
const PORT = 3100;
const PROMETHEUS_URL = 'http://localhost:9090';
const DASHBOARD_UID = 'card-and-transfers';

const here = path.dirname(fileURLToPath(import.meta.url));
const monitoringDir = path.dirname(here);
const runDir = path.join(monitoringDir, '.run');
const installDir = path.join(runDir, 'grafana');
const unpackDir = path.join(runDir, 'grafana-unpack');
const provisioningDir = path.join(runDir, 'grafana-provisioning');
const archivePath = path.join(runDir, ARCHIVE);
const exePath = path.join(installDir, 'bin', 'grafana.exe');
const iniPath = path.join(runDir, 'grafana.ini');
const logPath = path.join(runDir, 'grafana.log');
const pidPath = path.join(runDir, 'grafana.pid');

const startedAt = Date.now();
const elapsed = () => ((Date.now() - startedAt) / 1000).toFixed(1);
const say = (message) => console.log(`[${elapsed()}s] ${message}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fail(message) {
  console.error(`grafana: ${message}`);
  process.exit(1);
}

if (process.platform !== 'win32') {
  fail('this script starts the Windows build of Grafana; run it on Windows');
}

/** True when something is listening on the port, so start would collide with it. */
function portAnswers(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    const done = (answer) => {
      socket.destroy();
      resolve(answer);
    };
    socket.setTimeout(2000, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** Downloads the zip, hashing as it writes, and keeps it only if the hash and size match. */
async function download() {
  say(`Downloading ${ARCHIVE} (${Math.round(ARCHIVE_BYTES / 1e6)} MB) from dl.grafana.com`);
  const res = await fetch(ARCHIVE_URL);
  if (!res.ok) fail(`the download answered ${res.status}`);
  const total = Number(res.headers.get('content-length') || ARCHIVE_BYTES);
  const partial = `${archivePath}.part`;
  const hash = crypto.createHash('sha256');
  const out = fs.createWriteStream(partial);
  // One error listener for the whole download; a listener per drain wait trips Node's warning.
  let writeError = null;
  out.on('error', (err) => {
    writeError = err;
  });
  let seen = 0;
  let printed = 0;
  try {
    for await (const chunk of res.body) {
      hash.update(chunk);
      seen += chunk.length;
      if (!out.write(chunk)) {
        await new Promise((resolve) => out.once('drain', resolve));
      }
      if (writeError) throw writeError;
      if (seen - printed >= 100_000_000) {
        printed = seen;
        say(`downloaded ${Math.round(seen / 1e6)} of ${Math.round(total / 1e6)} MB`);
      }
    }
  } finally {
    await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
  }
  const actual = hash.digest('hex');
  if (actual !== ARCHIVE_SHA256) {
    fs.rmSync(partial, { force: true });
    fail(`SHA-256 mismatch for ${ARCHIVE}\nexpected ${ARCHIVE_SHA256}\nactual   ${actual}`);
  }
  if (seen !== ARCHIVE_BYTES) {
    fs.rmSync(partial, { force: true });
    fail(`${ARCHIVE} is ${seen} bytes, expected ${ARCHIVE_BYTES}`);
  }
  fs.renameSync(partial, archivePath);
  say(`Downloaded ${ARCHIVE}: ${seen} bytes, SHA-256 ${actual}`);
}

/** Unpacks the zip with a tool Windows already has: bsdtar (tar.exe), else PowerShell. */
function unpack() {
  fs.rmSync(unpackDir, { recursive: true, force: true });
  fs.mkdirSync(unpackDir, { recursive: true });
  say('Unpacking');
  const tar = spawnSync('tar.exe', ['-xf', path.basename(archivePath), '-C', unpackDir], {
    cwd: path.dirname(archivePath),
    encoding: 'utf8',
    windowsHide: true,
  });
  if (tar.status === 0 && fs.existsSync(path.join(unpackDir, 'grafana-' + VERSION))) return;
  const ps = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Expand-Archive -LiteralPath '${archivePath}' -DestinationPath '${unpackDir}' -Force`,
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  if (ps.status !== 0) {
    fail(`could not unpack ${ARCHIVE}: ${(tar.stderr || '').trim()} ${(ps.stderr || '').trim()}`);
  }
}

/** Moves the one folder inside the zip to monitoring/.run/grafana. */
function place() {
  const inner = fs
    .readdirSync(unpackDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(unpackDir, entry.name))
    .find((dir) => fs.existsSync(path.join(dir, 'bin', 'grafana.exe')));
  if (!inner) fail(`the unpacked zip has no bin/grafana.exe`);
  fs.rmSync(installDir, { recursive: true, force: true });
  fs.renameSync(inner, installDir);
  fs.rmSync(unpackDir, { recursive: true, force: true });
}

/** Writes the settings, from grafana.ini.template, with this machine's paths filled in. */
function writeSettingFiles() {
  const asPosix = (p) => p.split(path.sep).join('/');
  // The provisioning tree is copied into monitoring/.run so the dashboard provider can be given
  // one absolute path; the versioned files beside this script stay the source of truth.
  fs.rmSync(provisioningDir, { recursive: true, force: true });
  fs.cpSync(path.join(here, 'provisioning'), provisioningDir, { recursive: true });
  // Grafana always reads these two optional folders; give it empty ones so its log stays clean.
  fs.mkdirSync(path.join(provisioningDir, 'alerting'), { recursive: true });
  fs.mkdirSync(path.join(provisioningDir, 'plugins'), { recursive: true });
  const providerPath = path.join(provisioningDir, 'dashboards', 'dashboards.yml');
  fs.writeFileSync(
    providerPath,
    fs
      .readFileSync(providerPath, 'utf8')
      .replaceAll('{{DASHBOARDS}}', asPosix(path.join(provisioningDir, 'dashboards', 'json'))),
  );
  const template = fs.readFileSync(path.join(here, 'grafana.ini.template'), 'utf8');
  const ini = template
    .replaceAll('{{DATA}}', asPosix(path.join(runDir, 'grafana-data')))
    .replaceAll('{{LOGS}}', asPosix(path.join(runDir, 'grafana-logs')))
    .replaceAll('{{PLUGINS}}', asPosix(path.join(runDir, 'grafana-data', 'plugins')))
    .replaceAll('{{PROVISIONING}}', asPosix(provisioningDir));
  fs.mkdirSync(path.join(runDir, 'grafana-data'), { recursive: true });
  fs.mkdirSync(path.join(runDir, 'grafana-logs'), { recursive: true });
  fs.writeFileSync(iniPath, ini);
  say(`Wrote ${path.relative(process.cwd(), iniPath) || iniPath} and the provisioning files beside it`);
}

async function waitForReady() {
  const deadline = Date.now() + 180_000;
  let last = 'not answering yet';
  while (Date.now() < deadline) {
    try {
      const health = await fetch(`http://localhost:${PORT}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (health.ok) {
        // Anonymous viewing: the dashboard page must answer without a login redirect, and the
        // provisioned dashboard must already exist.
        const page = await fetch(`http://localhost:${PORT}/d/${DASHBOARD_UID}/`, {
          redirect: 'manual',
          signal: AbortSignal.timeout(5000),
        });
        if (page.status !== 200) {
          last = `the dashboard page answered ${page.status}`;
        } else {
          const dashboard = await fetch(`http://localhost:${PORT}/api/dashboards/uid/${DASHBOARD_UID}`, {
            signal: AbortSignal.timeout(5000),
          });
          if (dashboard.ok) return;
          last = `the dashboard API answered ${dashboard.status} (is the JSON valid?)`;
        }
      } else {
        last = `/api/health answered ${health.status}`;
      }
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    await sleep(500);
  }
  const lines = fs.existsSync(logPath)
    ? fs.readFileSync(logPath, 'utf8').split(/\r?\n/).filter(Boolean).slice(-20)
    : ['(no log)'];
  fail(`Grafana did not become ready within 180 seconds (${last}). Last lines of ${logPath}:\n${lines.join('\n')}`);
}

// 1. The port must be free before anything is downloaded.
if (await portAnswers(PORT)) {
  fail(`Port ${PORT} is already in use. Stop that first: node monitoring/grafana/stop.mjs`);
}

// 2. The download, once. A zip already in monitoring/.run is reused only if its hash is right.
fs.mkdirSync(runDir, { recursive: true });
if (fs.existsSync(exePath) && fs.existsSync(archivePath)) {
  if (sha256(archivePath) !== ARCHIVE_SHA256) {
    fs.rmSync(archivePath, { force: true });
    fs.rmSync(installDir, { recursive: true, force: true });
  }
}
if (!fs.existsSync(exePath)) {
  if (!fs.existsSync(archivePath) || sha256(archivePath) !== ARCHIVE_SHA256) {
    await download();
  }
  unpack();
  place();
} else {
  say(`Using the Grafana already unpacked in ${path.relative(process.cwd(), installDir)}`);
}

// 3. Settings, then start as a process that outlives this script.
writeSettingFiles();
const out = fs.openSync(logPath, 'a');
const child = spawn(exePath, ['server', '--homepath', installDir, '--config', iniPath], {
  detached: true,
  stdio: ['ignore', out, out],
  windowsHide: true,
  cwd: installDir,
});
child.unref();
fs.writeFileSync(pidPath, String(child.pid));
say(`Grafana process ${child.pid} started; waiting for http://localhost:${PORT}`);

// 4. Ready when the page and the dashboard answer.
await waitForReady();

// The panels need Prometheus; say so plainly instead of leaving an empty dashboard unexplained.
let prometheus = 'not answering';
try {
  const res = await fetch(`${PROMETHEUS_URL}/-/ready`, { signal: AbortSignal.timeout(2000) });
  if (res.status === 200) prometheus = 'ready';
} catch {
  // leave the message
}
if (prometheus !== 'ready') {
  say(`Prometheus is ${prometheus} at ${PROMETHEUS_URL}: start it with node monitoring/start.mjs`);
}

const kiosk = `http://localhost:${PORT}/d/${DASHBOARD_UID}/card-and-transfers?kiosk`;
console.log(`Grafana ready at http://localhost:${PORT} in ${elapsed()}s`);
console.log(`Dashboard without menus (kiosk): ${kiosk}`);
console.log(`Stop it with: node monitoring/grafana/stop.mjs`);
process.exit(0);
