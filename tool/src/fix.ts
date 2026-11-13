import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { buildChildEnv } from './env.js';

export type Stage = 'clone' | 'deps' | 'claude' | 'diff' | 'guard' | 'test' | 'push' | 'pr';

export interface StageSeconds {
  clone: number;
  /** Only when FixInput.prepare is given: from its start (alongside the model) to its end. */
  deps?: number;
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
  claude: ClaudeRunInfo;
}

export interface FixFailure {
  ok: false;
  stage: Stage;
  message: string;
  output: string;
  seconds: StageSeconds;
  branch?: string;
  workdir: string;
  claude?: ClaudeRunInfo;
  /** True when FixInput.signal stopped the run. */
  aborted?: boolean;
  /** Files the model changed, when it got that far. */
  filesChanged?: string[];
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

  // Optional fields for step 8 (src/fixStep.ts). The thin path passes none of them.
  /** A working copy the caller made (freshCopy): no clone, and the caller deletes it. */
  copyDir?: string;
  /** Base branch of the pull request when copyDir is given. */
  baseBranch?: string;
  /** Started alongside the model (for example linking dependencies); awaited before the tests. */
  prepare?: (cwd: string) => Promise<unknown>;
  /** Replaces buildFixPrompt(reportText). */
  prompt?: string;
  /** Replace the claude executable and claudeArgs(model); tests pass a stand-in model. */
  claudeCommand?: string;
  claudeArgs?: string[];
  /** A changed file this refuses stops the run before the tests (stage 'guard'): nothing is pushed. */
  allowFile?: (file: string) => boolean;
  /** Aborting stops the run while it has no tested fix (model, diff, tests); the model's process tree is killed. Ignored once the tests passed. */
  signal?: AbortSignal;
  /** Called with the model's process id when it starts. */
  onModelSpawn?: (pid: number) => void;
  branchName?: string;
  title?: string;
  body?: (info: { filesChanged: string[]; testCmd: string; claudeSummary: string }) => string;
  /** Replaces `gh pr create`; tests pass a stand-in. */
  createPullRequest?: (p: PullRequestRequest) => Promise<PullRequestResult>;
}

export interface PullRequestRequest {
  repo: string;
  head: string;
  base: string;
  title: string;
  body: string;
  cwd: string;
}
export type PullRequestResult = { ok: true; url: string; number: number | null } | { ok: false; output: string };

/** `gh pr create`, the default way a pull request is opened. */
export async function ghCreatePullRequest(p: PullRequestRequest): Promise<PullRequestResult> {
  const pr = await run('gh', ['pr', 'create', '-R', p.repo, '--head', p.head, '--base', p.base, '--title', p.title, '--body', p.body], {
    cwd: p.cwd,
    timeoutMs: NETWORK_TIMEOUT_MS,
  });
  const url = pr.stdout.match(/https:\/\/github\.com\/\S+\/pull\/\d+/)?.[0];
  if (pr.code !== 0 || !url) return { ok: false, output: pr.stderr + pr.stdout };
  return { ok: true, url, number: Number(url.split('/').pop()) || null };
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

/** Ends a process and every process it started. child.kill() on Windows ends only the top one. */
export function killTree(pid: number): void {
  if (process.platform === 'win32') {
    // Spawned without a shell, so no Git Bash path rewriting of /PID, /T, /F.
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL'); // the process group; run() starts children detached on POSIX
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
}

export function run(
  cmd: string,
  args: string[],
  opts: {
    cwd: string;
    timeoutMs: number;
    input?: string;
    shell?: boolean;
    /** Aborting kills the process tree at once; the result then has timedOut true. */
    signal?: AbortSignal;
    onSpawn?: (pid: number) => void;
  },
): Promise<RunResult> {
  return new Promise((resolve) => {
    if (opts.signal?.aborted) {
      resolve({ code: null, stdout: '', stderr: 'not started: aborted', timedOut: true });
      return;
    }
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: buildChildEnv(process.env),
      shell: opts.shell ?? false,
      windowsHide: true,
      detached: process.platform !== 'win32', // own process group, so the whole group can be killed
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const finish = (r: RunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(lastResort);
      opts.signal?.removeEventListener('abort', stop);
      resolve(r);
    };
    let lastResort: NodeJS.Timeout | undefined;
    const stop = () => {
      if (timedOut) return;
      timedOut = true;
      if (child.pid !== undefined) killTree(child.pid);
      // If a grandchild still holds the pipes, do not wait on 'close' forever.
      lastResort = setTimeout(() => finish({ code: null, stdout, stderr, timedOut }), 3_000);
    };
    const timer = setTimeout(stop, opts.timeoutMs);
    opts.signal?.addEventListener('abort', stop, { once: true });
    if (child.pid !== undefined) opts.onSpawn?.(child.pid);
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', (err) => finish({ code: -1, stdout, stderr: stderr + String(err), timedOut }));
    child.on('close', (code) => finish({ code, stdout, stderr, timedOut }));
    // Nobody is there to answer: stdin carries the prompt (or nothing) and is closed.
    child.stdin.end(opts.input ?? '');
  });
}

export interface GitIdentity {
  name: string;
  email: string;
}

/** The tool commits as itself, never as whoever owns the machine's global git config. */
export function toolGitIdentity(env: NodeJS.ProcessEnv = process.env): GitIdentity {
  return {
    name: env.TOOL_GIT_NAME?.trim() || 'Demo Bank Triage',
    email: env.TOOL_GIT_EMAIL?.trim() || '195171080+marshalofthecentralaltar@users.noreply.github.com',
  };
}

export function commitArgs(title: string, body: string, identity: GitIdentity): string[] {
  return ['-c', `user.name=${identity.name}`, '-c', `user.email=${identity.email}`, 'commit', '-q', '-m', title, '-m', body];
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
  const { repo, reportText, model, onStage, signal } = input;
  const seconds: StageSeconds = { clone: 0, claude: 0, test: 0, push: 0, pr: 0, total: 0 };
  const tStart = performance.now();
  const ownCopy = !input.copyDir;
  const workdir = input.copyDir ?? (await mkdtemp(join(tmpdir(), 'fix-')));
  const cwd = input.copyDir ?? join(workdir, 'repo');
  const done = (stage: Stage, t0: number) => {
    const s = secondsSince(t0);
    if (stage !== 'diff' && stage !== 'guard') seconds[stage] = s;
    onStage?.(stage, s);
  };
  let claudeRun: ClaudeRunInfo | undefined;
  let filesChanged: string[] | undefined;
  const fail = (stage: Stage, message: string, output: string, branch?: string): FixFailure => {
    seconds.total = secondsSince(tStart);
    return { ok: false, stage, message, output: tail(output), seconds, branch, workdir, claude: claudeRun, aborted: signal?.aborted === true, filesChanged };
  };
  const abortedAt = (stage: Stage) => fail(stage, `stopped: the time budget ran out during ${stage}`, '');

  // 1. Fresh shallow clone in a new temp folder (unless the caller made a copy).
  let t0 = performance.now();
  let base = input.baseBranch ?? '';
  if (ownCopy) {
    const clone = await run('git', ['clone', '--depth', '1', `https://github.com/${repo}.git`, cwd], {
      cwd: workdir,
      timeoutMs: NETWORK_TIMEOUT_MS,
    });
    if (clone.code !== 0) return fail('clone', 'git clone failed', clone.stderr + clone.stdout);
  }
  if (!base) base = (await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, timeoutMs: 10_000 })).stdout.trim();
  done('clone', t0);

  // Dependencies (or anything else the caller needs) run alongside the model.
  const tDeps = performance.now();
  const prepared: Promise<{ ok: true } | { ok: false; error: string }> | undefined = input.prepare
    ? input.prepare(cwd).then(
        () => {
          seconds.deps = secondsSince(tDeps);
          return { ok: true as const };
        },
        (err: unknown) => {
          seconds.deps = secondsSince(tDeps);
          return { ok: false as const, error: String(err) };
        },
      )
    : undefined;

  // 2. Claude Code writes the fix.
  t0 = performance.now();
  const claude = await run(input.claudeCommand ?? resolveClaudeExecutable(), input.claudeArgs ?? claudeArgs(model), {
    cwd,
    timeoutMs: CLAUDE_TIMEOUT_MS,
    input: input.prompt ?? buildFixPrompt(reportText),
    signal,
    onSpawn: input.onModelSpawn,
  });
  done('claude', t0);
  claudeRun = parseClaudeJson(claude.stdout);
  claudeRun.exitCode = claude.code;
  const claudeSummary = claudeRun.result;
  const claudeTurns = claudeRun.numTurns;
  if (signal?.aborted) {
    await prepared;
    return abortedAt('claude');
  }
  if (claudeRun.isError) return fail('claude', 'claude reported an error', claude.stdout + claude.stderr);
  if (claude.timedOut) return fail('claude', `claude did not finish in ${CLAUDE_TIMEOUT_MS / 1000} s`, claude.stdout + claude.stderr);
  if (claude.code !== 0) return fail('claude', `claude exited with ${claude.code}`, claude.stdout + claude.stderr);

  // 3. The tool, not Claude, checks there is a change.
  t0 = performance.now();
  const status = await run('git', ['status', '--porcelain', '-uall'], { cwd, timeoutMs: 10_000 });
  filesChanged = status.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((l) => l.slice(3).trim().split(' -> '))
    .map((f) => f.replace(/^"|"$/g, ''));
  done('diff', t0);
  if (filesChanged.length === 0) return fail('diff', 'Claude changed nothing', claudeSummary || claude.stdout);

  // 3b. Every changed file must be one the caller allows.
  if (input.allowFile) {
    t0 = performance.now();
    const refused = filesChanged.filter((f) => !input.allowFile!(f));
    done('guard', t0);
    if (refused.length) return fail('guard', `the change touches files outside the allowed folder: ${refused.join(', ')}`, status.stdout);
  }

  // 4. The tool runs the repository's own tests.
  if (prepared) {
    const p = await prepared;
    onStage?.('deps', seconds.deps ?? 0);
    if (!p.ok) return fail('deps', 'dependencies could not be prepared', p.error);
  }
  if (signal?.aborted) return abortedAt('test');
  t0 = performance.now();
  const pkg = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
  const testCmd = pkg.scripts?.test ? 'npm test' : 'node --test';
  const test = await run(testCmd, [], { cwd, timeoutMs: TEST_TIMEOUT_MS, shell: true, signal });
  done('test', t0);
  if (signal?.aborted && test.timedOut) return abortedAt('test');
  if (test.code !== 0) return fail('test', `tests failed (${testCmd} exited with ${test.code})`, test.stdout + test.stderr);

  // 5. Commit on a new uniquely named branch and push.
  t0 = performance.now();
  const branch = input.branchName ?? makeBranchName();
  const title = input.title ?? `Fix: ${firstLine(reportText)}`;
  for (const args of [
    ['checkout', '-q', '-b', branch],
    ['add', '-A'],
    commitArgs(title, `Written by Claude Code (model: ${model}) from a customer report. Tests run by the tool: ${testCmd}.`, toolGitIdentity()),
  ]) {
    const r = await run('git', args, { cwd, timeoutMs: 10_000 });
    if (r.code !== 0) return fail('push', `git ${args.join(' ').slice(0, 40)} failed`, r.stderr + r.stdout, branch);
  }
  const push = await run('git', ['push', '-q', '-u', 'origin', branch], { cwd, timeoutMs: NETWORK_TIMEOUT_MS });
  done('push', t0);
  if (push.code !== 0) return fail('push', 'git push failed', push.stderr + push.stdout, branch);

  // 6. Open the pull request.
  t0 = performance.now();
  const body = input.body
    ? input.body({ filesChanged, testCmd, claudeSummary })
    : [
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
  const pr = await (input.createPullRequest ?? ghCreatePullRequest)({ repo, head: branch, base: base || 'main', title, body, cwd });
  done('pr', t0);
  if (!pr.ok) return fail('pr', 'gh pr create failed', pr.output, branch);

  seconds.total = secondsSince(tStart);
  if (ownCopy) await rm(workdir, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
  return { ok: true, prUrl: pr.url, branch, seconds, filesChanged, claudeSummary, claudeTurns, claude: claudeRun };
}

export interface ClaudeRunInfo {
  exitCode: number | null;
  result: string;
  isError: boolean;
  numTurns: number | null;
  durationMs: number | null;
  /** from the init message: 'none' means the plan login was used, not an API key */
  apiKeySource: string | null;
  permissionMode: string | null;
  tools: string[];
  permissionDenials: unknown[];
}

/** `--output-format json` prints either the result object or an array of messages ending in it. */
export function parseClaudeJson(stdout: string): ClaudeRunInfo {
  const info: ClaudeRunInfo = {
    exitCode: null, result: '', isError: false, numTurns: null, durationMs: null,
    apiKeySource: null, permissionMode: null, tools: [], permissionDenials: [],
  };
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return info;
  }
  const messages = (Array.isArray(parsed) ? parsed : [parsed]) as Record<string, unknown>[];
  const init = messages.find((m) => m?.type === 'system' && m?.subtype === 'init');
  const res = messages.find((m) => m?.type === 'result') ?? (Array.isArray(parsed) ? undefined : messages[0]);
  if (init) {
    info.apiKeySource = typeof init.apiKeySource === 'string' ? init.apiKeySource : null;
    info.permissionMode = typeof init.permissionMode === 'string' ? init.permissionMode : null;
    info.tools = Array.isArray(init.tools) ? (init.tools as string[]) : [];
  }
  if (res) {
    info.result = typeof res.result === 'string' ? res.result.trim() : '';
    info.isError = res.is_error === true;
    info.numTurns = typeof res.num_turns === 'number' ? res.num_turns : null;
    info.durationMs = typeof res.duration_ms === 'number' ? res.duration_ms : null;
    info.permissionDenials = Array.isArray(res.permission_denials) ? res.permission_denials : [];
  }
  return info;
}

function firstLine(text: string): string {
  const line = text.trim().split(/\r?\n/)[0] ?? '';
  const sentence = line.split(/(?<=[.!?])\s/)[0] ?? line;
  return sentence.length > 72 ? sentence.slice(0, 69) + '...' : sentence;
}
