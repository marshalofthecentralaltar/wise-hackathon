// npm run doctor [-- --offline]: whether this machine can run the demo. See src/doctor.ts.
// Reads the secrets file itself (lengths only); creates an empty template when it is missing.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { connect, createServer } from 'node:net';
import { WebClient } from '@slack/web-api';
import { config } from '../src/config.js';
import { ensureDeps, unlinkDeps } from '../src/deps.js';
import { exitCodeFor, formatItems, runDoctor, type DoctorDeps } from '../src/doctor.js';
import { paths } from '../src/paths.js';
import { parseSecrets } from '../src/secrets.js';
import { askClaude, spawnTool } from '../src/steps/exec.js';
import { findOwner, slackLookup } from '../src/steps/owner.js';
import { freshCopy } from '../src/workspace.js';

const offline = process.argv.includes('--offline');

function listenOk(port: number, host?: string): Promise<boolean> {
  return new Promise((resolve) => {
    const s = createServer();
    s.once('error', () => resolve(false));
    s.listen({ port, host, exclusive: true }, () => s.close(() => resolve(true)));
  });
}

function connects(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = connect({ port, host });
    const done = (v: boolean) => (sock.destroy(), resolve(v));
    sock.setTimeout(1000, () => done(false));
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
  });
}

const deps: DoctorDeps = {
  nodeVersion: process.versions.node,
  platform: process.platform,
  env: process.env,
  secretsFile: paths.secretsFile,
  run: (cmd, args, timeoutMs) => spawnTool(cmd, args, { timeoutMs }),
  askClaude: (timeoutMs) => askClaude('Reply with the single word OK.', 'You answer with one word.', config.groupingModel, timeoutMs),
  launchBrowser: () =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [`${paths.checksDir}/browser-ok.mjs`], { cwd: paths.checksDir, windowsHide: true });
      let out = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (out += d));
      const timer = setTimeout(() => child.kill(), 60_000);
      child.on('error', (err) => (clearTimeout(timer), resolve({ ok: false, detail: String(err) })));
      child.on('close', (code) => {
        clearTimeout(timer);
        const last = out.trim().split(/\r?\n/).at(-1) ?? '';
        try {
          const j = JSON.parse(last) as { browser?: string; error?: string };
          resolve({ ok: code === 0, detail: j.browser ? `started, version ${j.browser}` : (j.error ?? last) });
        } catch {
          resolve({ ok: false, detail: last || `exit ${code}` });
        }
      });
    }),
  fileExists: existsSync,
  readFile: (p) => readFileSync(p, 'utf8'),
  createFile: (p, text) => writeFileSync(p, text, { flag: 'wx' }),
  slackAuthTest: async (token) => {
    try {
      const a = await new WebClient(token).auth.test();
      return { ok: a.ok === true, team: a.team, user: a.user, userId: a.user_id };
    } catch (err) {
      const data = (err as { data?: { error?: string } }).data;
      return { ok: false, error: data?.error ?? (err instanceof Error ? err.message : String(err)) };
    }
  },
  slackChannelId: async (token, name) => {
    const client = new WebClient(token);
    let cursor: string | undefined;
    do {
      const page = await client.conversations.list({ types: 'public_channel', exclude_archived: true, limit: 200, cursor });
      const hit = page.channels?.find((c) => c.name === name);
      if (hit?.id) return hit.id;
      cursor = page.response_metadata?.next_cursor || undefined;
    } while (cursor);
    return null;
  },
  cardOwner: async (token) => {
    const o = await findOwner('card', { lookupSlackUser: slackLookup(token) });
    return { githubLogin: o.githubLogin, slackUserId: o.slackUserId };
  },
  portFree: async (port) => {
    if ((await connects(port, '127.0.0.1')) || (await connects(port, '::1'))) return false;
    return listenOk(port);
  },
  warmFixDeps: async () => {
    // The same warm-up startTool runs: a fresh copy of the card app, its dependencies, then clean up.
    const copy = await freshCopy(config.repos[0]!);
    try {
      const d = await ensureDeps(copy.dir);
      await unlinkDeps(copy.dir);
      return { cold: d.cold, seconds: d.seconds };
    } finally {
      await copy.remove();
    }
  },
};

console.log(`Doctor for ${paths.repoDir} (build folder ${paths.buildDir})${offline ? ', offline: network and login items skipped' : ''}`);
const { items, tokens } = await runDoctor(deps, { offline, parseSecrets });
console.log(formatItems(items, tokens));
process.exit(exitCodeFor(items));
