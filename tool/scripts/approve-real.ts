// The real merge path of the "Approve fix" button, on the throwaway repository demo-bank-hello.
// Opens a one-line pull request there (committed as the tool's own identity), then:
//   --merge-proof         presses as another user, prints the state (OPEN), presses as the owner,
//                         prints the state (MERGED). Slack is a fake here; gh and GitHub are real.
//   --button-in <ts>      posts a handoff with that pull request and the button as a reply in the
//                         #support thread <ts>, owner = the bot itself (no person is pinged), for a
//                         person to press while `npm run tool` listens.
// Run from tool/:
//   npx tsx --import ./src/loadSecrets.ts scripts/approve-real.ts --merge-proof
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebClient } from '@slack/web-api';
import { handleApprovePress, realGh } from '../src/approve.js';
import { toolGitIdentity } from '../src/fix.js';
import { buildHandoffMessage } from '../src/handoff.js';
import { FakeSlack, webSlackPort } from '../src/slackPost.js';
import type { Handoff } from '../src/types.js';

const REPO = 'marshalofthecentralaltar/demo-bank-hello';
const CHANNEL = 'C0CHF22D9AR';

async function gh(args: string[]): Promise<string> {
  const r = await realGh(args);
  if (r.code !== 0) throw new Error(`gh ${args.slice(0, 3).join(' ')} failed: ${(r.stderr || r.stdout).trim().slice(0, 300)}`);
  return r.stdout.trim();
}

async function openPullRequest(): Promise<{ number: number; url: string }> {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const branch = `approve-proof-${stamp}`;
  const id = toolGitIdentity();
  const base = await gh(['api', `repos/${REPO}/git/ref/heads/main`, '--jq', '.object.sha']);
  await gh(['api', '-X', 'POST', `repos/${REPO}/git/refs`, '-f', `ref=refs/heads/${branch}`, '-f', `sha=${base}`]);
  const content = Buffer.from(`Approve-fix proof ${stamp}\n`).toString('base64');
  await gh([
    'api', '-X', 'PUT', `repos/${REPO}/contents/approve-proofs/${stamp}.txt`,
    '-f', `message=Approve-fix proof ${stamp}`,
    '-f', `content=${content}`,
    '-f', `branch=${branch}`,
    '-f', `committer[name]=${id.name}`, '-f', `committer[email]=${id.email}`,
    '-f', `author[name]=${id.name}`, '-f', `author[email]=${id.email}`,
  ]);
  const url = await gh(['pr', 'create', '--repo', REPO, '--head', branch, '--base', 'main', '--title', `Approve-fix proof ${stamp}`, '--body', 'One-line pull request to prove the Approve fix button merges only for the owner.']);
  const number = Number(/\/pull\/(\d+)/.exec(url)?.[1]);
  return { number, url };
}

const state = async (n: number) => JSON.parse(await gh(['pr', 'view', String(n), '--repo', REPO, '--json', 'state'])).state as string;

const pr = await openPullRequest();
console.log(JSON.stringify({ opened: pr.url }));
const OWNER_ID = 'U0CHJMWULQN'; // the bot's own id: stands in for the owner so no person is pinged

if (process.argv.includes('--merge-proof')) {
  const value = JSON.stringify({ repo: REPO, pr: pr.number, owner: OWNER_ID, group: 'approve-proof' });
  const statePath = join(mkdtempSync(join(tmpdir(), 'approve-real-')), 'approvals.json');
  const slack = new FakeSlack();
  const press = (userId: string) => handleApprovePress({ userId, channel: CHANNEL, messageTs: '0', value }, { slack, statePath, log: (m) => console.log(m) });
  console.log(JSON.stringify({ press: 'U0NOTOWNER', result: await press('U0NOTOWNER') }));
  console.log(JSON.stringify({ after: 'other user', state: await state(pr.number) }));
  console.log(JSON.stringify({ press: OWNER_ID, result: await press(OWNER_ID) }));
  console.log(JSON.stringify({ after: 'owner', state: await state(pr.number) }));
  console.log(JSON.stringify({ press: `${OWNER_ID} again`, result: await press(OWNER_ID) }));
  console.log(JSON.stringify({ ephemerals: slack.ephemerals.map((e) => e.text), updates: slack.updates.map((u) => u.text) }));
}

const at = process.argv.indexOf('--button-in');
if (at > 0) {
  const threadTs = process.argv[at + 1]!;
  const client = new WebClient(process.env.SLACK_BOT_TOKEN);
  const slack = webSlackPort(client);
  const h: Handoff = {
    group: { id: 'button-check', page: null, summary: 'Button check for the Approve fix flow, on the throwaway repository demo-bank-hello', reports: [], threadTs },
    monitoring: { source: 'prometheus', errorsPerSecond: 0, alertsFiring: [], p95Seconds: null, logLinesRead: 0, logErrors: 0, logWarnings: 0, showsProblem: false, summary: 'Not read for this check.' },
    owner: { repo: REPO, codePath: null, githubLogin: 'demo-bank-triage-bot', slackUserId: OWNER_ID, ownersLine: null },
    investigation: { found: false, repo: REPO, commitSha: null, commitAuthor: null, mergedAt: null, pullRequestUrl: null, file: null, lines: null, whatIsWrong: 'Nothing is wrong: this handoff only carries a one-line pull request so a person can press the button.', customerEffect: 'unknown', revertsCleanly: null, nextSteps: ['Press Approve fix. Only the owner (the bot itself here) can merge, so a person pressing it should get a line saying only the owner can approve'], seconds: 0 },
    verdict: { severity: 'low', reason: 'This is a check of the button, not a customer problem.', decidedBy: 'rule' },
    fix: { kind: 'fix', prUrl: pr.url, prNumber: pr.number, branch: null, filesChanged: [], testsPassed: null, note: null, seconds: 0 },
    sentenceForCustomers: 'Nothing to tell customers: this is a check of the button.',
  };
  const m = buildHandoffMessage(h);
  const posted = await slack.postMessage({ channel: CHANNEL, threadTs, text: m.text, blocks: m.blocks });
  console.log(JSON.stringify({ posted: await slack.getPermalink(CHANNEL, posted.ts), pr: pr.url }));
}
