// The events file: one JSON line per step start and finish of a run, with the evidence the step
// found. The process screen (issue #20, `trace/`) reads it live. Writing it must never change a
// run: lines are appended in call order on one chain, the caller never awaits a write, and a
// failed write is logged once and swallowed.
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
