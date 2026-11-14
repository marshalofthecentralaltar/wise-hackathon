// The browser proof. Monitoring never saw the customers' problems, so it cannot say they are fixed.
// The tool therefore opens the page in a real browser itself, with the checks in tool/checks/:
//
// 1. Reproduction: when the investigation starts, the page's check starts beside it (never
//    awaited by the investigation, never read by the verdict or the fix) and posts one line in
//    the thread with what it measured.
// 2. After the fix: when an approval ends in `merged`, a background loop waits for the redeploy,
//    runs the page's check until it passes its "fixed" expectation or 60 seconds pass, and posts
//    one line with the measurement.
//
// Everything here is additive. A browser that cannot start, a check that crashes or a missing
// check file never stops a run: it is said in one plain line or logged. BROWSER_PROOF=off
// switches the whole thing off; the wrapped steps are then the real ones, unchanged.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleApprovePress, parseApproveValue, type ApproveDeps, type ApprovePress, type ApproveResult } from './approve.js';
import { config } from './config.js';
import { esc } from './handoff.js';
import { paths } from './paths.js';
import { DEFAULT_DEPLOY_DIR, readDeployed } from './reset.js';
import type { SlackPort } from './slackPost.js';
import type { CodeSteps, Page, ReportGroup } from './types.js';

export type ProofStep = 'approval' | 'deploy' | 'proof' | 'reproduction';
export interface ProofEvent {
  groupId: string;
  step: ProofStep;
  state: 'start' | 'done' | 'failed';
  seconds?: number;
  evidence?: unknown;
  error?: string;
}
export type ProofEmit = (e: ProofEvent) => void;

export interface PageCheck {
  /** File name, for the evidence. */
  name: string;
  file: string;
  /** The --expect value that passes when the customers' problem is on the page. */
  reproduce: string;
  /** The --expect value that passes when the problem is gone. */
  fixed: string;
}

/** Which check measures which page. A page with no check gets no line. */
export const PAGE_CHECKS: Partial<Record<Page, PageCheck>> = {
  card: { name: 'check-flicker.mjs', file: paths.checkFlicker, reproduce: 'replaced', fixed: 'stable' },
  transfers: { name: 'check-amounts.mjs', file: `${paths.checksDir}/check-amounts.mjs`, reproduce: 'wrong', fixed: 'right' },
};

/** One run of a check. `ran` is false when it measured nothing (no browser, crash, missing file, timeout). */
export interface CheckRun {
  ran: boolean;
  pass: boolean;
  seconds: number;
  result: Record<string, unknown> | null;
  error?: string;
}
export type CheckRunner = (file: string, expect: string, baseUrl: string) => Promise<CheckRun>;

const CHECK_KILL_MS = 45_000;
const round1 = (ms: number) => Math.round(ms / 100) / 10;
const firstLine = (s: string) => (s.trim().split('\n')[0] ?? '').trim().slice(0, 160);

/** The real runner: `node <check> --expect <x>` with BASE_URL, its last stdout line read as JSON. */
export const realCheckRunner: CheckRunner = (file, expect, baseUrl) =>
  new Promise((resolve) => {
    const t0 = performance.now();
    const done = (r: Omit<CheckRun, 'seconds'>) => resolve({ ...r, seconds: round1(performance.now() - t0) });
    if (!existsSync(file)) return done({ ran: false, pass: false, result: null, error: `the check ${file} is missing` });
    let child;
    try {
      child = spawn(process.execPath, [file, '--expect', expect], {
        cwd: dirname(file),
        env: { ...process.env, BASE_URL: baseUrl },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (err) {
      return done({ ran: false, pass: false, result: null, error: String(err) });
    }
    let out = '';
    let errOut = '';
    child.stdout?.on('data', (b) => (out += String(b)));
    child.stderr?.on('data', (b) => (errOut += String(b)));
    const timer = setTimeout(() => child.kill(), CHECK_KILL_MS);
    child.on('error', (err) => {
      clearTimeout(timer);
      done({ ran: false, pass: false, result: null, error: String(err) });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const last = out.trim().split(/\r?\n/).at(-1) ?? '';
      let result: Record<string, unknown> | null = null;
      try {
        const parsed = JSON.parse(last) as unknown;
        if (parsed && typeof parsed === 'object') result = parsed as Record<string, unknown>;
      } catch {
        result = null;
      }
      if (!result) return done({ ran: false, pass: false, result: null, error: firstLine(errOut || out) || `the check exited ${code} without a result` });
      if (typeof result.error === 'string') return done({ ran: false, pass: false, result, error: firstLine(result.error) });
      done({ ran: true, pass: code === 0, result });
    });
  });

/** The runner, with a rejection turned into a run that measured nothing. */
async function runSafe(deps: { runCheck?: CheckRunner }, file: string, expect: string, baseUrl: string): Promise<CheckRun> {
  try {
    return await (deps.runCheck ?? realCheckRunner)(file, expect, baseUrl);
  } catch (err) {
    return { ran: false, pass: false, seconds: 0, result: null, error: firstLine(err instanceof Error ? err.message : String(err)) };
  }
}

/** What one reproduction left for the after-fix proof, possibly in another process (tool/.state). */
export interface ReproductionRecord {
  groupId: string;
  page: Page;
  channel: string;
  threadTs: string;
  check: string;
  startedAt: string;
  ran?: boolean;
  reproduced?: boolean;
  result?: Record<string, unknown> | null;
}

export const DEFAULT_REPRODUCTIONS_PATH = fileURLToPath(new URL('../.state/reproductions.json', import.meta.url));

export interface ProofDeps {
  slack: SlackPort;
  runCheck?: CheckRunner;
  emit?: ProofEmit;
  log?: (m: string) => void;
  /** Where reproductions are recorded. Default tool/.state/reproductions.json. */
  statePath?: string;
  /** The card app the checks open. Default APP_BASE_URL. */
  baseUrl?: string;
  /** The card app's deployment checkout, whose .deployed.json says a redeploy happened. */
  deployDir?: string;
  /** Wait for a fix to show, from the merge. Default 60 s. */
  proofWindowMs?: number;
  /** Pause between two checks or two looks at the deployment file. Default 2 s / 1 s. */
  retryMs?: number;
  pollMs?: number;
  /** false switches the browser proof off. Default: on unless BROWSER_PROOF=off. */
  enabled?: boolean;
  /** The approval handler; the real one when absent. */
  approve?: (press: ApprovePress, deps: ApproveDeps) => Promise<ApproveResult>;
}

export const proofEnabled = (deps: Pick<ProofDeps, 'enabled'>): boolean =>
  deps.enabled ?? (process.env.BROWSER_PROOF ?? '').trim().toLowerCase() !== 'off';

function logger(deps: ProofDeps) {
  return deps.log ?? ((m: string) => console.error(m));
}

/** Calls emit; a throwing emit is logged and changes nothing. */
function safeEmit(deps: ProofDeps, e: ProofEvent): void {
  try {
    deps.emit?.(e);
  } catch (err) {
    logger(deps)(`[proof] emit threw for ${e.step} ${e.state}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Background work started here, so a script can wait for it before it exits. */
const pending = new Set<Promise<void>>();
function track(p: Promise<void>, deps: ProofDeps, what: string): void {
  const guarded = p.catch((err) => logger(deps)(`[proof] ${what} failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`));
  pending.add(guarded);
  void guarded.finally(() => pending.delete(guarded));
}

/** Resolves when every reproduction and proof started in this process has ended, or after `maxMs`. Never rejects. */
export async function settleProofs(maxMs = 120_000): Promise<void> {
  if (!pending.size) return;
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([
    Promise.allSettled([...pending]),
    new Promise<void>((r) => {
      timer = setTimeout(r, maxMs);
    }),
  ]);
  if (timer) clearTimeout(timer);
}

function readRecords(path: string): Record<string, ReproductionRecord> {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, ReproductionRecord>;
  } catch {
    return {};
  }
}

const recordKey = (r: ReproductionRecord) => `${r.channel}/${r.threadTs}`;

async function saveRecord(path: string, rec: ReproductionRecord): Promise<void> {
  const all = readRecords(path);
  // Keyed by thread: group ids restart at group-1 with every tool process.
  all[recordKey(rec)] = rec;
  // Keep the file small: the newest 50 groups.
  const kept = Object.values(all)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, 50);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(Object.fromEntries(kept.map((r) => [recordKey(r), r])), null, 2), 'utf8');
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const times = (n: number) => (n === 1 ? 'once' : `${n} times`);
const money = (cents: number) => (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface DifferRow {
  row?: number | null;
  stored_cents?: number;
  shown?: string;
  note?: string;
}

function differences(result: Record<string, unknown>): string {
  const rows = Array.isArray(result.differ) ? (result.differ as DifferRow[]) : [];
  return rows
    .map((d) =>
      typeof d.row === 'number'
        ? `row ${d.row}: stored ${num(d.stored_cents) !== null ? money(d.stored_cents!) : '?'}, shown ${esc(String(d.shown ?? '').trim() || 'nothing')}`
        : esc(String(d.note ?? '')),
    )
    .filter(Boolean)
    .join('; ');
}

/** "the card picture was replaced 5 times in 5 seconds", from the check's own fields. */
function flickerMeasure(result: Record<string, unknown>): string {
  const n = num(result.card_picture_replacements);
  const s = num(result.seconds_watched);
  const replaced = result.card_picture_replaced === true;
  const span = s !== null ? ` in ${s} seconds` : '';
  if (n !== null) return n === 0 ? `the card picture was not replaced${span}` : `the card picture was replaced ${times(n)}${span}`;
  return replaced ? `the card picture was replaced${span}` : `the card picture was not replaced${span}`;
}

function amountsMeasure(result: Record<string, unknown>): string {
  const rows = num(result.rows) ?? 0;
  const k = num(result.rows_differ) ?? 0;
  if (k === 0) return `all ${rows} rows on the transfers page show the stored amount`;
  const verb = k === 1 ? 'shows an amount that differs' : 'show amounts that differ';
  return `${k} of ${rows} rows on the transfers page ${verb} from the stored one (${differences(result)})`;
}

/** The one thread line for a reproduction. Every number comes from the check's output. */
export function reproductionLine(page: Page, run: CheckRun): string {
  if (!run.ran || !run.result) return `Could not open the ${page} page in a browser to reproduce the reports: ${esc(run.error ?? 'the check gave no result')}.`;
  const r = run.result;
  if (page === 'card') {
    if (run.pass) return `Reproduced in a browser: ${flickerMeasure(r)}.`;
    const opacity = num(r.min_opacity_seen);
    const extra = [opacity !== null ? `lowest opacity seen ${opacity}` : '', r.balance_changed === true ? 'the balance changed' : 'the balance did not change'].filter(Boolean).join(', ');
    return `Could not reproduce in a browser: ${flickerMeasure(r)} (${extra}).`;
  }
  if (page === 'transfers') return run.pass ? `Reproduced in a browser: ${amountsMeasure(r)}.` : `Could not reproduce in a browser: ${amountsMeasure(r)}.`;
  return `Checked the ${page} page in a browser.`;
}

function beforeNote(page: Page, before: ReproductionRecord | undefined): string {
  if (!before?.ran || !before.result) return '';
  if (page === 'card') {
    const n = num(before.result.card_picture_replacements);
    return n !== null ? ` (before the fix: replaced ${times(n)})` : '';
  }
  const k = num(before.result.rows_differ);
  const rows = num(before.result.rows);
  return k !== null && rows !== null ? ` (before the fix: ${k} of ${rows} rows differed)` : '';
}

/** The success line after a redeploy. */
export function fixedLine(page: Page, run: CheckRun, before: ReproductionRecord | undefined): string {
  const r = run.result ?? {};
  const what = page === 'card' ? flickerMeasure(r) : amountsMeasure(r).replace(' on the transfers page', '');
  return `Deployed. Checked the ${page} page in a browser: ${what}${beforeNote(page, before)}.`;
}

/** Runs one reproduction and posts its line. Never throws past the caller's catch. */
async function reproduce(group: ReportGroup, check: PageCheck, deps: ProofDeps): Promise<void> {
  const page = group.page as Page;
  const statePath = deps.statePath ?? DEFAULT_REPRODUCTIONS_PATH;
  const channel = group.reports[0]?.channel ?? '';
  const rec: ReproductionRecord = { groupId: group.id, page, channel, threadTs: group.threadTs, check: check.name, startedAt: new Date().toISOString() };
  safeEmit(deps, { groupId: group.id, step: 'reproduction', state: 'start', evidence: { check: check.name, page } });
  await saveRecord(statePath, rec).catch((err) => logger(deps)(`[proof] could not record the reproduction start: ${String(err)}`));
  const run = await runSafe(deps, check.file, check.reproduce, deps.baseUrl ?? config.appBaseUrl.replace(/\/$/, ''));
  logger(deps)(`[proof] reproduction ${check.name} --expect ${check.reproduce}: ran ${run.ran}, pass ${run.pass}, ${run.seconds} s ${JSON.stringify(run.result ?? run.error)}`);
  await saveRecord(statePath, { ...rec, ran: run.ran, reproduced: run.ran && run.pass, result: run.result }).catch((err) =>
    logger(deps)(`[proof] could not record the reproduction: ${String(err)}`),
  );
  const text = reproductionLine(page, run);
  try {
    await deps.slack.postMessage({ channel, threadTs: group.threadTs, text });
  } catch (err) {
    logger(deps)(`[proof] could not post "${text.slice(0, 60)}": ${err instanceof Error ? err.message : String(err)}`);
  }
  safeEmit(deps, {
    groupId: group.id,
    step: 'reproduction',
    state: run.ran ? 'done' : 'failed',
    seconds: run.seconds,
    evidence: { check: check.name, reproduced: run.ran && run.pass, result: run.result, summary: text },
    ...(run.ran ? {} : { error: run.error }),
  });
}

/**
 * The real steps with the reproduction beside `investigate`: the real investigate is called
 * first and its own promise is returned untouched; the check runs in the background.
 */
export function withReproduction(code: CodeSteps, deps: ProofDeps): CodeSteps {
  if (!proofEnabled(deps)) return code;
  return {
    ...code,
    investigate: (input) => {
      const result = code.investigate(input);
      try {
        const check = input.group.page ? PAGE_CHECKS[input.group.page] : undefined;
        if (check) track(reproduce(input.group, check, deps), deps, `the reproduction for ${input.group.id}`);
      } catch (err) {
        logger(deps)(`[proof] the reproduction did not start: ${err instanceof Error ? err.message : String(err)}`);
      }
      return result;
    },
  };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** After a merge: wait for the redeploy, check the page until it is fixed or the window ends, post one line. */
/** `before` is read before the approval handler ran: a redeploy can land before the handler returns. */
async function proveFixed(press: ApprovePress, groupId: string, deps: ProofDeps, atPress: { t0: number; deployed: string | null }): Promise<void> {
  const log = logger(deps);
  const statePath = deps.statePath ?? DEFAULT_REPRODUCTIONS_PATH;
  const records = Object.values(readRecords(statePath));
  // The press's own thread first; a record for another thread with the same group id is not this run's.
  const before = press.threadTs ? records.find((r) => r.threadTs === press.threadTs) : records.filter((r) => r.groupId === groupId).sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  if (!before) {
    log(`[proof] no reproduction recorded for ${groupId}; the page is not checked after the merge`);
    return;
  }
  const page = before.page;
  const check = PAGE_CHECKS[page];
  if (!check) return;
  const channel = press.channel || before.channel;
  const threadTs = press.threadTs || before.threadTs;
  const window = deps.proofWindowMs ?? 60_000;
  const retry = deps.retryMs ?? 2_000;
  const poll = deps.pollMs ?? 1_000;
  const deployDir = deps.deployDir ?? DEFAULT_DEPLOY_DIR;
  const baseUrl = deps.baseUrl ?? config.appBaseUrl.replace(/\/$/, '');
  const t0 = atPress.t0;
  const left = () => window - (performance.now() - t0);
  const say = async (text: string) => {
    try {
      await deps.slack.postMessage({ channel, threadTs, text });
    } catch (err) {
      log(`[proof] could not post "${text.slice(0, 60)}": ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // The redeploy: the watcher writes .deployed.json when the new commit runs. No file: no watcher, check at once.
  const deployedAtMerge = atPress.deployed;
  safeEmit(deps, { groupId, step: 'deploy', state: 'start' });
  let deploySeen = deployedAtMerge === null;
  while (!deploySeen && left() > 0) {
    await sleep(poll);
    const now = readDeployed(deployDir)?.commit ?? null;
    if (now && now !== deployedAtMerge) deploySeen = true;
  }
  if (!deploySeen) {
    safeEmit(deps, { groupId, step: 'deploy', state: 'failed', seconds: round1(performance.now() - t0), error: 'no redeploy within the window' });
    await say(`The pull request is merged, but no redeploy of the card app was seen within ${Math.round(window / 1000)} seconds, so the page was not checked in a browser.`);
    return;
  }
  safeEmit(deps, {
    groupId,
    step: 'deploy',
    state: 'done',
    seconds: round1(performance.now() - t0),
    evidence: { sha: readDeployed(deployDir)?.commit ?? null, seconds: round1(performance.now() - t0), watcher: deployedAtMerge !== null },
  });

  safeEmit(deps, { groupId, step: 'proof', state: 'start', evidence: { check: check.name } });
  let last: CheckRun | null = null;
  let lastMeasured: CheckRun | null = null;
  while (left() > 0) {
    last = await runSafe(deps, check.file, check.fixed, baseUrl);
    log(`[proof] after the merge ${check.name} --expect ${check.fixed}: ran ${last.ran}, pass ${last.pass} ${JSON.stringify(last.result ?? last.error)}`);
    if (last.ran) lastMeasured = last;
    if (last.ran && last.pass) {
      const text = fixedLine(page, last, before);
      await say(text);
      safeEmit(deps, {
        groupId,
        step: 'proof',
        state: 'done',
        seconds: round1(performance.now() - t0),
        evidence: { check: check.name, before: before.result ?? null, after: last.result, pass: true, summary: text },
      });
      return;
    }
    if (left() > 0) await sleep(retry);
  }
  const secs = Math.round(window / 1000);
  const text = lastMeasured
    ? `The pull request is merged, but the page still shows the problem after ${secs} seconds (last check: ${page === 'card' ? flickerMeasure(lastMeasured.result ?? {}) : amountsMeasure(lastMeasured.result ?? {})}).`
    : `The pull request is merged, but the ${page} page could not be checked in a browser within ${secs} seconds: ${esc(last?.error ?? 'no check ran')}.`;
  await say(text);
  safeEmit(deps, {
    groupId,
    step: 'proof',
    state: 'failed',
    seconds: round1(performance.now() - t0),
    evidence: { check: check.name, before: before.result ?? null, after: lastMeasured?.result ?? null, pass: false, summary: text },
    error: lastMeasured ? 'the page still shows the problem' : (last?.error ?? 'no check ran'),
  });
}

/**
 * The approval handler with the after-fix proof: the real handler runs first and its result is
 * returned unchanged; on `merged` the proof starts in the background, so the reply is not delayed.
 */
export function approveWithProof(deps: ProofDeps): (press: ApprovePress, approveDeps: ApproveDeps) => Promise<ApproveResult> {
  const approve = deps.approve ?? handleApprovePress;
  if (!proofEnabled(deps)) return approve;
  return async (press, approveDeps) => {
    // The deployed commit and the clock before the press is handled: the merge, the message update and
    // the pull request comment take 4 to 7 s, and a redeploy can land in that time.
    const t0 = performance.now();
    let deployed: string | null = null;
    try {
      deployed = readDeployed(deps.deployDir ?? DEFAULT_DEPLOY_DIR)?.commit ?? null;
    } catch (err) {
      logger(deps)(`[proof] could not read the deployment file before the press: ${String(err)}`);
    }
    const result = await approve(press, approveDeps);
    try {
      const value = parseApproveValue(press.value);
      const groupId = value?.group ?? '';
      // Only a press that reached the merge is an approval step; a refused press (not the owner,
      // already approved, in progress, bad value) is not the owner's approval and emits nothing.
      if (result === 'merged' || result === 'merge-failed') safeEmit(deps, {
        groupId,
        step: 'approval',
        state: result === 'merged' ? 'done' : 'failed',
        seconds: round1(performance.now() - t0),
        evidence: { by: press.unattended ? 'rehearsal-script' : 'owner', prNumber: value?.pr ?? null, result },
      });
      if (result === 'merged' && groupId) track(proveFixed(press, groupId, deps, { t0, deployed }), deps, `the after-fix proof for ${groupId}`);
    } catch (err) {
      logger(deps)(`[proof] the after-fix proof did not start: ${err instanceof Error ? err.message : String(err)}`);
    }
    return result;
  };
}
