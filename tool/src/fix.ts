import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { buildChildEnv } from './env.js';

export type Stage = 'clone' | 'claude' | 'diff' | 'test' | 'push' | 'pr';

export interface StageSeconds {
  clone: number;
  claude: number;
  test: number;
  push: number;
  pr: number;
  total: number;
}

export interface FixSuccess {
  ok: true;
  prUrl: string;
  branch: string;
  seconds: StageSeconds;
  filesChanged: string[];
  claudeSummary: string;
  claudeTurns: number | null;
}

export interface FixFailure {
  ok: false;
  stage: Stage;
  message: string;
  output: string;
  seconds: StageSeconds;
  branch?: string;
  workdir: string;
}

export type FixResult = FixSuccess | FixFailure;

export interface FixInput {
  /** owner/name on GitHub */
  repo: string;
  reportText: string;
  /** claude --model value; an alias such as sonnet, opus, haiku */
  model: string;
  /** called as each stage finishes; for live logs */
  onStage?: (stage: Stage, seconds: number) => void;
}

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

const NETWORK_TIMEOUT_MS = 60_000;
const CLAUDE_TIMEOUT_MS = 300_000;
const TEST_TIMEOUT_MS = 120_000;

function run(
  cmd: string,
  args: string[],
  opts: { cwd: string; timeoutMs: number; input?: string; shell?: boolean },
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: buildChildEnv(process.env),
      shell: opts.shell ?? false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, opts.timeoutMs);
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr + String(err), timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
    // Nobody is there to answer: stdin carries the prompt (or nothing) and is closed.
    child.stdin.end(opts.input ?? '');
  });
}

/**
 * On Windows `claude` is a .cmd shim, which Node will not spawn without a shell. Spawn the
 * real executable behind the shim instead, so arguments need no shell quoting.
 */
export function resolveClaudeExecutable(): string {
  const override = process.env.CLAUDE_BIN_PATH_FOR_TOOL;
  if (override) return override;
  if (process.platform !== 'win32') return 'claude';
  const where = spawnSync('where', ['claude'], { encoding: 'utf8', windowsHide: true });
  const hits = (where.stdout ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const exe = hits.find((h) => h.toLowerCase().endsWith('.exe'));
  if (exe) return exe;
  for (const hit of hits) {
    const candidate = join(dirname(hit), 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('claude executable not found on PATH');
}

/** Tools Claude may use in the clone. Everything else is denied without a prompt (dontAsk). */
export const CLAUDE_ALLOWED_TOOLS = [
  'Read',
  'Edit',
  'Glob',
  'Grep',
  'Bash(npm test*)',
  'Bash(npm run test*)',
  'Bash(node --test*)',
];

export function claudeArgs(model: string): string[] {
  return [
    '-p',
    '--model', model,
    // No user/project CLAUDE.md, hooks, plugins, skills or MCP servers: measured 2.8-3.3 s
    // per trivial call against 6.2-6.6 s without, and no hook can inject text or block a stop.
    '--safe-mode',
    '--strict-mcp-config',
    '--no-session-persistence',
    // Only these built-in tools exist in the session at all.
    '--tools', 'Read,Edit,Glob,Grep,Bash',
    // dontAsk: anything not pre-allowed is denied, never asked.
    '--permission-mode', 'dontAsk',
    '--permission-prompts', 'none',
    '--allowedTools', ...CLAUDE_ALLOWED_TOOLS,
    '--max-turns', '15',
    '--output-format', 'json',
  ];
}

export function buildFixPrompt(reportText: string): string {
  return [
    'A customer reported this problem through our support channel:',
    '',
    '<report>',
    reportText.trim(),
    '</report>',
    '',
    'You are in a fresh clone of the code. Find the cause and make the smallest code change that fixes the reported problem.',
    'Do not add dependencies, do not edit package files, and do not commit or create branches; the caller does that.',
    'Then run the tests with `npm test` and check that they pass.',
    'End with one line: the file you changed and what you changed.',
  ].join('\n');
}

const secondsSince = (t0: number) => Math.round((performance.now() - t0) / 100) / 10;

function tail(text: string, max = 4000): string {
  return text.length > max ? '...' + text.slice(-max) : text;
}

export function makeBranchName(now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  return `fix/report-${stamp}-${randomBytes(3).toString('hex')}`;
}

export async function writeFixPullRequest(input: FixInput): Promise<FixResult> {
  const { repo, reportText, model, onStage } = input;
  const seconds: StageSeconds = { clone: 0, claude: 0, test: 0, push: 0, pr: 0, total: 0 };
  const tStart = performance.now();
  const workdir = await mkdtemp(join(tmpdir(), 'fix-'));
  const cwd = join(workdir, 'repo');
  const done = (stage: Stage, t0: number) => {
    const s = secondsSince(t0);
    if (stage !== 'diff') seconds[stage] = s;
    onStage?.(stage, s);
  };
  const fail = (stage: Stage, message: string, output: string, branch?: string): FixFailure => {
    seconds.total = secondsSince(tStart);
    return { ok: false, stage, message, output: tail(output), seconds, branch, workdir };
  };

  // 1. Fresh shallow clone in a new temp folder.
  let t0 = performance.now();
  const clone = await run('git', ['clone', '--depth', '1', `https://github.com/${repo}.git`, cwd], {
    cwd: workdir,
    timeoutMs: NETWORK_TIMEOUT_MS,
  });
  if (clone.code !== 0) return fail('clone', 'git clone failed', clone.stderr + clone.stdout);
  const base = (await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, timeoutMs: 10_000 })).stdout.trim();
  done('clone', t0);

  // 2. Claude Code writes the fix.
  t0 = performance.now();
  const claude = await run(resolveClaudeExecutable(), claudeArgs(model), {
    cwd,
    timeoutMs: CLAUDE_TIMEOUT_MS,
    input: buildFixPrompt(reportText),
  });
  done('claude', t0);
  let claudeSummary = '';
  let claudeTurns: number | null = null;
  try {
    const parsed = JSON.parse(claude.stdout) as { result?: string; num_turns?: number; is_error?: boolean };
    claudeSummary = (parsed.result ?? '').trim();
    claudeTurns = parsed.num_turns ?? null;
    if (parsed.is_error) return fail('claude', 'claude reported an error', claude.stdout + claude.stderr);
  } catch {
    // fall through to the exit-code check
  }
  if (claude.timedOut) return fail('claude', `claude did not finish in ${CLAUDE_TIMEOUT_MS / 1000} s`, claude.stdout + claude.stderr);
  if (claude.code !== 0) return fail('claude', `claude exited with ${claude.code}`, claude.stdout + claude.stderr);

  // 3. The tool, not Claude, checks there is a change.
  t0 = performance.now();
  const status = await run('git', ['status', '--porcelain'], { cwd, timeoutMs: 10_000 });
  const filesChanged = status.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => l.slice(3).trim());
  done('diff', t0);
  if (filesChanged.length === 0) return fail('diff', 'Claude changed nothing', claudeSummary || claude.stdout);

  // 4. The tool runs the repository's own tests.
  t0 = performance.now();
  const pkg = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
  const testCmd = pkg.scripts?.test ? 'npm test' : 'node --test';
  const test = await run(testCmd, [], { cwd, timeoutMs: TEST_TIMEOUT_MS, shell: true });
  done('test', t0);
  if (test.code !== 0) return fail('test', `tests failed (${testCmd} exited with ${test.code})`, test.stdout + test.stderr);

  // 5. Commit on a new uniquely named branch and push.
  t0 = performance.now();
  const branch = makeBranchName();
  const title = `Fix: ${firstLine(reportText)}`;
  for (const args of [
    ['checkout', '-q', '-b', branch],
    ['add', '-A'],
    ['commit', '-q', '-m', title, '-m', `Written by Claude Code (model: ${model}) from a customer report. Tests run by the tool: ${testCmd}.`],
  ]) {
    const r = await run('git', args, { cwd, timeoutMs: 10_000 });
    if (r.code !== 0) return fail('push', `git ${args[0]} failed`, r.stderr + r.stdout, branch);
  }
  const push = await run('git', ['push', '-q', '-u', 'origin', branch], { cwd, timeoutMs: NETWORK_TIMEOUT_MS });
  done('push', t0);
  if (push.code !== 0) return fail('push', 'git push failed', push.stderr + push.stdout, branch);

  // 6. Open the pull request.
  t0 = performance.now();
  const body = [
    'A customer reported:',
    '',
    ...reportText.trim().split(/\r?\n/).map((l) => `> ${l}`),
    '',
    `Claude Code (model: ${model}) wrote this change in a fresh clone. The tool checked the diff and ran \`${testCmd}\`: passing.`,
    '',
    `Claude's note: ${claudeSummary || '(none)'}`,
    '',
    `Files changed: ${filesChanged.join(', ')}`,
  ].join('\n');
  const pr = await run('gh', ['pr', 'create', '-R', repo, '--head', branch, '--base', base || 'main', '--title', title, '--body', body], {
    cwd,
    timeoutMs: NETWORK_TIMEOUT_MS,
  });
  done('pr', t0);
  const prUrl = pr.stdout.match(/https:\/\/github\.com\/\S+\/pull\/\d+/)?.[0];
  if (pr.code !== 0 || !prUrl) return fail('pr', 'gh pr create failed', pr.stderr + pr.stdout, branch);

  seconds.total = secondsSince(tStart);
  await rm(workdir, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
  return { ok: true, prUrl, branch, seconds, filesChanged, claudeSummary, claudeTurns };
}

function firstLine(text: string): string {
  const line = text.trim().split(/\r?\n/)[0] ?? '';
  const sentence = line.split(/(?<=[.!?])\s/)[0] ?? line;
  return sentence.length > 72 ? sentence.slice(0, 69) + '...' : sentence;
}
