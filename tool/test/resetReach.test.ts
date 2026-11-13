import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeMessageHandler } from '../src/listener.js';
import { PipelineQueue } from '../src/pipeline.js';
import type { SlackMessageEvent } from '../src/slack.js';
import { groupReports } from '../src/steps/grouping.js';
import { clearReportState, ReportStore } from '../src/steps/reports.js';
import type { ReportGroup } from '../src/types.js';
import { fakeModel } from './helpers/fakeModel.js';

const OWN = { botUserId: 'U0BOT0001', botId: 'B0BOT0001' };
const CHANNEL = 'C0SUPPORT';
let seq = 0;
const event = (text: string): SlackMessageEvent => ({ type: 'message', channel: CHANNEL, user: 'U0AGENT01', text, ts: `1763090000.${String(++seq).padStart(6, '0')}` });

/** One running tool: one store mirrored to a state file, the real queue, one handler. */
function runningTool() {
  const statePath = join(mkdtempSync(join(tmpdir(), 'reset-reach-')), '.state', 'groups.json');
  const model = fakeModel();
  const logs: string[] = [];
  const store = new ReportStore({ threshold: 3, statePath, load: true, log: (m) => logs.push(m), classify: (r, g) => groupReports(r, g, { callModel: model.call, log: () => undefined }) });
  const runs: ReportGroup[] = [];
  const queue = new PipelineQueue(async (group) => {
    runs.push(group);
    return { ok: true, timings: { groupId: group.id, startedAt: '', secondsByStep: {}, totalSeconds: 0 } };
  });
  const handle = makeMessageHandler({ own: OWN, channelId: CHANNEL, addReports: (r) => store.addReports(r), enqueue: (g, s) => queue.enqueue(g, s), log: () => undefined });
  return { statePath, store, queue, runs, handle, logs };
}

describe('a reset made by another process reaches a running tool', () => {
  it('three reports run, the reset clears the files, three new reports of the same problem run again', async () => {
    const t = runningTool();
    for (let i = 1; i <= 3; i++) await t.handle(event(`flicker report ${i}`));
    await t.queue.idle();
    await t.store.flushed();
    expect(t.runs).toHaveLength(1);
    expect(existsSync(t.statePath)).toBe(true);

    // What `npm run reset` does in its own process: a call on the files, not on this store.
    await clearReportState(t.statePath);
    expect(existsSync(t.statePath)).toBe(false);

    for (let i = 4; i <= 6; i++) await t.handle(event(`flicker report ${i}`));
    await t.queue.idle();
    expect(t.runs).toHaveLength(2);
    expect(t.runs[1]!.reports.map((r) => r.text)).toEqual(['flicker report 4', 'flicker report 5', 'flicker report 6']);
    expect(t.runs[1]!.id).not.toBe(t.runs[0]!.id);
    expect(t.logs.join('\n')).toMatch(/is gone \(a reset ran\)/);
  });

  it('without a reset the same six reports give one run (the fourth to sixth join the group that ran)', async () => {
    const t = runningTool();
    for (let i = 1; i <= 6; i++) await t.handle(event(`flicker report ${i}`));
    await t.queue.idle();
    expect(t.runs).toHaveLength(1);
    expect(t.store.groups()[0]!.reports).toHaveLength(6);
  });
});
