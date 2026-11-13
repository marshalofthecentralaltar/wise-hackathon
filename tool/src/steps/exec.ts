// The one way steps 2 to 5 start a child process (claude, gh). It goes through run() in
// fix.ts, which builds the child's environment with buildChildEnv: no Anthropic key, no
// Slack token and no CLAUDE* variable reaches the child.
import { tmpdir } from 'node:os';
import { resolveClaudeExecutable, run, parseClaudeJson } from '../fix.js';

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Starts cmd with args, the prompt (if any) on stdin, in a neutral folder. Never throws. */
export async function spawnTool(cmd: string, args: string[], opts: { input?: string; timeoutMs?: number; cwd?: string } = {}): Promise<ExecResult> {
  try {
    return await run(cmd, args, { cwd: opts.cwd ?? tmpdir(), timeoutMs: opts.timeoutMs ?? 60_000, input: opts.input });
  } catch (err) {
    return { code: -1, stdout: '', stderr: String(err), timedOut: false };
  }
}

export class GhError extends Error {}

/** `gh api <path>` parsed as JSON. Throws GhError with gh's own message on failure. */
export async function ghApi<T = unknown>(path: string, timeoutMs = 30_000): Promise<T> {
  // spawnTool passes args without a shell, so a leading / is never rewritten by Git Bash.
  const r = await spawnTool('gh', ['api', '-H', 'Accept: application/vnd.github+json', path], { timeoutMs });
  if (r.code !== 0) throw new GhError(`gh api ${path} failed (${r.timedOut ? 'timed out' : `exit ${r.code}`}): ${(r.stderr || r.stdout).trim().slice(0, 300)}`);
  try {
    return JSON.parse(r.stdout) as T;
  } catch {
    throw new GhError(`gh api ${path} did not return JSON`);
  }
}

export interface ClaudeAnswer {
  ok: boolean;
  text: string;
  error?: string;
  seconds: number;
}

export function claudeAnswerArgs(model: string, systemPrompt: string): string[] {
  return [
    '-p',
    '--model', model,
    '--safe-mode',
    '--strict-mcp-config',
    '--no-session-persistence',
    '--tools', '', // no tools at all: the model only reads the prompt and answers
    '--permission-mode', 'dontAsk',
    '--permission-prompts', 'none',
    '--system-prompt', systemPrompt,
    '--max-turns', '2',
    '--output-format', 'json',
  ];
}

/** One `claude -p` call that only answers in text. Never throws. */
export async function askClaude(prompt: string, systemPrompt: string, model: string, timeoutMs = 60_000): Promise<ClaudeAnswer> {
  const t0 = performance.now();
  const seconds = () => Math.round((performance.now() - t0) / 100) / 10;
  let exe: string;
  try {
    exe = resolveClaudeExecutable();
  } catch (err) {
    return { ok: false, text: '', error: String(err), seconds: seconds() };
  }
  const r = await spawnTool(exe, claudeAnswerArgs(model, systemPrompt), { input: prompt, timeoutMs });
  const info = parseClaudeJson(r.stdout);
  if (r.timedOut) return { ok: false, text: info.result, error: `claude did not answer in ${timeoutMs / 1000} s`, seconds: seconds() };
  if (r.code !== 0 || info.isError) {
    return { ok: false, text: info.result, error: `claude exit ${r.code}: ${(info.result || r.stderr).slice(0, 300)}`, seconds: seconds() };
  }
  return { ok: true, text: info.result, seconds: seconds() };
}
