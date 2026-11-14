// The events file: one JSON line per step start and finish of a run, with the evidence the step
// found. The process screen (issue #20, `trace/`) reads it live. Writing it must never change a
// run: lines are appended in call order on one chain, the caller never awaits a write, and a
// failed write is logged once and swallowed.
import { readFileSync } from 'node:fs';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ToolEvent {
  v: 1;
  /** ISO time the line was written. */
  at: string;
  /** `<group.id>@<startedAt>`: unique per run, because group ids restart when the tool restarts. */
  groupId: string;
  step: string;
  state: 'start' | 'done' | 'failed';
  seconds?: number;
  evidence?: unknown;
  error?: string;
}

/** emit appends one line; idle() resolves when every line emitted so far is written (or given up on). */
export type EventWriter = ((event: ToolEvent) => void) & { idle(): Promise<void> };

export const DEFAULT_EVENTS_PATH = fileURLToPath(new URL('../.state/events.jsonl', import.meta.url));

/** The events file: WISE_EVENTS_FILE when set, else tool/.state/events.jsonl beside timings.jsonl. */
export function eventsPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.WISE_EVENTS_FILE?.trim() || DEFAULT_EVENTS_PATH;
}

export function makeEventWriter(path: string, log: (line: string) => void = (m) => console.error(m)): EventWriter {
  let chain: Promise<void> = Promise.resolve();
  let dirReady = false;
  let warned = false;
  const warnOnce = (err: unknown) => {
    if (warned) return;
    warned = true;
    log(`[events] could not write ${path}: ${err instanceof Error ? err.message : String(err)}`);
  };
  const emit = (event: ToolEvent) => {
    let line: string;
    try {
      // Stringified now: the caller may change the objects the evidence came from later.
      line = JSON.stringify(event) + '\n';
    } catch (err) {
      warnOnce(err);
      return;
    }
    chain = chain
      .then(async () => {
        if (!dirReady) {
          await mkdir(dirname(path), { recursive: true });
          dirReady = true;
        }
        await appendFile(path, line, 'utf8');
      })
      .catch(warnOnce);
  };
  return Object.assign(emit, { idle: () => chain });
}

/** An event from outside the pipeline (the approval, the redeploy, the browser checks): it knows only the group's own id. */
export type BareEvent = Omit<ToolEvent, 'v' | 'at'>;

/** The run id (`<group.id>@<startedAt>`) on the newest line of the events file for a group id; null when no line has one. Never throws. */
export function newestRunId(path: string, bareGroupId: string): string | null {
  if (!bareGroupId) return null;
  let lines: string[];
  try {
    lines = readFileSync(path, 'utf8').split(/\r?\n/);
  } catch {
    return null;
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]!;
    if (!l.trim()) continue;
    try {
      const id = (JSON.parse(l) as { groupId?: unknown }).groupId;
      if (typeof id === 'string' && id.startsWith(`${bareGroupId}@`)) return id;
    } catch {
      // not a JSON line: skipped
    }
  }
  return null;
}

export interface RunEvents {
  /** For the pipeline: writes the line and remembers which run its group id belongs to. */
  emit: (e: ToolEvent) => void;
  /**
   * For code that knows only the group's own id (`group-1`): stamps the line and gives it the run id
   * of that group's newest run, so the process screen keeps it on the same run. The id comes from
   * what this process emitted, else from the events file (a script, or the tool after a restart);
   * when neither knows the group the bare id is kept. A line without a group id is not written.
   */
  emitBare: (e: BareEvent) => void;
  idle(): Promise<void>;
}

/** One writer for every emitter of a process, with the run id shared between them. */
export function makeRunEvents(path: string = eventsPath(), log?: (line: string) => void): RunEvents {
  const writer = makeEventWriter(path, log);
  const runIds = new Map<string, string>();
  return {
    emit: (e) => {
      const at = typeof e.groupId === 'string' ? e.groupId.indexOf('@') : -1;
      if (at > 0) runIds.set(e.groupId.slice(0, at), e.groupId);
      writer(e);
    },
    emitBare: (e) => {
      if (!e.groupId) return;
      const groupId = e.groupId.includes('@') ? e.groupId : (runIds.get(e.groupId) ?? newestRunId(path, e.groupId) ?? e.groupId);
      writer({ ...e, v: 1, at: new Date().toISOString(), groupId });
    },
    idle: () => writer.idle(),
  };
}
