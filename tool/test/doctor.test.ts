// The doctor with every outside call faked: a ready machine, then each item broken on its own.
import { describe, expect, it } from 'vitest';
import { exitCodeFor, formatItems, runDoctor, SECRETS_TEMPLATE, type CmdResult, type DoctorDeps, type Item } from '../src/doctor.js';
import { parseSecrets } from '../src/secrets.js';

// Made-up tokens: the output must never contain them.
const BOT = 'xoxb-made-up-bot-token-1111';
const APP = 'xapp-made-up-app-token-2222';
const TEST = 'xoxb-made-up-test-token-3333';
const SECRETS_FILE = 'Z:/build/secrets.env';
const GOOD_FILE = `SLACK_BOT_TOKEN=${BOT}\nSLACK_APP_TOKEN=${APP}\nSLACK_TEST_BOT_TOKEN=${TEST}\nGROUPING_ANTHROPIC_KEY=\n`;

const res = (code: number, stdout = '', stderr = ''): CmdResult => ({ code, stdout, stderr, timedOut: false });

interface Fake {
  deps: DoctorDeps;
  files: Map<string, string>;
  calls: string[];
}

function fake(over: Partial<DoctorDeps> = {}, cmds: Record<string, CmdResult> = {}, files: Record<string, string> = { [SECRETS_FILE]: GOOD_FILE }): Fake {
  const fileMap = new Map(Object.entries(files));
  const calls: string[] = [];
  const answers: Record<string, CmdResult> = {
    'git --version': res(0, 'git version 2.50.1.windows.1\n'),
    'gh --version': res(0, 'gh version 2.88.1 (2026-03-12)\n'),
    'gh auth status': res(0, 'github.com\n  ✓ Logged in to github.com account stage-user (keyring)\n'),
    'gh api repos/marshalofthecentralaltar/demo-bank-card-app --jq .permissions.push': res(0, 'true\n'),
    'gh api repos/marshalofthecentralaltar/wise-hackathon --jq .full_name': res(0, 'marshalofthecentralaltar/wise-hackathon\n'),
    ...cmds,
  };
  const deps: DoctorDeps = {
    nodeVersion: '22.20.0',
    platform: 'win32',
    env: { DISABLE_AUTOUPDATER: '1' },
    secretsFile: SECRETS_FILE,
    run: async (cmd, args) => {
      const key = [cmd, ...args].join(' ');
      calls.push(key);
      return answers[key] ?? res(1, '', `unexpected call ${key}`);
    },
    askClaude: async () => ({ ok: true, text: 'OK', seconds: 4.2 }),
    launchBrowser: async () => ({ ok: true, detail: 'started, version 157.0' }),
    fileExists: (p) => fileMap.has(p),
    readFile: (p) => fileMap.get(p) ?? '',
    createFile: (p, text) => {
      if (fileMap.has(p)) throw new Error('EEXIST');
      fileMap.set(p, text);
    },
    slackAuthTest: async (token) => ({ ok: true, team: 'Innovative Bug Fixer', user: token === BOT ? 'innovative_bug_fixer' : 'support_desk' }),
    slackChannelId: async () => 'C0CHF22D9AR',
    cardOwner: async () => ({ githubLogin: 'nadimmetwalli', slackUserId: 'U0CJEMEMMT2' }),
    portFree: async () => true,
    warmFixDeps: async () => ({ cold: false, seconds: 0 }),
    ...over,
  };
  return { deps, files: fileMap, calls };
}

async function doctor(f: Fake, offline = false): Promise<{ items: Item[]; text: string; exit: number }> {
  const { items, tokens } = await runDoctor(f.deps, { offline, parseSecrets });
  return { items, text: formatItems(items, tokens), exit: exitCodeFor(items) };
}

const item = (items: Item[], name: string): Item => {
  const hit = items.find((i) => i.name === name);
  if (!hit) throw new Error(`no item ${name}: ${items.map((i) => i.name).join(', ')}`);
  return hit;
};

function expectNoToken(text: string): void {
  for (const t of [BOT, APP, TEST]) expect(text).not.toContain(t);
}

describe('doctor on a ready machine', () => {
  it('every item is OK, exit 0, tokens shown by length only', async () => {
    const r = await doctor(fake());
    expect(r.items.filter((i) => i.status !== 'OK')).toEqual([]);
    expect(r.exit).toBe(0);
    expect(item(r.items, 'SLACK_BOT_TOKEN').detail).toBe(`set, ${BOT.length} characters`);
    expect(r.text).toContain('READY: nothing is missing.');
    expectNoToken(r.text);
  });

  it('an unset DISABLE_AUTOUPDATER is a warning with the setx line, not a failure', async () => {
    const f = fake();
    f.deps.env = {};
    const r = await doctor(f);
    const w = item(r.items, 'DISABLE_AUTOUPDATER');
    expect(w.status).toBe('WARN');
    expect(w.fix).toContain('setx DISABLE_AUTOUPDATER 1');
    expect(r.exit).toBe(0);
  });

  it('--offline skips network and login items and makes no gh login call', async () => {
    const f = fake({
      askClaude: async () => {
        throw new Error('must not be called offline');
      },
      slackAuthTest: async () => {
        throw new Error('must not be called offline');
      },
      warmFixDeps: async () => {
        throw new Error('must not be called offline');
      },
    });
    const r = await doctor(f, true);
    expect(f.calls).toEqual(['git --version', 'gh --version']);
    expect(r.items.filter((i) => i.status === 'SKIP').map((i) => i.name)).toEqual(['gh login and access', 'claude answers', 'Slack', 'fix step dependencies warm']);
    expect(r.exit).toBe(0);
  });
});

describe('doctor on a broken machine: each item MISSING with a fix line', () => {
  const cases: [string, () => Fake, string, RegExp][] = [
    ['old node', () => fake({ nodeVersion: '20.11.0' }), 'node', /winget install --id OpenJS\.NodeJS\.22 -e/],
    ['no git', () => fake({}, { 'git --version': res(-1, '', 'spawn git ENOENT') }), 'git', /winget install --id Git\.Git/],
    ['no gh', () => fake({}, { 'gh --version': res(-1, '', 'spawn gh ENOENT') }), 'gh', /winget install --id GitHub\.cli/],
    ['no gh login', () => fake({}, { 'gh auth status': res(1, '', 'You are not logged into any GitHub hosts. To log in, run: gh auth login') }), 'gh logged in', /gh auth login/],
    ['no push permission', () => fake({}, { 'gh api repos/marshalofthecentralaltar/demo-bank-card-app --jq .permissions.push': res(0, 'false\n') }), 'gh can push to the card app', /accepts the invitation at https:\/\/github\.com\/marshalofthecentralaltar\/demo-bank-card-app\/invitations/],
    ['tool repository unreadable', () => fake({}, { 'gh api repos/marshalofthecentralaltar/wise-hackathon --jq .full_name': res(1, '', 'HTTP 404: Not Found') }), 'gh can read the tool repository', /collaborator/],
    ['claude not logged in', () => fake({ askClaude: async () => ({ ok: false, text: 'Not logged in · Please run /login', error: 'claude exit 1: Not logged in · Please run /login', seconds: 1.1 }) }), 'claude answers', /run claude once.*log in/],
    ['claude not installed', () => fake({ askClaude: async () => ({ ok: false, text: '', error: 'claude exit -1: Error: claude executable not found on PATH', seconds: 0 }) }), 'claude answers', /npm install -g @anthropic-ai\/claude-code/],
    ['no browser', () => fake({ launchBrowser: async () => ({ ok: false, detail: "browserType.launch: Chromium distribution 'msedge' is not found" }) }), 'browser (Chrome or Edge)', /winget install --id Google\.Chrome/],
    ['token empty', () => fake({}, {}, { [SECRETS_FILE]: `SLACK_BOT_TOKEN=${BOT}\nSLACK_APP_TOKEN=${APP}\nSLACK_TEST_BOT_TOKEN=\n` }), 'SLACK_TEST_BOT_TOKEN', /fill the line SLACK_TEST_BOT_TOKEN=/],
    ['Slack refuses the bot token', () => fake({ slackAuthTest: async (t) => (t === BOT ? { ok: false, error: `invalid_auth for ${BOT}` } : { ok: true, team: 'T', user: 'u' }) }), 'Slack bot token works', /Bot User OAuth Token/],
    ['no #support', () => fake({ slackChannelId: async () => null }), '#support found', /\/invite/],
    ['owner has no Slack id', () => fake({ cardOwner: async () => ({ githubLogin: 'nadimmetwalli', slackUserId: null }) }), 'card page owner in Slack', /owners\.json/],
    ['port busy', () => fake({ portFree: async (p) => p !== 3000 }), 'port 3000 free', /netstat -ano \| findstr :3000/],
    ['warm-up fails', () => fake({ warmFixDeps: async () => { throw new Error('npm ci failed (exit 1)'); } }), 'fix step dependencies warm', /network/],
  ];

  for (const [label, make, name, fix] of cases) {
    it(label, async () => {
      const r = await doctor(make());
      const hit = item(r.items, name);
      expect(hit.status).toBe('MISSING');
      expect(hit.fix).toMatch(fix);
      expect(r.text).toMatch(new RegExp(`^MISSING ${name.replace(/[()#]/g, '.')}: .* \\| fix: `, 'm'));
      expect(r.exit).toBe(1);
      expectNoToken(r.text);
    });
  }

  it('a token that Slack echoes back in an error is still not printed', async () => {
    const r = await doctor(fake({ slackAuthTest: async (t) => ({ ok: false, error: `bad token ${t}` }) }));
    expect(r.text).toContain('***');
    expectNoToken(r.text);
  });
});

describe('the secrets file', () => {
  it('when missing, creates the template with the four names and empty values, and says so', async () => {
    const f = fake({}, {}, {});
    const r = await doctor(f, true);
    expect(f.files.get(SECRETS_FILE)).toBe(SECRETS_TEMPLATE);
    expect(SECRETS_TEMPLATE.split('\n').filter(Boolean)).toEqual(['SLACK_BOT_TOKEN=', 'SLACK_APP_TOKEN=', 'SLACK_TEST_BOT_TOKEN=', 'GROUPING_ANTHROPIC_KEY=']);
    const s = item(r.items, 'secrets file');
    expect(s.status).toBe('MISSING');
    expect(s.detail).toContain(`${SECRETS_FILE} did not exist; created it`);
    expect(r.exit).toBe(1);
  });

  it('never overwrites an existing file', async () => {
    const f = fake({}, {}, { [SECRETS_FILE]: 'SLACK_BOT_TOKEN=\n' });
    await doctor(f, true);
    expect(f.files.get(SECRETS_FILE)).toBe('SLACK_BOT_TOKEN=\n');
  });

  it('a variable set in the environment wins over the file, as the loader does', async () => {
    const f = fake({}, {}, { [SECRETS_FILE]: 'SLACK_BOT_TOKEN=\nSLACK_APP_TOKEN=\nSLACK_TEST_BOT_TOKEN=\n' });
    f.deps.env = { DISABLE_AUTOUPDATER: '1', SLACK_BOT_TOKEN: BOT, SLACK_APP_TOKEN: APP, SLACK_TEST_BOT_TOKEN: TEST };
    const r = await doctor(f);
    expect(r.exit).toBe(0);
    expectNoToken(r.text);
  });
});
