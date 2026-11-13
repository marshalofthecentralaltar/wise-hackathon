import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Report } from '../src/types.js';
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
    const { store, model } = storeWith(200);
    const t0 = performance.now();
    const p1 = store.addReports([report('flicker first')]);
    await new Promise((r) => setTimeout(r, 10));
    const p2 = store.addReports([report('flicker second')]);
    await new Promise((r) => setTimeout(r, 10));
    const p3 = store.addReports([report('flicker third')]);
    expect(performance.now() - t0).toBeLessThan(50);
    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(model.calls()).toBeLessThanOrEqual(2);
    expect(model.batches).toEqual([['flicker first'], ['flicker second', 'flicker third']]); // arrival order
    const groups = store.groups();
    expect(groups).toHaveLength(1);
    expect(groups[0]!.reports.map((r) => r.text)).toEqual(['flicker first', 'flicker second', 'flicker third']);
    // Triggered exactly once, to the caller whose report made it three.
    expect([r1.length, r2.length, r3.length]).toEqual([0, 0, 1]);
  });
});
