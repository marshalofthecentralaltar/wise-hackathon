// Every claude and gh child of steps 2 to 5 starts through spawnTool, which goes through run()
// in fix.ts and so through buildChildEnv. This starts a real child through that same path and
// reads back the environment it got.
import { afterEach, describe, expect, it } from 'vitest';
import { claudeAnswerArgs, spawnTool } from '../src/steps/exec.js';

const planted = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'GROUPING_ANTHROPIC_KEY', 'SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN', 'CLAUDE_TEST_MARKER'];

afterEach(() => {
  for (const name of planted) delete process.env[name];
  delete process.env.KEEP_ME_FOR_TEST;
});

describe('spawnTool', () => {
  it('gives the child no key, no Slack token and no CLAUDE* variable', async () => {
    for (const name of planted) process.env[name] = 'secret-value';
    process.env.KEEP_ME_FOR_TEST = 'kept';
    const r = await spawnTool(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(process.env))'], { timeoutMs: 20_000 });
    expect(r.code).toBe(0);
    const childEnv = JSON.parse(r.stdout) as Record<string, string>;
    const upper = Object.keys(childEnv).map((k) => k.toUpperCase());
    for (const name of planted) expect(upper).not.toContain(name);
    expect(upper.filter((k) => k.startsWith('CLAUDE'))).toEqual([]);
    expect(childEnv.KEEP_ME_FOR_TEST).toBe('kept');
    expect(r.stdout).not.toContain('secret-value');
  });

  it('passes the prompt on stdin and never throws on a missing command', async () => {
    const echo = await spawnTool(process.execPath, ['-e', 'process.stdin.pipe(process.stdout)'], { input: 'hello', timeoutMs: 20_000 });
    expect(echo.stdout).toBe('hello');
    const missing = await spawnTool('no-such-command-xyz', [], { timeoutMs: 5_000 });
    expect(missing.code).not.toBe(0);
  });
});

describe('claudeAnswerArgs', () => {
  it('runs without tools, in safe mode, and never skips permissions or uses --bare', () => {
    const args = claudeAnswerArgs('haiku', 'system');
    expect(args).toContain('--safe-mode');
    expect(args[args.indexOf('--tools') + 1]).toBe('');
    expect(args[args.indexOf('--model') + 1]).toBe('haiku');
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('dontAsk');
    expect(args).not.toContain('--bare');
    expect(args.join(' ')).not.toContain('dangerously');
  });
});
