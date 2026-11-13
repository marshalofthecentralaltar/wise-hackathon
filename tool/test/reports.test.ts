import { describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Report, ReportGroup } from '../src/types.js';
import { groupReports } from '../src/steps/grouping.js';
import { ReportStore } from '../src/steps/reports.js';
import { fakeModel } from './helpers/fakeModel.js';

let tsSeq = 0;
const report = (text: string, ts = `1700000000.${String(++tsSeq).padStart(6, '0')}`): Report => ({ channel: 'C1', ts, sender: 'U1', text });

function storeWith(delayMs = 0, statePath: string | null = null) {
  const model = fakeModel(delayMs);
  const logs: string[] = [];
  const store = new ReportStore({
    threshold: 3,
    statePath,
    log: (m) => logs.push(m),
    classify: (reports, groups) => groupReports(reports, groups, { callModel: model.call, log: (m) => logs.push(m) }),
  });
  return { store, model, logs };
}

describe('report store: threshold', () => {
  it('the third report of a group triggers once, the fourth does not', async () => {
    const { store } = storeWith();
    expect(await store.addReports([report('flicker one')])).toEqual([]);
    expect(await store.addReports([report('flicker two')])).toEqual([]);
    const third = await store.addReports([report('flicker three')]);
    expect(third).toHaveLength(1);
    expect(third[0]!.reports.map((r) => r.text)).toEqual(['flicker one', 'flicker two', 'flicker three']);
    expect(third[0]!.threadTs).toBe(third[0]!.reports[0]!.ts);
    expect(third[0]!.page).toBe('card');
    expect(await store.addReports([report('flicker four')])).toEqual([]);
    expect(await store.addReports([report('flicker five')])).toEqual([]);
    const groups = store.groups();
    expect(groups).toHaveLength(1);
    expect(groups[0]!.reports).toHaveLength(5); // later reports still join
  });

  it('ignores a report already seen (same channel and ts), within and across calls', async () => {
    const { store, model } = storeWith();
    const a = report('flicker a');
    expect(await store.addReports([a, { ...a }])).toEqual([]);
    expect(await store.addReports([{ ...a, text: 'flicker again' }])).toEqual([]);
    expect(await store.addReports([report('flicker b')])).toEqual([]);
    expect(store.groups()[0]!.reports).toHaveLength(2);
    expect(model.calls()).toBe(2);
    // The same ts in another channel is a different message.
    const triggered = await store.addReports([{ ...a, channel: 'C2' }]);
    expect(triggered).toHaveLength(1);
  });

  it('a group of two never triggers, and chatter joins no group', async () => {
    const { store } = storeWith();
    for (const text of ['declined x', 'chat hello', 'declined y', 'chat lunch', 'flicker z']) {
      expect(await store.addReports([report(text)])).toEqual([]);
    }
    const s = store.state();
    expect(s.groups.map((g) => g.reports.length).sort()).toEqual([1, 2]);
    expect(s.triggered).toEqual([]);
    expect(s.chatter.map((r) => r.text)).toEqual(['chat hello', 'chat lunch']);
  });

  it('three reports of one group in one call trigger once', async () => {
    const { store, model } = storeWith();
    const triggered = await store.addReports([report('flicker 1'), report('flicker 2'), report('flicker 3'), report('flicker 4')]);
    expect(triggered).toHaveLength(1);
    expect(triggered[0]!.reports).toHaveLength(3); // the group as it was when it reached the threshold
    expect(model.calls()).toBe(1);
  });

  it('mirrors the state to the file and reset clears it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'store-'));
    const path = join(dir, '.state', 'groups.json');
    const { store } = storeWith(0, path);
    await store.addReports([report('flicker 1'), report('chat hi')]);
    await store.flushed();
    const saved = JSON.parse(readFileSync(path, 'utf8'));
    expect(saved.groups).toHaveLength(1);
    expect(saved.chatter).toHaveLength(1);
    // A new store reading the file knows the messages it has seen.
    const reloaded = new ReportStore({ threshold: 3, statePath: path, load: true, classify: async () => ({ ok: true, decisions: [], calls: 0, seconds: 0 }) });
    expect(reloaded.groups()).toHaveLength(1);
    expect(await reloaded.addReports([saved.groups[0].reports[0]])).toEqual([]);
    await store.reset();
    expect(existsSync(path)).toBe(true);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ groups: [], triggered: [], ungrouped: [], chatter: [] });
  });
});

describe('report store: burst', () => {
  it('three reports added within 50 ms cause at most two model calls and end in one group of three', async () => {
    // Fake timers: the 200 ms model and the 20 ms gaps run on a clock the test controls, so a
    // busy machine cannot stretch the burst past 50 ms.
    vi.useFakeTimers();
    try {
      const { store, model } = storeWith(200);
      const t0 = Date.now();
      const p1 = store.addReports([report('flicker first')]);
      await vi.advanceTimersByTimeAsync(20);
      const p2 = store.addReports([report('flicker second')]);
      await vi.advanceTimersByTimeAsync(20);
      const p3 = store.addReports([report('flicker third')]);
      expect(Date.now() - t0).toBe(40);
      expect(model.calls()).toBe(1); // the first call is still running
      await vi.advanceTimersByTimeAsync(1_000);
      const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
      checkBurst(store, model, [r1, r2, r3]);
    } finally {
      vi.useRealTimers();
    }
  });
});

function checkBurst(store: ReportStore, model: ReturnType<typeof fakeModel>, [r1, r2, r3]: ReportGroup[][]) {
  {
    expect(model.calls()).toBeLessThanOrEqual(2);
    expect(model.batches).toEqual([['flicker first'], ['flicker second', 'flicker third']]); // arrival order
    const groups = store.groups();
    expect(groups).toHaveLength(1);
    expect(groups[0]!.reports.map((r) => r.text)).toEqual(['flicker first', 'flicker second', 'flicker third']);
    // Triggered exactly once, to the caller whose report made it three.
    expect([r1!.length, r2!.length, r3!.length]).toEqual([0, 0, 1]);
  }
}

/** A store whose model gives garbage for the first `failCalls` calls, then answers like fakeModel. */
function flakyStore(failCalls: number) {
  const model = fakeModel();
  let n = 0;
  const logs: string[] = [];
  const store = new ReportStore({
    threshold: 3,
    statePath: null,
    log: (m) => logs.push(m),
    classify: (rs, gs) =>
      groupReports(rs, gs, { callModel: (p, s) => (++n <= failCalls ? Promise.resolve({ ok: true, text: 'garbage' }) : model.call(p, s)), log: (m) => logs.push(m) }),
  });
  return { store, model, logs };
}

describe('report store: retry of ungrouped reports', () => {
  it('a report whose batch failed goes in front of the next batch and can complete the threshold', async () => {
    const { store, model } = flakyStore(2); // the first batch fails both attempts
    const first = report('flicker one');
    expect(await store.addReports([first])).toEqual([]);
    expect(store.state().ungrouped.map((r) => r.ts)).toEqual([first.ts]);
    expect(await store.addReports([report('flicker two')])).toEqual([]);
    expect(model.batches[0]).toEqual(['flicker one', 'flicker two']); // retried report first
    expect(store.state().ungrouped).toEqual([]);
    const third = await store.addReports([report('flicker three')]);
    expect(third).toHaveLength(1);
    expect(third[0]!.reports.map((r) => r.text)).toEqual(['flicker one', 'flicker two', 'flicker three']);
  });

  it('a report that fails on its retry is not tried a third time, and one log line names it', async () => {
    const { store, model, logs } = flakyStore(4); // the first two batches fail
    const first = report('flicker one');
    const second = report('flicker two');
    await store.addReports([first]);
    await store.addReports([second]); // [one (retry), two] fails
    const final = logs.filter((l) => l.includes('retried once'));
    expect(final).toHaveLength(1);
    expect(final[0]).toContain(first.ts);
    expect(final[0]).not.toContain(second.ts);
    await store.addReports([report('flicker three')]);
    expect(model.batches).toEqual([['flicker two', 'flicker three']]); // one is not sent again
    expect(store.state().ungrouped.map((r) => r.ts)).toEqual([first.ts]);
    await store.addReports([report('flicker four')]);
    expect(model.batches[1]).toEqual(['flicker four']);
  });
});
