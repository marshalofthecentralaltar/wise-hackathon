// One whole case for the test runs, from the reset to the result, with every outside call behind
// a dependency so the order and the pass rules run in tests. scripts/full-run.ts gives it the real
// ones. Not part of the tool's own path: the tool never imports this.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { WebClient } from '@slack/web-api';
import type { AutoApproveOutcome, ThreadMessage } from './autoApprove.js';
import type { MonitoringFinding, Page, RunTimings } from './types.js';

export type Problem = 'flicker' | 'amount';
export type Via = 'slack' | 'direct';

const FIXTURE_PROBLEM: Record<Problem, string> = { flicker: 'card-picture-flicker', amount: 'transfers-amount-wrong' };
/** The page each problem is on: what the starting-state check asks monitoring about. */
export const PROBLEM_PAGE: Record<Problem, Page> = { flicker: 'card', amount: 'transfers' };
const FIXTURES_PATH = fileURLToPath(new URL('../../fixtures/reports.json', import.meta.url));

/** The first three English fixture reports of a problem. None says it is a test. */
export function pickReports(problem: Problem, path = FIXTURES_PATH): string[] {
  const fixtures = JSON.parse(readFileSync(path, 'utf8')) as { text: string; lang: string; problem: string | null }[];
  const texts = fixtures.filter((f) => f.problem === FIXTURE_PROBLEM[problem] && f.lang === 'en' && !/\btest/i.test(f.text)).map((f) => f.text);
  if (texts.length < 3) throw new Error(`only ${texts.length} English fixture reports for ${FIXTURE_PROBLEM[problem]}`);
  return texts.slice(0, 3);
}

/** Posts the reports as top-level messages, gapSeconds apart. Returns each ts, in order. */
export async function postReports(
  client: WebClient,
  channel: string,
  texts: string[],
  opts: { gapSeconds: number; afterEach?: (ts: string, text: string, index: number) => void },
): Promise<string[]> {
  const out: string[] = [];
  for (const [i, text] of texts.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, opts.gapSeconds * 1000));
    const r = await client.chat.postMessage({ channel, text });
    const ts = String(r.ts ?? '');
    out.push(ts);
    opts.afterEach?.(ts, text, i);
  }
  return out;
}

export interface ParsedHandoff {
  ts: string;
  severity: 'low' | 'high' | null;
  /** Short sha named in the origin part. */
  commit: string | null;
  prUrl: string | null;
  kind: 'fix' | 'undo' | 'none';
  monitoring: string;
}

const blockText = (m: ThreadMessage, id: string): string | null => {
  const b = (m.blocks ?? []).find((x) => x.block_id === id) as { text?: { text?: string } } | undefined;
  return b?.text?.text ?? null;
};

/** The handoff in a thread (the message with the `handoff_problem` block), read from its blocks. */
export function readHandoff(messages: ThreadMessage[]): ParsedHandoff | null {
  const m = messages.find((x) => blockText(x, 'handoff_problem') !== null);
  if (!m?.ts) return null;
  const problem = blockText(m, 'handoff_problem') ?? '';
  const origin = blockText(m, 'handoff_origin') ?? '';
  const fix = blockText(m, 'handoff_fix');
  const severity = /\*Severity: (low|high)\.\*/.exec(problem)?.[1] as 'low' | 'high' | undefined;
  const commit = /commit `([0-9a-f]{7,40})`/.exec(origin)?.[1] ?? null;
  const prUrl = fix ? (/<(https:\/\/github\.com\/[^|>]+\/pull\/\d+)\|/.exec(fix)?.[1] ?? null) : null;
  const kind = !fix ? 'none' : /undoes the commit/.test(fix) ? 'undo' : 'fix';
  return { ts: m.ts, severity: severity ?? null, commit, prUrl, kind, monitoring: blockText(m, 'handoff_monitoring') ?? '' };
}

export interface RepoSnapshot {
  branches: string[];
  /** Highest pull request number in any state; 0 when there is none. */
  maxPull: number;
}

export interface FullRunDeps {
  problem: Problem;
  via: Via;
  approve: boolean;
  appUrl: string;
  /** The URL the tool itself reads monitoring from (APP_BASE_URL). */
  toolAppUrl: string;
  ownBot: { userId: string; botId: string };
  reset(): Promise<{ ok: boolean; reason: string }>;
  openToolPulls(): Promise<number[]>;
  appAnswers(url: string): Promise<boolean>;
  browserCheck(expect: 'replaced' | 'stable'): Promise<{ pass: boolean; output: string }>;
  snapshot(): Promise<RepoSnapshot>;
  /** Step 3 of the tool (checkMonitoring) for the problem's page, read before any report is posted. */
  monitoring(page: Page): Promise<MonitoringFinding>;
  /** Stop before posting when the starting-state monitoring did not come from Prometheus. */
  requirePrometheus?: boolean;
  /** false (--no-deploy-check): after a merge, the redeployed page is not checked, and the line says so. Default true. */
  deployCheck?: boolean;
  /**
   * --via direct: starts the tool in-process. --via slack: starts the tool as its own process and
   * resolves with its log file (or nothing when someone else runs it). Rejects when it did not start.
   */
  startTool(): Promise<{ log: string; pid: number } | void>;
  /** Posts the three reports; resolves with their ts in order. */
  post(): Promise<string[]>;
  readThread(threadTs: string): Promise<ThreadMessage[]>;
  permalink(ts: string): Promise<string>;
  approveFromThread(threadTs: string): Promise<AutoApproveOutcome>;
  pullMerged(prUrl: string): Promise<boolean>;
  /** After a merge: waits for the deployment to carry main; null when there is no deployment file. */
  waitDeployed(): Promise<{ ok: boolean; note: string } | null>;
  /** The tool's RunTimings line for the first group that started at or after this time. */
  timingsSince(iso: string): Promise<RunTimings | null>;
  sleep(ms: number): Promise<void>;
  /** Milliseconds, monotonic. */
  now(): number;
  log(line: string): void;
  handoffWaitMs?: number;
  mergeWaitMs?: number;
}

export interface FullRunLine {
  problem: Problem;
  via: Via;
  approve: boolean;
  startedAt: string;
  thread: string | null;
  commit: string | null;
  severity: 'low' | 'high' | null;
  kind: 'fix' | 'undo' | 'none' | null;
  prUrl: string | null;
  merged: boolean | null;
  seconds: { firstToolMessage: number | null; handoff: number | null; approvalToMerged: number | null; mergedToStable: number | null };
  timings: RunTimings | null;
  monitoring: string | null;
  /** Where the starting-state monitoring came from (step 3's source); null when it was not read. */
  monitoringSource: MonitoringFinding['source'] | null;
  /** After a merge: 'checked' when the browser check ran on the redeployed page; otherwise why not. */
  pageCheck: string | null;
  /** The log file of the tool this run started as its own process (--via slack); null otherwise. */
  toolLog: string | null;
  toolPid: number | null;
  /** Set by the script after it stopped that tool's process tree: true when the pid is gone. */
  toolStopped: boolean | null;
  /** A reply in the thread that is not from the tool's bot (for example the old thin listener). */
  strangerReplies: string[];
  ok: boolean;
  /** Plain reasons the run is not ok; empty when it is. */
  failed: string[];
  /** Set when the run stopped before posting any report. */
  stoppedBefore: 'reset' | 'starting-state' | null;
}

const secs = (ms: number) => Math.round(ms / 100) / 10;
/** Seconds between two Slack ts values (Slack's own clock). */
const tsGap = (from: string, to: string) => Math.round((Number(to) - Number(from)) * 10) / 10;

export async function runFullCase(d: FullRunDeps): Promise<FullRunLine> {
  const line: FullRunLine = {
    problem: d.problem,
    via: d.via,
    approve: d.approve,
    startedAt: new Date().toISOString(),
    thread: null,
    commit: null,
    severity: null,
    kind: null,
    prUrl: null,
    merged: null,
    seconds: { firstToolMessage: null, handoff: null, approvalToMerged: null, mergedToStable: null },
    timings: null,
    monitoring: null,
    monitoringSource: null,
    pageCheck: null,
    toolLog: null,
    toolPid: null,
    toolStopped: null,
    strangerReplies: [],
    ok: false,
    failed: [],
    stoppedBefore: null,
  };
  const fail = (reason: string) => {
    line.failed.push(reason);
    d.log(`full-run: ${reason}`);
  };

  // 1. The complete reset.
  const reset = await d.reset();
  if (!reset.ok) {
    fail(`the reset did not finish cleanly: ${reset.reason}`);
    line.stoppedBefore = 'reset';
    return line;
  }

  // 2. The starting state: nothing left over from an earlier run, and a product the tool can read.
  const open = await d.openToolPulls();
  if (open.length) fail(`the tool still has open pull requests: ${open.map((n) => `#${n}`).join(', ')}`);
  if (!(await d.appAnswers(d.toolAppUrl))) fail(`the card app does not answer at ${d.toolAppUrl} (APP_BASE_URL): the tool could not read monitoring and would judge every problem high`);
  if (d.problem === 'flicker') {
    if (d.appUrl.replace(/\/$/, '') !== d.toolAppUrl.replace(/\/$/, '')) fail(`the browser check reads ${d.appUrl} but the tool reads ${d.toolAppUrl} (APP_BASE_URL); they must be the same app`);
    const check = await d.browserCheck('replaced');
    if (!check.pass) fail(`the card page at ${d.appUrl} does not flicker before the run (browser check --expect replaced failed: ${check.output.trim().slice(0, 200)})`);
  }
  // Monitoring, read the way the tool will read it in step 3.
  const page = PROBLEM_PAGE[d.problem];
  let finding: MonitoringFinding | null = null;
  try {
    finding = await d.monitoring(page);
  } catch (err) {
    fail(`monitoring for the ${page} page could not be read before the run: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (finding) {
    line.monitoringSource = finding.source;
    if (finding.unavailable) fail(`monitoring for the ${page} page could not be read before the run (the tool would judge the problem high): ${finding.summary}`);
    else if (finding.showsProblem) fail(`monitoring already shows a problem on the ${page} page before the run: ${finding.summary}`);
    if (d.requirePrometheus && finding.source !== 'prometheus') fail(`monitoring came from ${finding.source}, not prometheus (--require-prometheus): ${finding.summary}`);
  }
  if (line.failed.length) {
    line.stoppedBefore = 'starting-state';
    return finish();
  }
  const before = await d.snapshot();

  // 3. The reports.
  try {
    const started = await d.startTool();
    if (started) {
      line.toolLog = started.log;
      line.toolPid = started.pid;
    }
  } catch (err) {
    fail(`the tool did not start: ${err instanceof Error ? err.message : String(err)}`);
    return finish();
  }
  const startedIso = new Date().toISOString();
  const posted = await d.post();
  const firstTs = posted[0]!;

  // 4. The thread: the tool answers under one of the reports (the first, normally).
  const isTool = (m: ThreadMessage) => m.user === d.ownBot.userId || (!!m.bot_id && m.bot_id === d.ownBot.botId);
  const t0 = d.now();
  const limit = d.handoffWaitMs ?? 180_000;
  let threadTs: string | null = null;
  let messages: ThreadMessage[] = [];
  for (let round = 0; d.now() - t0 < limit; round++) {
    const candidates: string[] = threadTs ? [threadTs] : round % 5 === 0 ? posted : [firstTs];
    for (const ts of candidates as string[]) {
      const msgs = await d.readThread(ts);
      if (msgs.some((m) => m.ts !== ts && isTool(m))) {
        threadTs = ts;
        messages = msgs;
      }
    }
    if (threadTs && readHandoff(messages)) break;
    await d.sleep(2000);
  }
  if (!threadTs) {
    fail(`no message from the tool in any report's thread within ${secs(limit)} s`);
    return finish();
  }
  line.thread = await d.permalink(threadTs).catch(() => threadTs);
  const replies = messages.filter((m) => m.ts !== threadTs);
  const firstTool = replies.find(isTool);
  if (firstTool?.ts) line.seconds.firstToolMessage = tsGap(firstTs, firstTool.ts);
  line.strangerReplies = replies.filter((m) => !isTool(m)).map((m) => (m.text ?? '').slice(0, 120));
  if (line.strangerReplies.length) fail(`someone other than the tool replied in the thread: ${JSON.stringify(line.strangerReplies)}`);

  const handoff = readHandoff(messages);
  if (!handoff) {
    fail(`no handoff in the thread within ${secs(limit)} s`);
    return finish();
  }
  line.seconds.handoff = tsGap(firstTs, handoff.ts);
  line.commit = handoff.commit;
  line.severity = handoff.severity;
  line.kind = handoff.kind;
  line.prUrl = handoff.prUrl;
  line.monitoring = handoff.monitoring;

  // 5. The approval, the merge, the page.
  if (d.approve && handoff.prUrl) {
    const ta = d.now();
    const pressed = await d.approveFromThread(threadTs);
    if (!pressed.pressed) {
      fail(`approval refused: ${pressed.refused}`);
    } else {
      if (pressed.result !== 'merged') fail(`the press handler answered ${pressed.result}`);
      const mergeLimit = d.mergeWaitMs ?? 120_000;
      line.merged = false;
      while (d.now() - ta < mergeLimit) {
        if (await d.pullMerged(handoff.prUrl)) {
          line.merged = true;
          break;
        }
        await d.sleep(2000);
      }
      if (line.merged) {
        const tm = d.now();
        line.seconds.approvalToMerged = secs(tm - ta);
        if (d.deployCheck === false) {
          line.pageCheck = 'not checked: --no-deploy-check';
        } else {
          const deployed = await d.waitDeployed();
          if (!deployed) {
            line.pageCheck = 'not checked: no deployment file';
            fail('the redeployed page was not checked: no deployment file');
          } else if (!deployed.ok) {
            line.pageCheck = 'not checked: the deployment did not reach the merge';
            fail(`the deployment did not reach the merge: ${deployed.note}`);
          } else {
            const stable = await d.browserCheck('stable');
            line.pageCheck = 'checked';
            if (stable.pass) line.seconds.mergedToStable = secs(d.now() - tm);
            else fail(`the card page still flickers after the merge was deployed: ${stable.output.trim().slice(0, 200)}`);
          }
        }
      } else fail(`GitHub does not show ${handoff.prUrl} merged within ${secs(mergeLimit)} s`);
    }
  }

  line.timings = await d.timingsSince(startedIso);
  if (!line.timings) fail('no RunTimings line for this run in tool/.state/timings.jsonl');

  // 6. What the case requires.
  if (d.problem === 'flicker') {
    if (line.severity !== 'low') fail(`severity is ${line.severity ?? 'missing'}, the flicker case needs low`);
    if (!line.prUrl) fail('the handoff has no pull request link');
    if (d.approve && line.prUrl && line.merged !== true) fail('the pull request is not merged');
  } else {
    if (line.severity !== 'high') fail(`severity is ${line.severity ?? 'missing'}, the wrong-amount case needs high`);
    if (line.prUrl) fail(`the handoff links a pull request (${line.prUrl}); a high problem gets none`);
    const after = await d.snapshot();
    const newBranches = after.branches.filter((b) => !before.branches.includes(b));
    if (newBranches.length) fail(`new branches on GitHub: ${newBranches.join(', ')}`);
    if (after.maxPull > before.maxPull) fail(`a new pull request on GitHub: #${after.maxPull}`);
  }
  return finish();

  function finish(): FullRunLine {
    line.ok = line.failed.length === 0;
    return line;
  }
}
