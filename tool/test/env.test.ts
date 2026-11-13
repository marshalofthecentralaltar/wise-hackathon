import { describe, expect, it } from 'vitest';
import { buildChildEnv, readEnv, strippedNames } from '../src/env.js';
import { claudeArgs } from '../src/fix.js';

// The CLAUDE* names seen in this agent's own shell on 13 Nov 2026, plus the keys.
const parent: NodeJS.ProcessEnv = {
  PATH: 'C:\\Windows',
  USERPROFILE: 'C:\\Users\\someone',
  GH_HOST: 'github.com',
  ANTHROPIC_API_KEY: 'sk-ant-should-not-pass',
  GROUPING_ANTHROPIC_KEY: 'sk-ant-grouping',
  anthropic_api_key: 'lower-case-variant', // Windows names are case-insensitive
  SLACK_BOT_TOKEN: 'xoxb-x',
  SLACK_APP_TOKEN: 'xapp-x',
  CLAUDECODE: '1',
  CLAUDE_CODE_ENTRYPOINT: 'cli',
  CLAUDE_CODE_SESSION_ID: 'abc',
  CLAUDE_CODE_CHILD_SESSION: '1',
  CLAUDE_CODE_SUBAGENT_MODEL: 'opus',
  CLAUDE_CODE_MESSAGING_SOCKET: 'x',
  CLAUDE_CODE_MESSAGING_TOKEN: 'x',
  CLAUDE_CODE_SESSION_ATTENDED: '1',
  CLAUDE_CODE_EXECPATH: 'x',
  CLAUDE_PID: '123',
  CLAUDE_EFFORT: 'high',
  Claude_Mixed_Case: 'x',
};

describe('buildChildEnv', () => {
  const child = buildChildEnv(parent);
  const names = Object.keys(child);

  it('drops both Anthropic keys, in any case', () => {
    expect(names.some((n) => n.toUpperCase() === 'ANTHROPIC_API_KEY')).toBe(false);
    expect(names.some((n) => n.toUpperCase() === 'GROUPING_ANTHROPIC_KEY')).toBe(false);
    expect(Object.values(child).some((v) => String(v).startsWith('sk-ant'))).toBe(false);
  });

  it('drops every CLAUDE* variable', () => {
    expect(names.filter((n) => n.toUpperCase().startsWith('CLAUDE'))).toEqual([]);
  });

  it('drops the Slack tokens', () => {
    expect(names.filter((n) => n.startsWith('SLACK_'))).toEqual([]);
  });

  it('keeps everything else unchanged', () => {
    expect(child).toEqual({ PATH: 'C:\\Windows', USERPROFILE: 'C:\\Users\\someone', GH_HOST: 'github.com' });
  });

  it('does not modify the parent', () => {
    expect(parent.ANTHROPIC_API_KEY).toBe('sk-ant-should-not-pass');
    expect(parent.CLAUDECODE).toBe('1');
  });

  it('is applied to the real process env too', () => {
    const real = buildChildEnv({ ...process.env, ANTHROPIC_API_KEY: 'x', GROUPING_ANTHROPIC_KEY: 'y', CLAUDECODE: '1' });
    expect(Object.keys(real).filter((n) => /^(CLAUDE|ANTHROPIC_API_KEY$|GROUPING_ANTHROPIC_KEY$)/i.test(n))).toEqual([]);
  });

  it('reports the stripped names', () => {
    expect(strippedNames(parent)).toContain('CLAUDECODE');
    expect(strippedNames(parent)).not.toContain('PATH');
  });
});

describe('readEnv', () => {
  it('defaults the fix model to sonnet and honours FIX_MODEL', () => {
    expect(readEnv({}).fixModel).toBe('sonnet');
    expect(readEnv({ FIX_MODEL: 'haiku' }).fixModel).toBe('haiku');
    expect(readEnv({}).slackBotToken).toBe('');
  });
});

describe('claudeArgs', () => {
  const args = claudeArgs('sonnet');
  it('never skips permissions and never asks', () => {
    expect(args).not.toContain('--dangerously-skip-permissions');
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('dontAsk');
    expect(args[args.indexOf('--permission-prompts') + 1]).toBe('none');
  });
});
