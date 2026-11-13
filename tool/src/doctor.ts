// npm run doctor: says whether this machine can run the demo. One line per item, OK, WARN,
// MISSING or SKIP, with the exact fix a person types or clicks. Every item is a function whose
// outside calls come in through DoctorDeps, so tests run without a network, a login or a browser.
// Never prints a secret value: tokens are reported by length, and every line is passed through
// redact() with the token values before it is printed.

export type Status = 'OK' | 'WARN' | 'MISSING' | 'SKIP';

export interface Item {
  status: Status;
  name: string;
  detail: string;
  /** What a person types or clicks; set on WARN and MISSING. */
  fix?: string;
}

export interface CmdResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface DoctorDeps {
  nodeVersion: string;
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  secretsFile: string;
  /** Runs a program without a shell. Never throws. */
  run(cmd: string, args: string[], timeoutMs: number): Promise<CmdResult>;
  /** One tiny prompt through the tool's own model runner. */
  askClaude(timeoutMs: number): Promise<{ ok: boolean; text: string; error?: string; seconds: number }>;
  /** The browser checks' launcher (tool/checks/browser-ok.mjs). */
  launchBrowser(): Promise<{ ok: boolean; detail: string }>;
  fileExists(path: string): boolean;
  readFile(path: string): string;
  /** Creates a file that must not exist yet (flag wx). */
  createFile(path: string, text: string): void;
  /** Slack auth.test for a token. */
  slackAuthTest(token: string): Promise<{ ok: boolean; team?: string; user?: string; userId?: string; error?: string }>;
  /** The id of a public channel by name, or null. */
  slackChannelId(token: string, name: string): Promise<string | null>;
  /** The card page's owner: GitHub login from the owners file, Slack id from Slack. */
  cardOwner(token: string): Promise<{ githubLogin: string | null; slackUserId: string | null }>;
  portFree(port: number): Promise<boolean>;
  /** The fix step's dependency warm-up, as startTool runs it. */
  warmFixDeps(): Promise<{ cold: boolean; seconds: number }>;
}

export const CARD_APP_REPO = 'marshalofthecentralaltar/demo-bank-card-app';
export const TOOL_REPO = 'marshalofthecentralaltar/wise-hackathon';
export const SECRET_NAMES = ['SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN', 'SLACK_TEST_BOT_TOKEN'] as const;
/** The template written when the secrets file does not exist: the four names, empty values. */
export const SECRETS_TEMPLATE = 'SLACK_BOT_TOKEN=\nSLACK_APP_TOKEN=\nSLACK_TEST_BOT_TOKEN=\nGROUPING_ANTHROPIC_KEY=\n';

const ok = (name: string, detail: string): Item => ({ status: 'OK', name, detail });
const missing = (name: string, detail: string, fix: string): Item => ({ status: 'MISSING', name, detail, fix });
const firstLine = (s: string): string => s.trim().split(/\r?\n/)[0]?.slice(0, 200) ?? '';
const win = (d: DoctorDeps) => d.platform === 'win32';

export function checkNode(d: DoctorDeps): Item {
  const major = Number(d.nodeVersion.replace(/^v/, '').split('.')[0]);
  if (major >= 22) return ok('node', `v${d.nodeVersion.replace(/^v/, '')}`);
  return missing('node', `v${d.nodeVersion.replace(/^v/, '')} is older than 22`, win(d) ? 'winget install --id OpenJS.NodeJS.22 -e, then open a new terminal' : 'install Node 22 or newer from https://nodejs.org');
}

export async function checkGit(d: DoctorDeps): Promise<Item> {
  const r = await d.run('git', ['--version'], 15_000);
  if (r.code === 0) return ok('git', firstLine(r.stdout));
  return missing('git', 'git did not start', win(d) ? 'winget install --id Git.Git -e, then open a new terminal' : 'install git (xcode-select --install)');
}

/** gh present; with online, also logged in, push to the card app, read the tool's repository. */
export async function checkGh(d: DoctorDeps, online: boolean): Promise<Item[]> {
  const v = await d.run('gh', ['--version'], 15_000);
  if (v.code !== 0) return [missing('gh', 'the GitHub command line did not start', win(d) ? 'winget install --id GitHub.cli -e, then open a new terminal' : 'brew install gh')];
  const items: Item[] = [ok('gh', firstLine(v.stdout))];
  if (!online) return [...items, { status: 'SKIP', name: 'gh login and access', detail: 'skipped (--offline)' }];
  const s = await d.run('gh', ['auth', 'status'], 30_000);
  const statusText = s.stdout + s.stderr;
  if (s.code !== 0 || /not logged in/i.test(statusText)) {
    return [...items, missing('gh logged in', firstLine(statusText) || 'gh auth status failed', 'gh auth login (GitHub.com, HTTPS, log in with a web browser), as the account that can push to ' + CARD_APP_REPO)];
  }
  const account = /account\s+(\S+)/i.exec(statusText)?.[1] ?? /as\s+(\S+)/i.exec(statusText)?.[1] ?? 'yes';
  items.push(ok('gh logged in', account));
  const push = await d.run('gh', ['api', `repos/${CARD_APP_REPO}`, '--jq', '.permissions.push'], 30_000);
  if (push.code === 0 && push.stdout.trim() === 'true') items.push(ok('gh can push to the card app', CARD_APP_REPO));
  else
    items.push(
      missing(
        'gh can push to the card app',
        push.code === 0 ? `the active gh account cannot push to ${CARD_APP_REPO}` : firstLine(push.stderr || push.stdout),
        `the person logged in to gh accepts the invitation at https://github.com/${CARD_APP_REPO}/invitations (logged in to github.com as that same account), then run npm run doctor again; no invitation there means the owner has not sent one yet`,
      ),
    );
  const read = await d.run('gh', ['api', `repos/${TOOL_REPO}`, '--jq', '.full_name'], 30_000);
  if (read.code === 0 && read.stdout.trim() !== '') items.push(ok('gh can read the tool repository', TOOL_REPO));
  else items.push(missing('gh can read the tool repository', firstLine(read.stderr || read.stdout), `ask the owner of ${TOOL_REPO} to add the gh account as a collaborator`));
  return items;
}

export async function checkClaude(d: DoctorDeps, online: boolean): Promise<Item> {
  if (!online) return { status: 'SKIP', name: 'claude answers', detail: 'skipped (--offline)' };
  const r = await d.askClaude(60_000);
  if (r.ok) return ok('claude answers', `answered in ${r.seconds} s`);
  const why = `${r.error ?? ''} ${r.text}`;
  if (/not found|ENOENT|executable/i.test(why)) {
    return missing('claude answers', 'the claude command was not found', win(d) ? 'npm install -g @anthropic-ai/claude-code, then open a new terminal' : 'npm install -g @anthropic-ai/claude-code');
  }
  if (/log ?in|logged|auth|api key|credential|401|403/i.test(why)) {
    return missing('claude answers', 'claude is not logged in', 'run claude once in a terminal, log in with your own Claude account (the person whose laptop this is) in the browser, then type /exit');
  }
  if (/did not answer in/i.test(why)) return missing('claude answers', 'claude did not answer in 60 s', 'run claude once in a terminal and check it answers; check the network');
  return missing('claude answers', firstLine(why), 'run claude once in a terminal and read what it says');
}

export async function checkBrowser(d: DoctorDeps): Promise<Item> {
  const r = await d.launchBrowser();
  if (r.ok) return ok('browser (Chrome or Edge)', r.detail);
  return missing('browser (Chrome or Edge)', `the browser check could not start Chrome or Edge: ${firstLine(r.detail)}`, win(d) ? 'winget install --id Google.Chrome -e (Edge is built into Windows 11; if it is there, run npm ci in tool/ again)' : 'install Google Chrome from https://www.google.com/chrome');
}

/** The secrets file and the three Slack tokens, by length. Creates an empty template when the file is missing. */
export function checkSecrets(d: DoctorDeps, parse: (text: string) => Record<string, string>): { items: Item[]; tokens: Record<string, string> } {
  const file = d.secretsFile;
  const tokens: Record<string, string> = {};
  const items: Item[] = [];
  let fromFile: Record<string, string> = {};
  if (!d.fileExists(file)) {
    let created = false;
    try {
      d.createFile(file, SECRETS_TEMPLATE);
      created = true;
    } catch {
      created = false;
    }
    items.push(
      missing(
        'secrets file',
        created ? `${file} did not exist; created it with the four names and empty values` : `${file} does not exist and could not be created`,
        `open ${file} in Notepad and paste the three Slack tokens after the = signs (STAGE-SETUP.md step 7)`,
      ),
    );
  } else {
    items.push(ok('secrets file', file));
    fromFile = parse(d.readFile(file));
  }
  for (const name of SECRET_NAMES) {
    // As loadSecrets does: a variable already set wins over the file.
    const value = (d.env[name] ?? fromFile[name] ?? '').trim();
    tokens[name] = value;
    if (value) items.push(ok(name, `set, ${value.length} characters`));
    else items.push(missing(name, 'empty', `fill the line ${name}= in ${file} (STAGE-SETUP.md step 7)`));
  }
  return { items, tokens };
}

export async function checkSlack(d: DoctorDeps, tokens: Record<string, string>, online: boolean): Promise<Item[]> {
  if (!online) return [{ status: 'SKIP', name: 'Slack', detail: 'skipped (--offline)' }];
  const items: Item[] = [];
  const bot = tokens.SLACK_BOT_TOKEN ?? '';
  const test = tokens.SLACK_TEST_BOT_TOKEN ?? '';
  for (const [name, token, app] of [
    ['Slack bot token works', bot, 'the tool app (tool/slack-manifest.yaml)'],
    ['Slack test token works', test, 'the "Support Desk" app (tool/slack-test-manifest.yaml)'],
  ] as const) {
    if (!token) {
      items.push({ status: 'SKIP', name, detail: 'token empty (see above)' });
      continue;
    }
    const a = await d.slackAuthTest(token).catch((err: unknown) => ({ ok: false, error: String(err) }) as { ok: boolean; error?: string; team?: string; user?: string });
    if (a.ok) items.push(ok(name, `team "${a.team ?? '?'}" as ${a.user ?? '?'}`));
    else items.push(missing(name, `Slack refused the token: ${firstLine(a.error ?? 'unknown error')}`, `copy the Bot User OAuth Token (xoxb-...) of ${app} again from api.slack.com/apps, OAuth & Permissions, into the secrets file`));
  }
  if (!bot) return items;
  const channel = await d.slackChannelId(bot, 'support').catch(() => null);
  if (channel) items.push(ok('#support found', channel));
  else items.push(missing('#support found', 'the bot token sees no public channel named support', 'in Slack, open #support and type /invite @<the tool app>, or create the channel'));
  const owner = await d.cardOwner(bot).catch(() => ({ githubLogin: null, slackUserId: null }));
  if (owner.slackUserId) items.push(ok('card page owner in Slack', `${owner.githubLogin ?? '?'} is ${owner.slackUserId}`));
  else
    items.push(
      missing(
        'card page owner in Slack',
        owner.githubLogin ? `${owner.githubLogin} (from the owners file) has no Slack user id` : 'no owner read from the card app owners file',
        owner.githubLogin ? `add "${owner.githubLogin}": "<their Slack display name>" to tool/owners.json, and make sure they are in the Slack workspace` : 'check gh can read the card app (above)',
      ),
    );
  return items;
}

export async function checkPorts(d: DoctorDeps): Promise<Item[]> {
  const items: Item[] = [];
  for (const [port, what] of [
    [3000, 'the card app'],
    [9090, 'Prometheus'],
  ] as const) {
    if (await d.portFree(port)) items.push(ok(`port ${port} free`, `for ${what}`));
    else
      items.push(
        missing(
          `port ${port} free`,
          `something already listens on ${port}: ${what} from an earlier start, or another program`,
          win(d) ? `if the demo is already running, stop it first; else find the program with: netstat -ano | findstr :${port} and end that PID in Task Manager` : `lsof -i :${port}, then stop that program`,
        ),
      );
  }
  return items;
}

export function checkAutoUpdater(d: DoctorDeps): Item {
  if ((d.env.DISABLE_AUTOUPDATER ?? '').trim() === '1') return ok('DISABLE_AUTOUPDATER', '1');
  return {
    status: 'WARN',
    name: 'DISABLE_AUTOUPDATER',
    detail: 'not set to 1: Claude Code may update itself during the demo (it did once on 13 Nov)',
    fix: win(d) ? 'setx DISABLE_AUTOUPDATER 1, then open a new terminal' : 'echo "export DISABLE_AUTOUPDATER=1" >> ~/.zshrc, then open a new terminal',
  };
}

export async function checkWarmDeps(d: DoctorDeps, online: boolean): Promise<Item> {
  if (!online) return { status: 'SKIP', name: 'fix step dependencies warm', detail: 'skipped (--offline)' };
  try {
    const w = await d.warmFixDeps();
    return ok('fix step dependencies warm', `${w.cold ? 'installed now' : 'already warm'} in ${w.seconds} s`);
  } catch (err) {
    return missing('fix step dependencies warm', firstLine(err instanceof Error ? err.message : String(err)), 'check the network and that gh/git can read the card app, then run npm run doctor again');
  }
}

export async function runDoctor(d: DoctorDeps, opts: { offline: boolean; parseSecrets: (text: string) => Record<string, string> }): Promise<{ items: Item[]; tokens: string[] }> {
  const online = !opts.offline;
  const items: Item[] = [checkNode(d), await checkGit(d), ...(await checkGh(d, online))];
  items.push(await checkClaude(d, online));
  items.push(await checkBrowser(d));
  const secrets = checkSecrets(d, opts.parseSecrets);
  items.push(...secrets.items);
  items.push(...(await checkSlack(d, secrets.tokens, online)));
  items.push(...(await checkPorts(d)));
  items.push(checkAutoUpdater(d));
  items.push(await checkWarmDeps(d, online));
  return { items, tokens: Object.values(secrets.tokens).filter(Boolean) };
}

/** Replaces every secret value in text with ***. */
export function redact(text: string, secrets: string[]): string {
  let out = text;
  for (const s of secrets) if (s.length >= 4) out = out.split(s).join('***');
  return out;
}

export function formatItems(items: Item[], secrets: string[]): string {
  const lines = items.map((i) => `${i.status.padEnd(7)} ${i.name}: ${i.detail}${i.fix ? ` | fix: ${i.fix}` : ''}`);
  const missingCount = items.filter((i) => i.status === 'MISSING').length;
  lines.push(missingCount === 0 ? 'READY: nothing is missing.' : `NOT READY: ${missingCount} missing. Fix the MISSING lines in order, then run npm run doctor again.`);
  return redact(lines.join('\n'), secrets);
}

export const exitCodeFor = (items: Item[]): number => (items.some((i) => i.status === 'MISSING') ? 1 : 0);
