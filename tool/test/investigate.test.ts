import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { questionArgs } from '../src/claude.js';
import {
  INVESTIGATION_ALLOWED_TOOLS,
  INVESTIGATION_DISALLOWED_TOOLS,
  INVESTIGATION_TOOLS,
  investigateWithDetails,
  type AskModel,
  type ModelAnswer,
} from '../src/investigate.js';
import type { MonitoringFinding, Owner, RecentCommit, ReportGroup } from '../src/types.js';
import { git, newRepo, numbered, writeAndCommit } from './gitRepo.js';

const CARD = 'src/pages/card/Card.tsx';

// main: start -> merge of feat (which holds the faulty commit) -> unrelated commit
const repo = newRepo('investigate-');
let start = '', faulty = '', merge = '', later = '';
let commits: RecentCommit[] = [];

beforeAll(() => {
  const { dir } = repo;
  start = writeAndCommit(dir, { [CARD]: numbered(30), 'README.md': 'hi\n' }, 'Add the card page');
  git(dir, 'checkout', '-q', '-b', 'feat');
  faulty = writeAndCommit(dir, { [CARD]: numbered(30, { 12: 'setInterval(rerender, 1000)', 13: 'key={Date.now()}' }) }, 'Keep the balance live');
  git(dir, 'checkout', '-q', 'main');
  git(dir, 'merge', '-q', '--no-ff', '-m', 'Merge pull request #1 from feat', 'feat');
  merge = git(dir, 'rev-parse', 'HEAD');
  later = writeAndCommit(dir, { 'README.md': 'hello\n' }, 'Docs');
  const entry = (sha: string, message: string, files: string[], author: string): RecentCommit => ({
    repo: 'o/r', sha, author, mergedAt: `2026-11-13T1${commits.length}:00:00Z`, message, files,
  });
  commits = [
    entry(later, 'Docs', ['README.md'], 'docs-person'),
    entry(merge, 'Merge pull request #1 from feat', [CARD], 'merger'),
    { ...entry(faulty, 'Keep the balance live', [CARD], 'list-author-not-git-author'), mergedAt: '2026-11-13T09:30:00Z', pullRequest: { number: 1, title: 'Live balance', body: '', url: 'https://example.test/pull/1', comments: [] } },
    entry(start, 'Add the card page', [CARD, 'README.md'], 'founder'),
  ];
});
afterAll(() => repo.cleanup());

const group: ReportGroup = { id: 'g', page: 'card', summary: 'The card picture blinks.', reports: [{ channel: 'C', ts: '1', sender: 'U', text: 'blinks' }], threadTs: '1' };
const owner: Owner = { repo: 'o/r', codePath: 'src/pages/card/', githubLogin: null, slackUserId: null, ownersLine: null };
const monitoring: MonitoringFinding = { source: 'prometheus', errorsPerSecond: 0, alertsFiring: [], p95Seconds: null, logLinesRead: 0, logErrors: 0, logWarnings: 0, showsProblem: false, summary: 'Nothing.' };

const good = (over: Partial<ModelAnswer> = {}): ModelAnswer => ({
  found: true, commit: faulty, file: CARD, lines: '12-13', whatIsWrong: 'Re-renders every second.', customerEffect: 'appearance', nextSteps: ['Remove the key.'], ...over,
});

/** A stub model that gives the same answers in turn and records the prompts it was sent. */
function stub(...answers: unknown[]): { ask: AskModel; prompts: string[] } {
  const prompts: string[] = [];
  return {
    prompts,
    ask: async (prompt) => {
      prompts.push(prompt);
      return { answer: answers[Math.min(prompts.length - 1, answers.length - 1)], turns: 1, seconds: 0 };
    },
  };
}

const run = (ask: AskModel) => investigateWithDetails({ group, owner, monitoring, commits }, { copyDir: repo.dir, askModel: ask });

describe('investigate: the tool checks the answer', () => {
  it('accepts a correct answer; author, merge time and pull request come from the list; revert tried', async () => {
    const s = stub(good());
    const d = await run(s.ask);
    expect(s.prompts).toHaveLength(1);
    expect(d.investigation).toMatchObject({
      found: true, commitSha: faulty, file: CARD, lines: '12-13', commitAuthor: 'list-author-not-git-author',
      mergedAt: '2026-11-13T09:30:00Z', pullRequestUrl: 'https://example.test/pull/1', revertsCleanly: true, customerEffect: 'appearance',
    });
    expect(git(repo.dir, 'status', '--porcelain')).toBe('');
  });

  it('maps a merge commit to the commit inside it that changed those lines', async () => {
    const d = await run(stub(good({ commit: merge })).ask);
    expect(d.investigation.commitSha).toBe(faulty);
  });

  it.each([
    ['a commit not in the list', { commit: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef' }, /not one of the listed recent commits/],
    ['a commit that exists but is not listed... is the same as not listed', { commit: '0000000' }, /not one of the listed/],
    ['a file that does not exist', { file: 'src/pages/card/Nope.tsx' }, /does not exist/],
    ['lines outside the file', { lines: '500-510' }, /outside .*Card\.tsx/],
    ['lines outside the commit\'s diff', { lines: '1-3' }, /not lines that commit/],
    ['a file the commit did not change', { file: 'README.md', lines: '1' }, /did not change README\.md/],
    ['a path outside the repository', { file: '../../secrets.env', lines: '1' }, /not a path inside the repository/],
  ])('rejects %s, retries once with the reason, then found:false', async (_name, bad, reason) => {
    const s = stub(good(bad as Partial<ModelAnswer>));
    const d = await run(s.ask);
    expect(s.prompts).toHaveLength(2);
    expect(s.prompts[1]).toMatch(reason);
    expect(s.prompts[1]).toContain('rejected by the checker');
    expect(d.attempts.map((a) => a.rejection)).toEqual([expect.stringMatching(reason), expect.stringMatching(reason)]);
    expect(d.investigation).toMatchObject({ found: false, commitSha: null, file: null, lines: null, revertsCleanly: null });
  });

  it('a wrong first answer and a right second one is found', async () => {
    const s = stub(good({ lines: '1-3' }), good());
    const d = await run(s.ask);
    expect(s.prompts).toHaveLength(2);
    expect(d.investigation).toMatchObject({ found: true, commitSha: faulty });
  });

  it('an answer that is not JSON is rejected and retried', async () => {
    const s = stub(null, 'just text');
    const d = await run(s.ask);
    expect(s.prompts).toHaveLength(2);
    expect(d.investigation.found).toBe(false);
  });

  it('a model that changed the copy is not believed', async () => {
    const ask: AskModel = async () => {
      writeFileSync(join(repo.dir, CARD), 'tampered\n');
      return { answer: good() };
    };
    const d = await run(ask);
    git(repo.dir, 'checkout', '-q', '--', CARD);
    expect(d.investigation.found).toBe(false);
    expect(d.attempts[0]!.rejection).toMatch(/copy was changed/);
  });
});

describe('investigate: read-only by construction', () => {
  it('the session has no editing tool and the shell runs only four read-only git commands', () => {
    expect(INVESTIGATION_TOOLS).toEqual(['Read', 'Glob', 'Grep', 'Bash']);
    const bash = INVESTIGATION_ALLOWED_TOOLS.filter((t) => t.startsWith('Bash('));
    expect(bash).toEqual(['Bash(git log:*)', 'Bash(git show:*)', 'Bash(git diff:*)', 'Bash(git blame:*)']);
    expect(INVESTIGATION_ALLOWED_TOOLS.filter((t) => !t.startsWith('Bash('))).toEqual(['Read', 'Glob', 'Grep']);
    for (const t of ['Edit', 'Write', 'Bash(*--output*)']) expect(INVESTIGATION_DISALLOWED_TOOLS).toContain(t);

    const args = questionArgs({ model: 'sonnet', tools: INVESTIGATION_TOOLS, allowedTools: INVESTIGATION_ALLOWED_TOOLS, disallowedTools: INVESTIGATION_DISALLOWED_TOOLS, maxTurns: 15, jsonSchema: {} });
    expect(args[args.indexOf('--tools') + 1]).toBe('Read,Glob,Grep,Bash');
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('dontAsk');
    expect(args).toContain('--safe-mode');
    expect(args).not.toContain('--bare');
  });
});
