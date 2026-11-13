// Step 1. The report store: candidate reports and the groups they form, in memory, mirrored
// to tool/.state/groups.json so a reset command can clear them. A group acts once, when it
// reaches config.reportThreshold reports.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import type { Report, ReportGroup } from '../types.js';
import { groupReports, type GroupingResult } from './grouping.js';

export const DEFAULT_STATE_PATH = fileURLToPath(new URL('../../.state/groups.json', import.meta.url));

export interface StoreState {
  groups: ReportGroup[];
  /** Ids of groups that have reached the threshold and acted. */
  triggered: string[];
  /** Reports the model could not classify (no valid answer after a retry). */
  ungrouped: Report[];
  /** Messages the model judged not to be customer reports. */
  chatter: Report[];
}

export interface ReportStoreOptions {
  threshold?: number;
  /** File the state is mirrored to; null keeps it in memory only. */
  statePath?: string | null;
  /** Read an existing state file at start. */
  load?: boolean;
  classify?: (newReports: Report[], openGroups: ReportGroup[]) => Promise<GroupingResult>;
  log?: (message: string) => void;
}

interface Pending {
  report: Report;
  request: number;
  /** A report a failed call left ungrouped, on its one more try. */
  retry?: boolean;
}

interface Waiter {
  resolve: (groups: ReportGroup[]) => void;
  triggered: ReportGroup[];
  remaining: number;
}

export const reportKey = (r: Pick<Report, 'channel' | 'ts'>) => `${r.channel}:${r.ts}`;

const snapshot = (g: ReportGroup): ReportGroup => ({ ...g, reports: g.reports.map((r) => ({ ...r })) });

export class ReportStore {
  readonly threshold: number;
  readonly statePath: string | null;
  /** Model calls made so far (retries included). */
  calls = 0;
  private groupList: ReportGroup[] = [];
  private triggered = new Set<string>();
  private ungroupedList: Report[] = [];
  private chatterList: Report[] = [];
  private seen = new Set<string>();
  /** Keys of ungrouped reports already given their one more try. */
  private retried = new Set<string>();
  private pending: Pending[] = [];
  private waiters = new Map<number, Waiter>();
  private requestSeq = 0;
  private groupSeq = 0;
  private running = false;
  private idleWaiters: (() => void)[] = [];
  private writing: Promise<void> = Promise.resolve();
  /** True once this store has written its state file (or read one at start); see noticeOutsideReset. */
  private fileIsOurs = false;
  private readonly classify: NonNullable<ReportStoreOptions['classify']>;
  private readonly log: (message: string) => void;

  constructor(opts: ReportStoreOptions = {}) {
    this.threshold = opts.threshold ?? config.reportThreshold;
    this.statePath = opts.statePath === undefined ? DEFAULT_STATE_PATH : opts.statePath;
    this.log = opts.log ?? ((m) => console.error(m));
    this.classify = opts.classify ?? ((reports, groups) => groupReports(reports, groups, { log: this.log }));
    if (opts.load && this.statePath && existsSync(this.statePath)) {
      this.loadSync(this.statePath);
      this.fileIsOurs = true;
    }
  }

  /**
   * Hands new messages to grouping. Resolves, once they are classified, with the groups that
   * reached the threshold because of these messages. A message seen before (same channel and
   * ts) is ignored. Never rejects.
   */
  addReports(reports: Report[]): Promise<ReportGroup[]> {
    const fresh: Report[] = [];
    for (const r of reports) {
      const key = reportKey(r);
      if (this.seen.has(key)) continue;
      this.seen.add(key);
      fresh.push({ ...r });
    }
    if (fresh.length === 0) return Promise.resolve([]);
    const request = ++this.requestSeq;
    return new Promise((resolve) => {
      this.waiters.set(request, { resolve, triggered: [], remaining: fresh.length });
      for (const report of fresh) this.pending.push({ report, request });
      this.pump();
    });
  }

  /** Resolves when no message is waiting for or inside a model call. */
  idle(): Promise<void> {
    if (!this.running && this.pending.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  groups(): ReportGroup[] {
    return this.groupList.map(snapshot);
  }

  state(): StoreState {
    return {
      groups: this.groups(),
      triggered: [...this.triggered],
      ungrouped: this.ungroupedList.map((r) => ({ ...r })),
      chatter: this.chatterList.map((r) => ({ ...r })),
    };
  }

  /** Forgets every report and group and clears the state file. */
  async reset(): Promise<void> {
    await this.idle();
    this.groupList = [];
    this.triggered.clear();
    this.ungroupedList = [];
    this.chatterList = [];
    this.seen.clear();
    this.retried.clear();
    this.groupSeq = 0;
    this.calls = 0;
    await this.persist();
  }

  /** Waits for the last write of the state file. */
  flushed(): Promise<void> {
    return this.writing;
  }

  private pump(): void {
    if (this.running) return;
    if (this.pending.length === 0) {
      for (const w of this.idleWaiters.splice(0)) w();
      return;
    }
    this.running = true;
    this.noticeOutsideReset();
    // Everything that arrived while the previous call ran goes into this one, in arrival order,
    // behind any report a failed call left ungrouped (each gets one more try). A trigger caused
    // by a retried report is returned to the first new caller in the batch.
    const fresh = this.pending.splice(0);
    const retries = this.ungroupedList.filter((r) => !this.retried.has(reportKey(r)));
    for (const r of retries) this.retried.add(reportKey(r));
    this.ungroupedList = this.ungroupedList.filter((r) => !retries.includes(r));
    const batch: Pending[] = [...retries.map((report) => ({ report, request: fresh[0]!.request, retry: true })), ...fresh];
    void this.processBatch(batch)
      .catch((err) => this.log(`[reports] batch failed: ${err instanceof Error ? err.message : String(err)}`))
      .finally(() => {
        this.running = false;
        this.pump();
      });
  }

  private async processBatch(batch: Pending[]): Promise<void> {
    const reports = batch.map((p) => p.report);
    let result: GroupingResult;
    try {
      result = await this.classify(reports, this.groups());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log(`[reports] grouping threw: ${message}`);
      result = { ok: false, decisions: [], calls: 0, seconds: 0, error: message };
    }
    this.calls += result.calls;
    try {
      if (!result.ok || result.decisions.length !== batch.length) {
        this.ungroupedList.push(...reports);
        const final = batch.filter((p) => p.retry).map((p) => p.report.ts);
        if (final.length) this.log(`[reports] retried once and still not classified; they stay ungrouped: ${final.join(', ')}`);
      } else {
        this.apply(batch, result);
      }
      await this.persist();
    } finally {
      for (const p of batch) {
        if (p.retry) continue; // its own caller was answered when it first failed
        const w = this.waiters.get(p.request);
        if (!w) continue;
        w.remaining--;
        if (w.remaining === 0) {
          this.waiters.delete(p.request);
          w.resolve(w.triggered);
        }
      }
    }
  }

  private apply(batch: Pending[], result: GroupingResult): void {
    const newLabels = new Map<string, ReportGroup>();
    result.decisions.forEach((d, i) => {
      const pending = batch[i]!;
      if (!d.isReport || !d.target) {
        this.chatterList.push(pending.report);
        return;
      }
      let group: ReportGroup | undefined;
      if (d.target.kind === 'existing') {
        const id = d.target.groupId;
        group = this.groupList.find((g) => g.id === id);
      } else {
        group = newLabels.get(d.target.label);
      }
      if (!group) {
        group = { id: `group-${++this.groupSeq}`, page: d.page, summary: d.summary, reports: [], threadTs: pending.report.ts };
        this.groupList.push(group);
        if (d.target.kind === 'new') newLabels.set(d.target.label, group);
      }
      if (group.page === null && d.page !== null) group.page = d.page;
      group.reports.push(pending.report);
      if (group.reports.length >= this.threshold && !this.triggered.has(group.id)) {
        this.triggered.add(group.id);
        this.waiters.get(pending.request)?.triggered.push(snapshot(group));
      }
    });
  }

  /**
   * The reset command runs in its own process and deletes the state file. A store that wrote the
   * file and finds it gone forgets every report and group before its next batch, so reports after
   * a reset start new groups. Group ids keep counting, so the pipeline queue (which runs a group id
   * once) runs the new group too.
   */
  private noticeOutsideReset(): void {
    const path = this.statePath;
    if (!path || !this.fileIsOurs || existsSync(path)) return;
    this.fileIsOurs = false;
    this.groupList = [];
    this.triggered.clear();
    this.ungroupedList = [];
    this.chatterList = [];
    this.retried.clear();
    this.log(`[reports] ${path} is gone (a reset ran): forgetting every earlier report and group`);
  }

  private persist(): Promise<void> {
    const path = this.statePath;
    if (!path) return Promise.resolve();
    const text = JSON.stringify(this.state(), null, 2);
    this.writing = this.writing.then(async () => {
      try {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, text, 'utf8');
        this.fileIsOurs = true;
      } catch (err) {
        this.log(`[reports] could not write ${path}: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
    return this.writing;
  }

  private loadSync(path: string): void {
    try {
      const s = JSON.parse(readFileSync(path, 'utf8')) as Partial<StoreState>;
      this.groupList = Array.isArray(s.groups) ? s.groups : [];
      this.triggered = new Set(Array.isArray(s.triggered) ? s.triggered : []);
      this.ungroupedList = Array.isArray(s.ungrouped) ? s.ungrouped : [];
      this.chatterList = Array.isArray(s.chatter) ? s.chatter : [];
      for (const r of [...this.groupList.flatMap((g) => g.reports), ...this.ungroupedList, ...this.chatterList]) this.seen.add(reportKey(r));
      this.groupSeq = this.groupList.reduce((max, g) => Math.max(max, Number(/^group-(\d+)$/.exec(g.id)?.[1] ?? 0)), 0);
    } catch (err) {
      this.log(`[reports] ignoring unreadable state file ${path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

let defaultStore: ReportStore | undefined;

/** The listener's store: mirrored to tool/.state/groups.json and read back at start. */
export function getReportStore(): ReportStore {
  defaultStore ??= new ReportStore({ load: true });
  return defaultStore;
}

/** Adds messages to the listener's store. Resolves with the groups that just reached the threshold. */
export function addReports(reports: Report[]): Promise<ReportGroup[]> {
  return getReportStore().addReports(reports);
}

/** For the reset command: clears the listener's store and deletes the state file. */
export async function clearReportState(path: string = DEFAULT_STATE_PATH): Promise<void> {
  if (defaultStore) await defaultStore.reset();
  await rm(path, { force: true });
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
}
