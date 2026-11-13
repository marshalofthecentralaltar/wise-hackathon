// The secrets file: loaded without overwriting a set variable; a missing file is named, and the
// entry point then exits on its empty tokens as before.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadSecretsInto, missingSecretsMessage } from '../src/secrets.js';

const dir = mkdtempSync(join(tmpdir(), 'secrets-test-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('loadSecretsInto', () => {
  it('fills names from the file and keeps a variable already set', () => {
    const file = join(dir, 'secrets.env');
    writeFileSync(file, 'SLACK_BOT_TOKEN=from-file-bot\r\nSLACK_APP_TOKEN=from-file-app\r\nEMPTY_ONE=\r\n');
    const env: NodeJS.ProcessEnv = { SLACK_BOT_TOKEN: 'set-before' };
    const r = loadSecretsInto(env, file);
    expect(env.SLACK_BOT_TOKEN).toBe('set-before');
    expect(env.SLACK_APP_TOKEN).toBe('from-file-app');
    expect(env.EMPTY_ONE).toBe('');
    expect({ ...r, loaded: [...r.loaded].sort() }).toEqual({ file, found: true, loaded: ['EMPTY_ONE', 'SLACK_APP_TOKEN'], kept: ['SLACK_BOT_TOKEN'] });
  });

  it('a variable set to an empty string still wins', () => {
    const file = join(dir, 'secrets2.env');
    writeFileSync(file, 'SLACK_BOT_TOKEN=from-file\n');
    const env: NodeJS.ProcessEnv = { SLACK_BOT_TOKEN: '' };
    loadSecretsInto(env, file);
    expect(env.SLACK_BOT_TOKEN).toBe('');
  });

  it('a missing file changes nothing and is reported by path', () => {
    const file = join(dir, 'nope.env');
    const env: NodeJS.ProcessEnv = {};
    expect(loadSecretsInto(env, file)).toEqual({ file, found: false, loaded: [], kept: [] });
    expect(env).toEqual({});
    expect(missingSecretsMessage(file)).toContain(file);
  });
});

describe('npm run thin with no secrets file', () => {
  it('names the file it looked for and exits 2 on the empty tokens, as before', () => {
    const missing = join(dir, 'absent', 'secrets.env');
    const env: NodeJS.ProcessEnv = { ...process.env, WISE_SECRETS_FILE: missing };
    for (const name of Object.keys(env)) if (/^SLACK_/i.test(name)) delete env[name];
    const toolDir = resolve(__dirname, '..');
    const r = spawnSync(process.execPath, [join(toolDir, 'node_modules', 'tsx', 'dist', 'cli.mjs'), '--import', './src/loadSecrets.ts', 'src/thin.ts', '--check'], {
      cwd: toolDir,
      env,
      encoding: 'utf8',
      timeout: 60_000,
    });
    expect(r.stderr).toContain(`no secrets file at ${missing.split(sep).join('/')}`);
    expect(r.stderr).toContain('Empty in the env file: SLACK_BOT_TOKEN, SLACK_APP_TOKEN');
    expect(r.status).toBe(2);
  });
});
