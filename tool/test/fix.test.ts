import { describe, expect, it } from 'vitest';
import { tmpdir } from 'node:os';
import { commitArgs, run, toolGitIdentity } from '../src/fix.js';

describe('commit identity', () => {
  it('defaults to the tool identity, never the machine owner', () => {
    expect(toolGitIdentity({})).toEqual({
      name: 'Demo Bank Triage',
      email: '195171080+marshalofthecentralaltar@users.noreply.github.com',
    });
  });

  it('honours TOOL_GIT_NAME and TOOL_GIT_EMAIL', () => {
    expect(toolGitIdentity({ TOOL_GIT_NAME: 'Bot', TOOL_GIT_EMAIL: 'bot@example.invalid' })).toEqual({
      name: 'Bot',
      email: 'bot@example.invalid',
    });
  });

  it('passes the identity on the commit command itself', () => {
    const args = commitArgs('Fix: x', 'body', toolGitIdentity({}));
    expect(args.slice(0, 5)).toEqual([
      '-c',
      'user.name=Demo Bank Triage',
      '-c',
      'user.email=195171080+marshalofthecentralaltar@users.noreply.github.com',
      'commit',
    ]);
    expect(args).not.toContain('--global');
    expect(args).not.toContain('config');
  });
});

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe('run on timeout', () => {
  it('kills the child and the grandchild it started', async () => {
    // Parent prints its own pid and its child's pid, then both sleep for 60 s.
    const parentScript = [
      "const { spawn } = require('node:child_process');",
      "const c = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });",
      "console.log(process.pid + ' ' + c.pid);",
      'setTimeout(() => {}, 60000);',
    ].join('\n');
    const t0 = Date.now();
    const r = await run(process.execPath, ['-e', parentScript], { cwd: tmpdir(), timeoutMs: 500 });
    const elapsed = Date.now() - t0;
    expect(r.timedOut).toBe(true);
    expect(elapsed).toBeLessThan(5_000);
    const [parentPid, childPid] = r.stdout.trim().split(' ').map(Number);
    expect(parentPid).toBeGreaterThan(0);
    expect(childPid).toBeGreaterThan(0);
    await new Promise((res) => setTimeout(res, 300));
    expect(alive(parentPid as number)).toBe(false);
    expect(alive(childPid as number)).toBe(false);
  }, 10_000);
});
