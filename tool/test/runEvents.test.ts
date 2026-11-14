// makeRunEvents (src/events.ts): the pipeline and the code outside it (approval, redeploy, browser
// checks) write to one file, and every line of a run carries the same run id. The process screen
// clears on a new id, so a second id in the middle of a run would wipe the steps already shown.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeRunEvents, newestRunId, type ToolEvent } from '../src/events.js';

const dir = mkdtempSync(join(tmpdir(), 'run-events-'));
let n = 0;
const freshPath = () => join(dir, `run-${++n}.jsonl`);
const read = (path: string) =>
  readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as ToolEvent);
const line = (groupId: string, step: string, state: ToolEvent['state'] = 'done'): ToolEvent => ({ v: 1, at: '2026-11-14T01:00:00.000Z', groupId, step, state });

describe('makeRunEvents', () => {
  it('a bare event gets the run id the pipeline used for that group, in call order', async () => {
    const path = freshPath();
    const ev = makeRunEvents(path);
    ev.emit(line('group-1@2026-11-14T01:00:00.000Z', 'reports'));
    ev.emitBare({ groupId: 'group-1', step: 'reproduction', state: 'start' });
    ev.emit(line('group-1@2026-11-14T01:00:00.000Z', 'investigation'));
    ev.emitBare({ groupId: 'group-1', step: 'proof', state: 'done', seconds: 5.1, evidence: { pass: true } });
    await ev.idle();
    const events = read(path);
    expect(events.map((e) => e.step)).toEqual(['reports', 'reproduction', 'investigation', 'proof']);
    expect(new Set(events.map((e) => e.groupId))).toEqual(new Set(['group-1@2026-11-14T01:00:00.000Z']));
    const proof = events[3]!;
    expect(proof.v).toBe(1);
    expect(Number.isNaN(Date.parse(proof.at))).toBe(false);
    expect(proof).toMatchObject({ state: 'done', seconds: 5.1, evidence: { pass: true } });
  });

  it('the newest run of a group wins when its id was used twice (a restarted tool starts again at group-1)', async () => {
    const path = freshPath();
    const ev = makeRunEvents(path);
    ev.emit(line('group-1@2026-11-14T01:00:00.000Z', 'reports'));
    ev.emit(line('group-1@2026-11-14T02:00:00.000Z', 'reports'));
    ev.emitBare({ groupId: 'group-1', step: 'approval', state: 'done' });
    await ev.idle();
    expect(read(path).at(-1)!.groupId).toBe('group-1@2026-11-14T02:00:00.000Z');
  });

  it('another process (a script, or the tool after a restart) finds the run id in the file', async () => {
    const path = freshPath();
    const tool = makeRunEvents(path);
    tool.emit(line('group-1@2026-11-14T01:00:00.000Z', 'reports'));
    tool.emit(line('group-2@2026-11-14T01:05:00.000Z', 'reports'));
    tool.emit(line('group-1@2026-11-14T01:10:00.000Z', 'reports'));
    tool.emit(line('group-12@2026-11-14T01:20:00.000Z', 'reports'));
    await tool.idle();
    const script = makeRunEvents(path);
    script.emitBare({ groupId: 'group-1', step: 'approval', state: 'done' });
    script.emitBare({ groupId: 'group-2', step: 'approval', state: 'done' });
    await script.idle();
    const events = read(path);
    expect(events.at(-2)!.groupId).toBe('group-1@2026-11-14T01:10:00.000Z'); // not group-12's
    expect(events.at(-1)!.groupId).toBe('group-2@2026-11-14T01:05:00.000Z');
  });

  it('an unknown group keeps its bare id, a missing file is no error, and a line without a group id is not written', async () => {
    const path = freshPath();
    const ev = makeRunEvents(path);
    ev.emitBare({ groupId: '', step: 'approval', state: 'failed' });
    ev.emitBare({ groupId: 'group-9', step: 'approval', state: 'done' });
    await ev.idle();
    const events = read(path);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ v: 1, groupId: 'group-9', step: 'approval' });
  });

  it('an event that already carries a run id keeps it', async () => {
    const path = freshPath();
    const ev = makeRunEvents(path);
    ev.emit(line('group-1@2026-11-14T02:00:00.000Z', 'reports'));
    ev.emitBare({ groupId: 'group-1@2026-11-14T01:00:00.000Z', step: 'proof', state: 'done' });
    await ev.idle();
    expect(read(path).at(-1)!.groupId).toBe('group-1@2026-11-14T01:00:00.000Z');
  });

  it('an unwritable path is logged once and nothing throws', async () => {
    const blocker = join(dir, 'a-file');
    writeFileSync(blocker, 'not a folder');
    const logs: string[] = [];
    const ev = makeRunEvents(join(blocker, 'events.jsonl'), (l) => logs.push(l));
    ev.emit(line('group-1@2026-11-14T01:00:00.000Z', 'reports'));
    ev.emitBare({ groupId: 'group-1', step: 'proof', state: 'done' });
    await ev.idle();
    expect(logs.filter((l) => l.startsWith('[events]'))).toHaveLength(1);
  });
});

describe('newestRunId', () => {
  it('reads from the end, skips lines that are not JSON, and never throws', () => {
    const path = freshPath();
    writeFileSync(path, [JSON.stringify(line('group-1@a', 'reports')), 'not json', JSON.stringify(line('group-1@b', 'reports')), '{"groupId":7}', '', ''].join('\r\n'));
    expect(newestRunId(path, 'group-1')).toBe('group-1@b');
    expect(newestRunId(path, 'group-3')).toBeNull();
    expect(newestRunId(path, '')).toBeNull();
    expect(newestRunId(join(dir, 'no-such-file.jsonl'), 'group-1')).toBeNull();
  });
});
