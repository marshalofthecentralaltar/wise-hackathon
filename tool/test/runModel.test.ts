import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { askClaude as askQuestion } from '../src/claude.js';
import { runModel, setModelLauncherResolver, writeFixPullRequest } from '../src/fix.js';
import { askClaude as askText } from '../src/steps/exec.js';
import { newRepo, writeAndCommit } from './gitRepo.js';

const FLAKY = fileURLToPath(new URL('./helpers/flakyModel.mjs', import.meta.url));
const dirs: string[] = [];
function stateFile(): string {
  const d = mkdtempSync(join(tmpdir(), 'runmodel-'));
  dirs.push(d);
  return join(d, 'starts.txt');
}
const starts = (state: string) => (existsSync(state) ? readFileSync(state, 'utf8').split('\n').filter(Boolean).length : 0);
const flaky = (mode: string, state: string) => () => ({ cmd: process.execPath, prefixArgs: [FLAKY, mode, state] });

afterEach(() => {
  setModelLauncherResolver();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true, maxRetries: 5 });
});

describe('a model that fails to start is resolved again and retried once', () => {
  it('the fix runner (writeFixPullRequest): first start fails, the retry edits, the run goes on to its next stage', async () => {
    const state = stateFile();
    setModelLauncherResolver(flaky('fail-once', state));
    const { dir, cleanup } = newRepo('runmodel-fix-');
    try {
      writeAndCommit(dir, { 'package.json': '{"name":"t"}', 'a.txt': 'a\n' }, 'base');
      const r = await writeFixPullRequest({ repo: 'o/r', reportText: 'x', model: 'sonnet', copyDir: dir, baseBranch: 'main', prompt: 'p', allowFile: () => false });
      expect(starts(state)).toBe(2);
      expect(r.ok).toBe(false);
      // Past the model: the guard saw the retry's change. Without the retry it would stop at 'claude'.
      expect(r.ok === false && r.stage).toBe('guard');
      expect(r.ok === false && r.filesChanged).toEqual(['changed.txt']);
    } finally {
      cleanup();
    }
  }, 60_000);

  it('the question runner (claude.ts askClaude): structured answer after one retry', async () => {
    const state = stateFile();
    setModelLauncherResolver(flaky('fail-once', state));
    const a = await askQuestion({ prompt: 'p', cwd: tmpdir(), model: 'haiku', tools: [], maxTurns: 1, jsonSchema: {}, timeoutMs: 30_000 });
    expect(starts(state)).toBe(2);
    expect(a.answer).toEqual({ customerEffect: 'appearance' });
  }, 30_000);

  it('the text runner (steps/exec.ts askClaude): ok after one retry', async () => {
    const state = stateFile();
    setModelLauncherResolver(flaky('fail-once', state));
    const a = await askText('p', 'system', 'haiku', 30_000);
    expect(starts(state)).toBe(2);
    expect(a.ok).toBe(true);
    expect(a.text).toContain('appearance');
  }, 30_000);

  it('the cached path is resolved again after a failure, and kept after a success', async () => {
    const state = stateFile();
    let resolved = 0;
    setModelLauncherResolver(() => {
      resolved++;
      // The first path is gone, as when the CLI replaces its executable.
      return resolved === 1 ? { cmd: join(tmpdir(), 'no-such-dir', 'claude.exe'), prefixArgs: [] } : flaky('fail-once', state)();
    });
    // The stand-in that answers has already been started once elsewhere, so it answers at once.
    writeFileSync(state, 'start 0\n');
    const r1 = await runModel([], { cwd: tmpdir(), timeoutMs: 30_000, retryDelayMs: 10 });
    expect(r1.attempts).toBe(2);
    expect(r1.retriedBecause).toMatch(/exit -1/);
    expect(r1.code).toBe(0);
    expect(resolved).toBe(2);
    const r2 = await runModel([], { cwd: tmpdir(), timeoutMs: 30_000, retryDelayMs: 10 });
    expect(r2.attempts).toBe(1);
    expect(r2.code).toBe(0);
    expect(resolved).toBe(2);
  }, 30_000);

  it('a timeout is not retried', async () => {
    const state = stateFile();
    setModelLauncherResolver(flaky('hang', state));
    const r = await runModel([], { cwd: tmpdir(), timeoutMs: 1_500, retryDelayMs: 10 });
    expect(r.timedOut).toBe(true);
    expect(r.attempts).toBe(1);
    expect(starts(state)).toBe(1);
  }, 30_000);

  it('a non-zero exit after real work (output on stdout) is not retried', async () => {
    const state = stateFile();
    setModelLauncherResolver(flaky('error-after-work', state));
    const r = await runModel([], { cwd: tmpdir(), timeoutMs: 30_000, retryDelayMs: 10 });
    expect(r.code).toBe(1);
    expect(r.attempts).toBe(1);
    expect(starts(state)).toBe(1);
  }, 30_000);
});
