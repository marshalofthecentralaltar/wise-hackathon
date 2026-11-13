import { describe, expect, it } from 'vitest';
import { makeMessageHandler } from '../src/listener.js';
import { PipelineQueue } from '../src/pipeline.js';
import type { SlackMessageEvent } from '../src/slack.js';
import { groupReports } from '../src/steps/grouping.js';
import { ReportStore } from '../src/steps/reports.js';
import type { ReportGroup } from '../src/types.js';
import { fakeModel } from './helpers/fakeModel.js';

const OWN = { botUserId: 'U0BOT0001', botId: 'B0BOT0001' };
const CHANNEL = 'C0SUPPORT';
let seq = 0;
const event = (text: string, over: Partial<SlackMessageEvent> = {}): SlackMessageEvent => {
  const ts = `1763058000.${String(++seq).padStart(6, '0')}`;
  return { type: 'message', channel: CHANNEL, user: 'U0AGENT01', text, ts, ...over };
};

/** The real store with the fake grouping model, the real queue, and a recording run. */
function setup(addReportsOverride?: (store: ReportStore) => ReportStore['addReports']) {
  const model = fakeModel();
  const store = new ReportStore({ threshold: 3, statePath: null, log: () => undefined, classify: (r, g) => groupReports(r, g, { callModel: model.call, log: () => undefined }) });
  const runs: { group: ReportGroup; patternSeconds?: number }[] = [];
  const queue = new PipelineQueue(async (group, patternSeconds) => {
    runs.push({ group, patternSeconds });
    return { ok: true, timings: { groupId: group.id, startedAt: '', secondsByStep: {}, totalSeconds: 0 } };
  });
  const logs: string[] = [];
  const handle = makeMessageHandler({
    own: OWN,
    channelId: CHANNEL,
    addReports: addReportsOverride ? addReportsOverride(store) : (r) => store.addReports(r),
    enqueue: (g, s) => queue.enqueue(g, s),
    log: (m) => logs.push(m),
  });
  return { handle, runs, queue, store, logs, model };
}

describe('listener message handler', () => {
  it('three plain reports in the channel give exactly one pipeline run, with patternSeconds', async () => {
    const { handle, runs, queue } = setup();
    for (let i = 1; i <= 3; i++) await handle(event(`flicker report ${i}`));
    await handle(event('flicker report 4')); // a fourth report joins the group; no second run
    await queue.idle();
    expect(runs).toHaveLength(1);
    expect(runs[0]!.group.reports.map((r) => r.text)).toEqual(['flicker report 1', 'flicker report 2', 'flicker report 3']);
    expect(runs[0]!.group.reports.every((r) => r.channel === CHANNEL && r.sender === 'U0AGENT01')).toBe(true);
    expect(typeof runs[0]!.patternSeconds).toBe('number');
    expect(runs[0]!.patternSeconds).toBeGreaterThanOrEqual(0);
  });

  it('own messages, thread replies, edits and other channels give no run and reach no store', async () => {
    const { handle, runs, queue, model } = setup();
    for (let i = 1; i <= 3; i++) {
      await handle(event(`flicker own ${i}`, { user: OWN.botUserId }));
      await handle(event(`flicker own-bot ${i}`, { user: undefined, bot_id: OWN.botId }));
      await handle(event(`flicker reply ${i}`, { thread_ts: '1763000000.000001' }));
      await handle(event(`flicker edit ${i}`, { subtype: 'message_changed' }));
      await handle(event(`flicker elsewhere ${i}`, { channel: 'C0OTHER' }));
    }
    await queue.idle();
    expect(runs).toHaveLength(0);
    expect(model.calls()).toBe(0);
  });

  it('an addReports that throws is logged, and the next events still work', async () => {
    let fail = true;
    const { handle, runs, queue, logs } = setup((store) => (r) => {
      if (fail) {
        fail = false;
        return Promise.reject(new Error('store broke'));
      }
      return store.addReports(r);
    });
    await expect(handle(event('flicker lost'))).resolves.toBeUndefined();
    expect(logs.some((l) => l.includes('message handler failed') && l.includes('store broke'))).toBe(true);
    for (let i = 1; i <= 3; i++) await handle(event(`flicker after ${i}`));
    await queue.idle();
    expect(runs).toHaveLength(1);
    expect(runs[0]!.group.reports).toHaveLength(3);
  });
});
