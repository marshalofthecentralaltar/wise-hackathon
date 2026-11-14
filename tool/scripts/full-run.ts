// One whole case, timed: the complete reset, the starting-state check, the three reports, the
// handoff in the thread, and with --approve the unattended approval, the merge and the page.
// Prints one JSON line on stdout (progress on stderr); exit 0 only when the line says ok.
// Run from tool/:
//   npx tsx --import ./src/loadSecrets.ts scripts/full-run.ts \
//     --problem flicker|amount --via slack|direct [--approve] [--app-url http://localhost:3000] [--gap-seconds 3]
//     [--tool own|external] [--require-prometheus] [--no-deploy-check]
// --via slack  : posts as "Support Desk" (SLACK_TEST_BOT_TOKEN). After the reset and the
//                starting-state check it starts the tool as its own process (what `npm run tool`
//                runs), waits for its "Listening in" line (60 s), and stops its process tree at the
//                end, also on failure; its log path is `toolLog` in the line. --tool external: someone
//                else runs `npm run tool` (it notices the reset's deleted state file).
// --require-prometheus: stop before posting when the starting-state monitoring is not from Prometheus.
// --no-deploy-check: after a merge, do not wait for the deployment and do not check the page (the
//                line says so in `pageCheck`). Without it a missing deployment file fails the run.
// --via direct : the FALLBACK without the second Slack app. Starts the tool in this process
//                without a Slack connection, posts the reports with the tool's own bot (which the
//                listener ignores by design) and hands each one to the listener's handler as a
//                message whose sender is not the bot. Everything after that filter is the code
//                path of a typed message.
// The browser check is CHECK_FLICKER (default tool/checks/check-flicker.mjs, see src/paths.ts).
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebClient } from '@slack/web-api';
import { approveFromThread, slackThreadReader } from '../src/autoApprove.js';
import { approveWithProof, settleProofs } from '../src/browserProof.js';
import { config } from '../src/config.js';
import { makeRunEvents } from '../src/events.js';
import { pickReports, runFullCase, type FullRunDeps, type Problem, type Via } from '../src/fullRun.js';
import { DEFAULT_TIMINGS_PATH } from '../src/pipeline.js';
import { CARD_APP_REPO, DEFAULT_DEPLOY_DIR, isToolBranchName, resetTool, waitForDeployment } from '../src/reset.js';
import { webSlackPort } from '../src/slackPost.js';
import { startTool, type RunningTool } from '../src/startTool.js';
import { ghApi, spawnTool } from '../src/steps/exec.js';
import { checkMonitoring } from '../src/steps/monitoring.js';
import { ARTIFACTS_DIR, fileStamp, isAlive, startToolProcess, stopTree, type Started } from './lib/procs.js';
import { readRecord } from './lib/demo.js';
import { join } from 'node:path';
import type { RunTimings } from '../src/types.js';
import { paths } from '../src/paths.js';
import { SECRETS_FILE, emptyTestTokenMessage } from './lib/secretsLine.js';

const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const problem = arg('problem') as Problem;
const via = arg('via') as Via;
const approve = process.argv.includes('--approve');
const appUrl = (arg('app-url', config.appBaseUrl) ?? '').replace(/\/$/, '');
const gapSeconds = Number(arg('gap-seconds', '3'));
const toolMode = arg('tool', 'own');
const requirePrometheus = process.argv.includes('--require-prometheus');
const deployCheck = !process.argv.includes('--no-deploy-check');
if ((problem !== 'flicker' && problem !== 'amount') || (via !== 'slack' && via !== 'direct') || (toolMode !== 'own' && toolMode !== 'external')) {
  console.error('usage: full-run.ts --problem flicker|amount --via slack|direct [--approve] [--app-url <url>] [--gap-seconds 3] [--tool own|external] [--require-prometheus] [--no-deploy-check]');
  process.exit(2);
}
const log = (s: string) => process.stderr.write(`${new Date().toISOString().slice(11, 19)} ${s}\n`);

const botToken = (process.env.SLACK_BOT_TOKEN ?? '').trim();
if (!botToken) {
  console.error('SLACK_BOT_TOKEN is empty in the env file');
  process.exit(2);
}
const testToken = (process.env.SLACK_TEST_BOT_TOKEN ?? '').trim();
if (via === 'slack' && !testToken) {
  console.error(`--via slack needs the second app. ${emptyTestTokenMessage(SECRETS_FILE)} Or run with --via direct (the fallback).`);
  process.exit(2);
}
const CHECK_FLICKER = paths.checkFlicker; // CHECK_FLICKER overrides (src/paths.ts)
if (problem === 'flicker' && !existsSync(CHECK_FLICKER)) {
  console.error(`the browser check is not at ${CHECK_FLICKER} (set CHECK_FLICKER)`);
  process.exit(2);
}
const repo = CARD_APP_REPO;
const channel = (process.env.SUPPORT_CHANNEL_ID ?? '').trim() || 'C0CHF22D9AR';
const botClient = new WebClient(botToken);
const auth = await botClient.auth.test();
const ownBot = { userId: auth.user_id ?? '', botId: auth.bot_id ?? '' };
const readThread = slackThreadReader(botClient);
const slack = webSlackPort(botClient);
/** The approval this script makes writes its steps to the same events file as the tool. */
const events = makeRunEvents();
/** The sender of the fallback's events: anyone but the tool's bot. */
const DIRECT_SENDER = 'U0SUPPORTDESK';

let tool: RunningTool | undefined;
/** The tool this run started as its own process (--via slack --tool own). */
let toolProcess: Started | undefined;

function browserCheck(expect: 'replaced' | 'stable'): Promise<{ pass: boolean; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CHECK_FLICKER, '--expect', expect], {
      cwd: dirname(CHECK_FLICKER),
      env: { ...process.env, BASE_URL: appUrl },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (b) => (out += String(b)));
    child.stderr.on('data', (b) => (out += String(b)));
    const timer = setTimeout(() => child.kill(), 90_000);
    child.on('close', (code) => {
      clearTimeout(timer);
      log(`browser check --expect ${expect}: exit ${code} ${out.trim().split('\n').at(-1) ?? ''}`);
      resolve({ pass: code === 0, output: out });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ pass: false, output: String(err) });
    });
  });
}

async function appAnswers(url: string): Promise<boolean> {
  try {
    const r = await fetch(`${url.replace(/\/$/, '')}/metrics`, { signal: AbortSignal.timeout(5000) });
    return r.ok;
  } catch {
    return false;
  }
}

async function pullsAll(): Promise<{ number: number; state: string; head: { ref: string } }[]> {
  return ghApi(`repos/${repo}/pulls?state=all&per_page=100&sort=created&direction=desc`);
}

const deps: FullRunDeps = {
  problem,
  via,
  approve,
  appUrl,
  toolAppUrl: config.appBaseUrl.replace(/\/$/, ''),
  ownBot,
  async reset() {
    const r = await resetTool();
    log(`reset: closed ${JSON.stringify(r.closedPullRequests)}, deleted ${JSON.stringify(r.deletedBranches)}, restore ${r.restore.status} (${r.restore.reason})${r.restore.deploy ? `, deploy: ${r.restore.deploy.note}` : ''}`);
    const ok = r.errors.length === 0 && (r.restore.status === 'restored' || r.restore.status === 'not-needed');
    return { ok, reason: ok ? r.restore.reason : [...r.errors, r.restore.reason].join('; ') };
  },
  async openToolPulls() {
    const open = await ghApi<{ number: number; head: { ref: string } }[]>(`repos/${repo}/pulls?state=open&per_page=100`);
    return open.filter((p) => isToolBranchName(p.head.ref)).map((p) => p.number);
  },
  appAnswers,
  browserCheck,
  async snapshot() {
    const branches = await ghApi<{ name: string }[]>(`repos/${repo}/branches?per_page=100`);
    const pulls = await pullsAll();
    return { branches: branches.map((b) => b.name), maxPull: Math.max(0, ...pulls.map((p) => p.number)) };
  },
  monitoring: (page) => checkMonitoring(page),
  requirePrometheus,
  deployCheck,
  async startTool() {
    if (via === 'direct') {
      tool = await startTool({ listen: false, log: (m) => log(m), logError: (m) => log(m) });
      return;
    }
    if (toolMode === 'external') return;
    // Two tools on one Slack app split the events between them.
    const demoTool = readRecord()?.toolPid;
    if (demoTool && isAlive(demoTool)) throw new Error(`a tool started by demo-start --with-tool is running (pid ${demoTool}); run with --tool external, or start the demo without --with-tool`);
    const toolLog = join(ARTIFACTS_DIR, `tool-${fileStamp()}-${problem}.log`);
    log(`starting the tool as its own process; log ${toolLog}`);
    toolProcess = await startToolProcess({ log: toolLog });
    log(`the tool is listening (pid ${toolProcess.pid})`);
    return { log: toolProcess.log, pid: toolProcess.pid };
  },
  async post() {
    const texts = pickReports(problem);
    const handled: Promise<void>[] = [];
    const client = via === 'slack' ? new WebClient(testToken) : botClient;
    const out: string[] = [];
    for (const [i, text] of texts.entries()) {
      if (i > 0) await new Promise((r) => setTimeout(r, gapSeconds * 1000));
      const r = await client.chat.postMessage({ channel, text });
      const ts = String(r.ts ?? '');
      out.push(ts);
      log(`posted report ${i + 1} (${ts}) via ${via}`);
      // The fallback: the same event Slack would deliver for a message typed by someone else.
      if (tool) handled.push(tool.onMessage({ type: 'message', channel, user: DIRECT_SENDER, text, ts }));
    }
    // The handler never rejects; the pipeline itself runs in the tool's queue.
    void Promise.all(handled);
    return out;
  },
  readThread: (ts) => readThread(channel, ts),
  permalink: (ts) => slack.getPermalink(channel, ts),
  approveFromThread: (ts) => approveFromThread({ channel, threadTs: ts, read: readThread, slack, approve: approveWithProof({ slack, log, emit: events.emitBare }) }),
  async pullMerged(prUrl) {
    const n = /\/pull\/(\d+)/.exec(prUrl)?.[1] ?? '';
    const r = await spawnTool('gh', ['pr', 'view', n, '--repo', repo, '--json', 'state,mergedAt'], { timeoutMs: 60_000 });
    if (r.code !== 0) return false;
    return (JSON.parse(r.stdout) as { state: string }).state === 'MERGED';
  },
  async waitDeployed() {
    const head = (await ghApi<{ object: { sha: string } }>(`repos/${repo}/git/ref/heads/main`)).object.sha;
    const w = await waitForDeployment(head, { deployDir: DEFAULT_DEPLOY_DIR, waitMs: 180_000 });
    return w.waited ? { ok: w.ok, note: w.note } : null;
  },
  async timingsSince(iso) {
    for (let i = 0; i < 10; i++) {
      if (existsSync(DEFAULT_TIMINGS_PATH)) {
        const hit = readFileSync(DEFAULT_TIMINGS_PATH, 'utf8')
          .split(/\r?\n/)
          .filter(Boolean)
          .map((l) => JSON.parse(l) as RunTimings)
          .find((t) => t.startedAt >= iso);
        if (hit) return hit;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    return null;
  },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => performance.now(),
  log,
};

let code = 1;
let line: Awaited<ReturnType<typeof runFullCase>> | undefined;
try {
  line = await runFullCase(deps);
  code = line.ok ? 0 : 1;
} catch (err) {
  console.error(`full-run stopped: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
} finally {
  if (tool) {
    await tool.queue.idle();
    await tool.warmed;
    await tool.stop();
  }
  // The after-fix browser proof runs in the background in this process when this script approved.
  await settleProofs(90_000);
  await events.idle();
  if (toolProcess) {
    const gone = await stopTree(toolProcess.pid);
    log(`stopped the tool's process tree (pid ${toolProcess.pid}): ${gone ? 'gone' : 'STILL RUNNING'}`);
    if (line) {
      line.toolStopped = gone;
      if (!gone) {
        line.failed.push(`the tool's process ${toolProcess.pid} is still running after the stop`);
        line.ok = false;
        code = 1;
      }
    }
  }
}
if (line) console.log(JSON.stringify(line));
process.exit(code);
