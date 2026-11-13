import { describe, expect, it } from 'vitest';
import type { Report, ReportGroup } from '../src/types.js';
import { buildGroupingPrompt, groupReports, parseGroupingAnswer, type ModelCall } from '../src/steps/grouping.js';
import { ReportStore } from '../src/steps/reports.js';

const r = (ts: string, text: string): Report => ({ channel: 'C1', ts, sender: 'U1', text });
const reports = [r('1.1', 'card picture blinks'), r('1.2', 'hello team')];
const open: ReportGroup[] = [{ id: 'group-7', page: 'card', summary: 'The card picture blinks.', reports: [r('0.1', 'blinking card')], threadTs: '0.1' }];

const valid = JSON.stringify({
  messages: [
    { id: 'm1', is_report: true, page: 'card', group: 'g1', summary: 'The card picture blinks.' },
    { id: 'm2', is_report: false, page: null, group: null, summary: '' },
  ],
});

/** Answers each call with the next text in turn. */
function scripted(...answers: (string | Error)[]): { call: ModelCall; calls: () => number } {
  let n = 0;
  return {
    call: async () => {
      const a = answers[Math.min(n++, answers.length - 1)]!;
      if (a instanceof Error) throw a;
      return { ok: true, text: a };
    },
    calls: () => n,
  };
}

describe('grouping prompt and answer', () => {
  it('names open groups g1.. and messages m1.. without internal ids', () => {
    const p = buildGroupingPrompt(reports, open);
    expect(p).toContain('g1 [page: card] The card picture blinks.');
    expect(p).toContain('m1: "card picture blinks"');
    expect(p).toContain('m2: "hello team"');
    expect(p).not.toContain('group-7');
  });

  it('maps g1 back to the real group id and accepts a fenced answer', () => {
    const d = parseGroupingAnswer('```json\n' + valid + '\n```', reports, open);
    expect(d[0]).toMatchObject({ isReport: true, page: 'card', target: { kind: 'existing', groupId: 'group-7' } });
    expect(d[1]).toMatchObject({ isReport: false, target: null });
  });

  it.each([
    ['an unknown group id', JSON.stringify({ messages: [{ id: 'm1', is_report: true, page: 'card', group: 'g9', summary: 'x' }, { id: 'm2', is_report: false }] })],
    ['an unknown message id', JSON.stringify({ messages: [{ id: 'm1', is_report: false }, { id: 'm2', is_report: false }, { id: 'm3', is_report: false }] })],
    ['a message answered twice', JSON.stringify({ messages: [{ id: 'm1', is_report: false }, { id: 'm1', is_report: false }] })],
    ['a message not answered', JSON.stringify({ messages: [{ id: 'm1', is_report: false }] })],
    ['an unknown page', JSON.stringify({ messages: [{ id: 'm1', is_report: true, page: 'login', group: 'n1', summary: 'x' }, { id: 'm2', is_report: false }] })],
    ['invalid JSON', '{"messages": [ nope'],
  ])('rejects %s', (_name, text) => {
    expect(() => parseGroupingAnswer(text, reports, open)).toThrow();
  });
});

describe('bad model answers', () => {
  it('retries invalid JSON once, then gives up with a log line and no throw', async () => {
    const model = scripted('not json at all', 'still {not json');
    const logs: string[] = [];
    const res = await groupReports(reports, open, { callModel: model.call, log: (m) => logs.push(m) });
    expect(res.ok).toBe(false);
    expect(model.calls()).toBe(2);
    expect(res.calls).toBe(2);
    expect(logs.some((l) => l.includes('giving up'))).toBe(true);
  });

  it('retries an unknown group id once and uses the valid second answer', async () => {
    const bad = JSON.stringify({ messages: [{ id: 'm1', is_report: true, page: 'card', group: 'g4', summary: 'x' }, { id: 'm2', is_report: false }] });
    const model = scripted(bad, valid);
    const logs: string[] = [];
    const res = await groupReports(reports, open, { callModel: model.call, log: (m) => logs.push(m) });
    expect(res.ok).toBe(true);
    expect(model.calls()).toBe(2);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('unknown group id g4');
  });

  it('a model call that throws or fails is retried and logged, never thrown', async () => {
    const logs: string[] = [];
    const res = await groupReports(reports, open, { callModel: scripted(new Error('boom')).call, log: (m) => logs.push(m) });
    expect(res.ok).toBe(false);
    expect(logs.join('\n')).toContain('boom');
    const failing: ModelCall = async () => ({ ok: false, text: '', error: 'claude exit 1' });
    const res2 = await groupReports(reports, open, { callModel: failing, log: () => undefined });
    expect(res2).toMatchObject({ ok: false, calls: 2, error: 'claude exit 1' });
  });

  it('in the store, two bad answers leave the messages ungrouped and the store keeps working', async () => {
    const logs: string[] = [];
    const answers = ['garbage', JSON.stringify({ messages: [{ id: 'm1', is_report: true, page: 'card', group: 'g2', summary: 'x' }] })];
    let n = 0;
    const store = new ReportStore({
      threshold: 3,
      statePath: null,
      log: (m) => logs.push(m),
      classify: (rs, gs) => groupReports(rs, gs, { callModel: async () => ({ ok: true, text: answers[n++] ?? 'garbage' }), log: (m) => logs.push(m) }),
    });
    await expect(store.addReports([r('2.1', 'blinking card')])).resolves.toEqual([]);
    expect(store.state().ungrouped.map((x) => x.ts)).toEqual(['2.1']);
    expect(logs.filter((l) => l.includes('attempt'))).toHaveLength(2);
    // A classifier that throws outright is caught too.
    const throwing = new ReportStore({ threshold: 3, statePath: null, log: (m) => logs.push(m), classify: async () => { throw new Error('kaboom'); } });
    await expect(throwing.addReports([r('2.2', 'x')])).resolves.toEqual([]);
    expect(throwing.state().ungrouped).toHaveLength(1);
    expect(logs.some((l) => l.includes('kaboom'))).toBe(true);
  });
});
