// Steps 3 to 10 for one group that reached the threshold, in the order of docs/CONTEXT.md:
// fill the report links; monitoring, recent changes and owner at the same time; the
// investigation with the text-only effect classification started beside it; the verdict; the
// fix (called for every verdict: the fix step itself does nothing for high severity); the
// handoff; the post. Short progress lines go into the thread as steps finish. They never name
// the owner: the handoff is the only message that does.
//
// runPipeline never rejects. A step that throws ends in a plain line in the thread and a logged
// error, and the listener carries on.
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import type { ToolEvent } from './events.js';
import { buildHandoffMessage, draftCustomerSentence, esc, finalCustomerSentence } from './handoff.js';
import type { SlackPort } from './slackPost.js';
import { listRecentChanges as defaultListRecentChanges } from './steps/changes.js';
import { checkMonitoring as defaultCheckMonitoring } from './steps/monitoring.js';
import { grafanaLink } from './grafana.js';
import { findOwner as defaultFindOwner, readOwnersMap } from './steps/owner.js';
import type {
  CodeSteps,
  FixOutcome,
  Handoff,
  Investigation,
  MonitoringFinding,
  Owner,
  Page,
  RecentCommit,
  ReportGroup,
  RunTimings,
  Verdict,
} from './types.js';

export const DEFAULT_TIMINGS_PATH = fileURLToPath(new URL('../.state/timings.jsonl', import.meta.url));

export interface PipelineDeps {
  /** Steps 6 to 8: investigate, classifyCustomerEffect, judge, fix. */
  code: CodeSteps;
  slack: SlackPort;
  /** Steps 3 to 5; the real ones when absent. */
  checkMonitoring?: (page: Page | null) => Promise<MonitoringFinding>;
  listRecentChanges?: () => Promise<RecentCommit[]>;
  findOwner?: (page: Page | null) => Promise<Owner>;
  /**
   * Part 8 of the handoff: the model's draft, or null when it failed. Started at the top of the run;
   * the draft is checked against the owner, commit and file when the handoff is built. The real
   * model call when absent.
   */
  customerSentence?: (group: ReportGroup) => Promise<string | null>;
  /** Seconds step 2 took for the message that completed the group, measured by the caller. */
  patternSeconds?: number;
  /** null writes no file. */
  timingsPath?: string | null;
  log?: (line: string) => void;
  /** One line per step start and finish for the events file (src/events.ts); absent writes no file. Never awaited. */
  emit?: (e: ToolEvent) => void;
}

export type PipelineStep = 'permalinks' | 'monitoring' | 'changes' | 'owner' | 'investigation' | 'verdict' | 'fix' | 'handoff' | 'post';

export interface PipelineResult {
  ok: boolean;
  /** The step that threw, when ok is false. */
  failedStep?: PipelineStep;
  error?: string;
  handoff?: Handoff;
  /** ts of the handoff message in the thread. */
  handoffTs?: string;
  timings: RunTimings;
}

class StepError extends Error {
  constructor(
    readonly step: PipelineStep,
    readonly cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
  }
}

const round = (s: number) => Math.round(s * 10) / 10;
const since = (t0: number) => round((performance.now() - t0) / 1000);

/** Runs fn, records its seconds under `step`, and tags a throw with the step's name. */
async function timed<T>(step: PipelineStep, secs: Record<string, number>, fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  try {
    return await fn();
  } catch (err) {
    throw new StepError(step, err);
  } finally {
    if (step !== 'permalinks') secs[step] = since(t0);
  }
}

const STEP_WORDS: Record<PipelineStep, string> = {
  permalinks: 'reading the report links',
  monitoring: 'checking monitoring and logs',
  changes: 'listing recent changes',
  owner: 'reading the owners file',
  investigation: 'investigating the code',
  verdict: 'judging severity',
  fix: 'writing the fix',
  handoff: 'writing the handoff',
  post: 'posting the handoff',
};

/** Strings that identify the owner: the GitHub login, the person's name from owners.json, the Slack id. */
export function ownerStrings(owner: Pick<Owner, 'githubLogin' | 'slackUserId'>): string[] {
  const out: string[] = [];
  if (owner.githubLogin) {
    out.push(owner.githubLogin);
    const name = readOwnersMap()[owner.githubLogin];
    if (name) out.push(name);
  }
  if (owner.slackUserId) out.push(owner.slackUserId);
  return out;
}

const scrub = (text: string, secrets: string[]) => secrets.reduce((t, s) => (s ? t.split(s).join('the owner') : t), text);

/** A Slack ts ("1763050000.000100") as an ISO time, or null when it is not one. */
export function slackTsToIso(ts: string): string | null {
  const d = new Date(Number(ts) * 1000);
  return ts && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
}

type EventStep = Exclude<PipelineStep, 'permalinks' | 'post'>;

/** The evidence of each step's `done` line: the fields of issue #20's contract, picked one by one. */
const EVIDENCE = {
  monitoring: (m: MonitoringFinding) => ({
    source: m.source,
    query: m.query ?? null,
    errorsPerSecond: m.errorsPerSecond,
    errorCount5xx: m.errorCount5xx ?? null,
    alertsFiring: m.alertsFiring,
    p95Seconds: m.p95Seconds,
    logLinesRead: m.logLinesRead,
    logErrors: m.logErrors,
    showsProblem: m.showsProblem,
    summary: m.summary,
  }),
  changes: (commits: RecentCommit[]) => ({
    days: config.recentDays,
    commits: commits.map((c) => ({ sha: c.sha, author: c.author, mergedAt: c.mergedAt, message: c.message, files: c.files })),
  }),
  owner: (o: Owner) => ({ codePath: o.codePath, ownersLine: o.ownersLine }),
  investigation: (i: Investigation) => ({
    found: i.found,
    commitSha: i.commitSha,
    commitAuthor: i.commitAuthor,
    file: i.file,
    lines: i.lines,
    whatIsWrong: i.whatIsWrong,
    customerEffect: i.customerEffect,
    revertsCleanly: i.revertsCleanly,
  }),
  verdict: (v: Verdict) => ({ severity: v.severity, reason: v.reason, decidedBy: v.decidedBy }),
  fix: (f: FixOutcome) => ({
    kind: f.kind,
    prUrl: f.prUrl,
    prNumber: f.prNumber,
    filesChanged: f.filesChanged,
    testsPassed: f.testsPassed,
    note: f.note,
    diff: f.diff ?? null,
  }),
};

export async function runPipeline(group: ReportGroup, deps: PipelineDeps): Promise<PipelineResult> {
  const log = deps.log ?? ((m: string) => console.error(m));
  const startedAt = new Date().toISOString();
  const t0 = performance.now();
  const secs: Record<string, number> = {};
  if (deps.patternSeconds !== undefined) secs.pattern = round(deps.patternSeconds);
  const channel = group.reports[0]?.channel ?? '';
  const threadTs = group.threadTs;
  let ownerSecrets: string[] = [];
  let monitoringSource: RunTimings['monitoringSource'];

  // The events file. Every emit is guarded here, evidence building included: a writer or an
  // evidence field that throws must not change the run.
  const eventGroupId = `${group.id}@${startedAt}`;
  let eventSecrets: string[] = [];
  let emitWarned = false;
  const emitEvent = (step: string, state: ToolEvent['state'], extra?: () => Partial<ToolEvent>): void => {
    if (!deps.emit) return;
    try {
      deps.emit({ v: 1, at: new Date().toISOString(), groupId: eventGroupId, step, state, ...(extra ? extra() : {}) });
    } catch (err) {
      if (!emitWarned) log(`[pipeline ${group.id}] could not emit a ${step} event: ${String(err)}`);
      emitWarned = true;
    }
  };
  /** timed(), with a start line before and a done or failed line after. */
  const traced = async <T>(step: EventStep, fn: () => Promise<T>, evidence: (v: T) => unknown): Promise<T> => {
    emitEvent(step, 'start');
    try {
      const value = await timed(step, secs, fn);
      emitEvent(step, 'done', () => ({ seconds: secs[step], evidence: evidence(value) }));
      return value;
    } catch (err) {
      emitEvent(step, 'failed', () => ({
        seconds: secs[step],
        error: scrub(err instanceof Error ? err.message : String(err), [...ownerSecrets, ...eventSecrets]).slice(0, 2000),
      }));
      throw err;
    }
  };

  emitEvent('reports', 'done', () => ({
    ...(deps.patternSeconds !== undefined ? { seconds: round(deps.patternSeconds) } : {}),
    evidence: { page: group.page, summary: group.summary, reports: group.reports.map((r) => ({ at: slackTsToIso(r.ts), text: r.text })) },
  }));

  const say = async (text: string): Promise<void> => {
    try {
      await deps.slack.postMessage({ channel, threadTs, text });
    } catch (err) {
      log(`[pipeline ${group.id}] could not post "${text.slice(0, 60)}": ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  let result: PipelineResult;
  try {
    result = await steps();
  } catch (err) {
    const step = err instanceof StepError ? err.step : 'handoff';
    const message = scrub(err instanceof Error ? err.message : String(err), ownerSecrets);
    log(`[pipeline ${group.id}] ${step} failed: ${err instanceof StepError && err.cause instanceof Error ? (err.cause.stack ?? message) : message}`);
    await say(`Stopped while ${STEP_WORDS[step]}: ${esc(message.slice(0, 300))}. No handoff was posted for these reports.`);
    result = { ok: false, failedStep: step, error: message, timings: timingsNow() };
  }
  await writeTimings(result.timings);
  return result;

  function timingsNow(): RunTimings {
    return { groupId: group.id, startedAt, secondsByStep: { ...secs }, totalSeconds: since(t0), ...(monitoringSource ? { monitoringSource } : {}) };
  }

  async function writeTimings(t: RunTimings): Promise<void> {
    const line = JSON.stringify(t);
    console.log(line);
    const path = deps.timingsPath === undefined ? DEFAULT_TIMINGS_PATH : deps.timingsPath;
    if (!path) return;
    try {
      await mkdir(dirname(path), { recursive: true });
      await appendFile(path, line + '\n', 'utf8');
    } catch (err) {
      log(`[pipeline] could not write ${path}: ${String(err)}`);
    }
  }

  async function steps(): Promise<PipelineResult> {
    const n = group.reports.length;
    // Part 8 needs only the group, so its model call starts now and runs beside every other step.
    const draft = (deps.customerSentence ?? ((g) => draftCustomerSentence(g)))(group).catch((err) => {
      log(`[pipeline ${group.id}] customer sentence threw: ${String(err)}`);
      return null;
    });
    await say(`${n} reports look like the same problem${group.page ? ` on the ${group.page} page` : ''}. Checking monitoring, recent changes and the owners file.`);

    // Report links for part 2. A missing link is not worth stopping for.
    await Promise.all(
      group.reports.map(async (r) => {
        if (r.permalink) return;
        try {
          r.permalink = await deps.slack.getPermalink(r.channel, r.ts);
        } catch (err) {
          log(`[pipeline ${group.id}] no link for report ${r.ts}: ${String(err)}`);
        }
      }),
    );

    // Steps 3, 4 and 5 do not depend on each other.
    const [monitoring, commits, owner] = await Promise.all([
      traced('monitoring', () => (deps.checkMonitoring ?? defaultCheckMonitoring)(group.page), EVIDENCE.monitoring),
      traced('changes', () => (deps.listRecentChanges ?? (() => defaultListRecentChanges()))(), EVIDENCE.changes),
      traced('owner', () => (deps.findOwner ?? defaultFindOwner)(group.page), (o) => {
        eventSecrets = ownerStrings(o);
        return EVIDENCE.owner(o);
      }),
    ]);
    ownerSecrets = ownerStrings(owner);
    monitoringSource = monitoring.source;
    const grafana = grafanaLink(group);
    await say(
      `Monitoring and logs: ${monitoring.showsProblem ? 'they show a problem' : monitoring.unavailable ? 'could not be read' : 'nothing'}${grafana ? ` (${grafana})` : ''}. ` +
        `${commits.length} ${commits.length === 1 ? 'commit' : 'commits'} in the last ${config.recentDays} days. ` +
        `${owner.githubLogin ? 'Owner found' : 'No owner found'}. Investigating the code.`,
    );

    // Step 6, with the text-only classification for step 7 started beside it.
    const textEffect = deps.code.classifyCustomerEffect(group.reports.map((r) => r.text));
    textEffect.catch(() => undefined); // judge reads it; this only keeps a rejection from going unhandled
    const investigation: Investigation = await traced('investigation', () => deps.code.investigate({ group, owner, monitoring, commits }), EVIDENCE.investigation);
    await say(
      investigation.found && investigation.commitSha
        ? `The investigation named commit ${investigation.commitSha.slice(0, 7)}. Judging severity.`
        : 'The investigation could not name a commit. Judging severity.',
    );

    const verdict: Verdict = await traced('verdict', () => deps.code.judge({ group, monitoring, investigation, textEffect }), EVIDENCE.verdict);
    await say(
      verdict.severity === 'low'
        ? 'Severity: low. Writing the smallest fix.'
        : 'Severity: high. No code will be changed; writing the handoff.',
    );

    let fix: FixOutcome;
    try {
      fix = await traced('fix', () => deps.code.fix({ group, owner, investigation, verdict }), EVIDENCE.fix);
    } catch (err) {
      // The handoff still matters without a pull request, so a failed fix does not stop the run.
      const message = scrub(err instanceof Error ? err.message : String(err), ownerSecrets);
      log(`[pipeline ${group.id}] fix failed: ${err instanceof StepError && err.cause instanceof Error ? (err.cause.stack ?? message) : message}`);
      await say(`The fix step failed: ${esc(message.slice(0, 300))}. The handoff follows without a pull request.`);
      fix = { kind: 'none', prUrl: null, prNumber: null, branch: null, filesChanged: [], testsPassed: null, note: `the fix step failed: ${message.slice(0, 200)}`, seconds: secs.fix ?? 0 };
    }

    const handoff = await traced('handoff', async () => {
      // What part 8 must not say, known only now: the owner, the commit, its author and the file.
      const fileName = investigation.file?.split('/').at(-1) ?? '';
      const forbidden = [...ownerStrings(owner), investigation.commitSha?.slice(0, 7) ?? '', investigation.commitAuthor ?? '', investigation.file ?? '', fileName].filter(Boolean);
      const sentenceForCustomers = finalCustomerSentence(await draft, group, forbidden, log);
      const h: Handoff = { group, monitoring, owner, investigation, verdict, fix, sentenceForCustomers };
      return { h, message: buildHandoffMessage(h) };
    }, (v) => ({ sentenceForCustomers: v.h.sentenceForCustomers, threadUrl: group.reports[0]?.permalink ?? null }));

    const posted = await timed('post', secs, () =>
      deps.slack.postMessage({ channel, threadTs, text: handoff.message.text, blocks: handoff.message.blocks }),
    );
    return { ok: true, handoff: handoff.h, handoffTs: posted.ts, timings: timingsNow() };
  }
}

/**
 * Runs groups one at a time, in arrival order. A group runs once: a second enqueue of the same
 * group id is ignored, so a group that reaches the threshold twice still gets one thread.
 */
export class PipelineQueue {
  private chain: Promise<unknown> = Promise.resolve();
  private started = new Set<string>();

  constructor(private readonly run: (group: ReportGroup, patternSeconds?: number) => Promise<PipelineResult>) {}

  /** Resolves with the run's result, or null when the group was queued before. Never rejects. */
  enqueue(group: ReportGroup, patternSeconds?: number): Promise<PipelineResult | null> {
    if (this.started.has(group.id)) return Promise.resolve(null);
    this.started.add(group.id);
    const next = this.chain.then(() => this.run(group, patternSeconds)).catch((err) => {
      console.error(`[queue] ${group.id} failed outside the pipeline: ${String(err)}`);
      return null;
    });
    this.chain = next;
    return next;
  }

  /** Resolves when every queued run has finished. */
  idle(): Promise<void> {
    return this.chain.then(() => undefined);
  }
}
