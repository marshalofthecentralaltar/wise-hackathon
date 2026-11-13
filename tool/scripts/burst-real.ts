// The stage burst with the real model: fixture r01, r39 and r50 (card picture, en/et/ru) are
// added at 0 s, 1 s and 2 s to an empty store. Prints each model call, which call each message
// went into, the groups, and the seconds from the first message to the trigger.
// Run from tool/: npx tsx scripts/burst-real.ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Report, ReportGroup } from '../src/types.js';
import { groupReports } from '../src/steps/grouping.js';
import { ReportStore } from '../src/steps/reports.js';

const fixtures = JSON.parse(readFileSync(fileURLToPath(new URL('../../fixtures/reports.json', import.meta.url)), 'utf8')) as { id: string; text: string }[];
const ids = ['r01', 'r39', 'r50'];
const base = Math.floor(Date.now() / 1000);
const reports: Report[] = ids.map((id, i) => ({ channel: 'C-BURST', ts: `${base}.00000${i}`, sender: 'U-BURST', text: fixtures.find((f) => f.id === id)!.text }));
const idOf = (ts: string) => ids[reports.findIndex((r) => r.ts === ts)];

const t0 = performance.now();
const at = () => Math.round((performance.now() - t0) / 100) / 10;
const calls: { call: number; startedAt: number; endedAt: number; messages: string[]; modelCalls: number; ok: boolean }[] = [];
const store = new ReportStore({
  statePath: null,
  threshold: 3,
  classify: async (batch, open) => {
    const entry = { call: calls.length + 1, startedAt: at(), endedAt: 0, messages: batch.map((r) => idOf(r.ts)!), modelCalls: 0, ok: false };
    calls.push(entry);
    const res = await groupReports(batch, open);
    Object.assign(entry, { endedAt: at(), modelCalls: res.calls, ok: res.ok });
    return res;
  },
});

const triggers: { by: string; at: number; group: ReportGroup }[] = [];
const done = reports.map(
  (r, i) =>
    new Promise<void>((resolve) =>
      setTimeout(() => {
        console.log(`${at()} s: added ${ids[i]}`);
        void store.addReports([r]).then((groups) => {
          for (const g of groups) triggers.push({ by: ids[i]!, at: at(), group: g });
          resolve();
        });
      }, i * 1000),
    ),
);
await Promise.all(done);
await store.idle();

const groups = store.groups().map((g) => ({ id: g.id, page: g.page, summary: g.summary, messages: g.reports.map((r) => idOf(r.ts)) }));
const modelCalls = calls.reduce((n, c) => n + c.modelCalls, 0);
console.log(JSON.stringify({ calls, modelCalls, groups, triggers: triggers.map((t) => ({ returnedTo: t.by, secondsFromFirstMessage: t.at, group: t.group.id, size: t.group.reports.length })) }, null, 2));
const pass = groups.length === 1 && groups[0]!.messages.length === 3 && modelCalls <= 2 && triggers.length === 1;
console.log(`${pass ? 'PASS' : 'FAIL'}: ${groups.length} group(s), sizes ${groups.map((g) => g.messages.length).join('/')}, ${modelCalls} model call(s), ${triggers.length} trigger(s), trigger at ${triggers[0]?.at ?? '-'} s`);
process.exitCode = pass ? 0 : 1;
