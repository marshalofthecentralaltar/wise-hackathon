// One way to run `claude -p` for a single question: prompt on stdin, the real .exe on Windows,
// no user customisations, tools limited, answer as structured JSON. Used by the investigation
// (step 6) and the text-only customer-effect check (step 7).

import { parseClaudeJson, runModel, type ClaudeRunInfo } from './fix.js';

export interface ClaudeQuestion {
  prompt: string;
  cwd: string;
  model: string;
  /** Built-in tools that exist in the session at all; [] for none. */
  tools: string[];
  /** Tools that run without asking. With dontAsk, everything else is refused at once. */
  allowedTools?: string[];
  /** Refused even when an allowed pattern matches. */
  disallowedTools?: string[];
  maxTurns: number;
  /** JSON Schema the final answer must match; the CLI validates it. */
  jsonSchema: object;
  timeoutMs: number;
  effort?: 'low' | 'medium' | 'high';
  /**
   * Confine Read, Glob, Grep and Edit to cwd with the CLI's own --restricted mode. Measured on
   * 13 Nov (CLI 2.1.323): --restricted refuses a Read outside cwd; a path rule such as
   * `Read(./**)` in --allowedTools does not (the decoy file outside cwd was read). The
   * investigation and the fix step turn it on.
   */
  confineToCwd?: boolean;
}

export interface ClaudeAnswer {
  /** The structured answer, or null when there is none. */
  answer: unknown;
  info: ClaudeRunInfo;
  timedOut: boolean;
  seconds: number;
  /** Tail of stdout and stderr, for a failure message. */
  rawTail: string;
  /** All of stdout and stderr. */
  raw: string;
}


export function questionArgs(q: Omit<ClaudeQuestion, 'prompt' | 'cwd' | 'timeoutMs'>): string[] {
  const args = [
    '-p',
    '--model', q.model,
    // No user CLAUDE.md, hooks, plugins, skills or MCP servers (hooks cost about 3 s and inject text).
    '--safe-mode',
    '--strict-mcp-config',
    '--no-session-persistence',
    '--tools', q.tools.join(','),
    '--permission-mode', 'dontAsk',
    '--permission-prompts', 'none',
  ];
  if (q.confineToCwd) args.push('--restricted');
  if (q.allowedTools?.length) args.push('--allowedTools', ...q.allowedTools);
  if (q.disallowedTools?.length) args.push('--disallowedTools', ...q.disallowedTools);
  if (q.effort) args.push('--effort', q.effort);
  args.push('--max-turns', String(q.maxTurns), '--output-format', 'json', '--json-schema', JSON.stringify(q.jsonSchema));
  return args;
}

/** The `structured_output` of the result message, else the result text parsed as JSON. */
export function extractStructured(stdout: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  const messages = (Array.isArray(parsed) ? parsed : [parsed]) as Record<string, unknown>[];
  const res = messages.find((m) => m?.type === 'result');
  if (!res) return null;
  if (res.structured_output !== undefined && res.structured_output !== null) return res.structured_output;
  if (typeof res.result === 'string') {
    const text = res.result.trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

export async function askClaude(q: ClaudeQuestion): Promise<ClaudeAnswer> {
  const t0 = performance.now();
  // runModel: the cached executable, resolved again and retried once when the model fails to start.
  const r = await runModel(questionArgs(q), { cwd: q.cwd, timeoutMs: q.timeoutMs, input: q.prompt });
  const info = parseClaudeJson(r.stdout);
  info.exitCode = r.code;
  const raw = r.stdout + '\n' + r.stderr;
  return {
    answer: r.code === 0 && !info.isError ? extractStructured(r.stdout) : null,
    info,
    timedOut: r.timedOut,
    seconds: Math.round((performance.now() - t0) / 100) / 10,
    rawTail: raw.length > 3000 ? '...' + raw.slice(-3000) : raw,
    raw,
  };
}
