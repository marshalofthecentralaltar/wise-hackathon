import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { git, newRepo, writeAndCommit } from './gitRepo.js';
import type { FixStepInput, Investigation, Owner, ReportGroup, Verdict } from '../src/types.js';
import type { PullRequestRequest } from '../src/fix.js';

// Every git and process call of fixStep and of writeFixPullRequest goes through run(); spy on
// both (the real functions still run) to prove the high-severity path calls neither.
vi.mock('../src/fix.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/fix.js')>();
  return { ...real, run: vi.fn(real.run), writeFixPullRequest: vi.fn(real.writeFixPullRequest) };
});
const fix = await import('../src/fix.js');
const { fixStepWithDetails, fixStep, isUnder, TOOL_BRANCH_PREFIX } = await import('../src/fixStep.js');

const STAND_IN = fileURLToPath(new URL('./helpers/standInModel.mjs', import.meta.url));
const PAGE = 'src/pages/card/Card.tsx';

interface Fixture {
  bare: string;
  badSha: string;
  copies: string[];
  cleanup: () => void;
}

/** A repository with a planted commit, cloned bare to act as the remote. */
function plantedRepo(opts: { conflictAfter?: boolean } = {}): Fixture {
  const { dir, cleanup } = newRepo('fixstep-');
  writeAndCommit(
    dir,
    {
      'package.json': JSON.stringify({ name: 't', private: true, scripts: { test: 'node check.mjs' } }),
      'check.mjs': `import { readFileSync } from 'node:fs';\nprocess.exit(readFileSync('${PAGE}', 'utf8').includes('BROKEN') ? 1 : 0);\n`,
      [PAGE]: 'line 1\nstate ok\nline 3\n',
      'src/shared/keep.ts': 'export const keep = 1;\n',
    },
    'base',
  );
  const badSha = writeAndCommit(dir, { [PAGE]: 'line 1\nstate bad\nline 3\n' }, 'Card: the planted change');
  if (opts.conflictAfter) writeAndCommit(dir, { [PAGE]: 'line 1\nstate bad and later\nline 3\n' }, 'Card: a later change on the same line');
  const bareRoot = mkdtempSync(join(tmpdir(), 'fixstep-remote-'));
  const bare = join(bareRoot, 'remote.git');
  git(bareRoot, 'clone', '-q', '--bare', dir, bare);
  const copies: string[] = [];
  return {
    bare,
    badSha,
    copies,
    cleanup: () => {
      cleanup();
      rmSync(bareRoot, { recursive: true, force: true, maxRetries: 5 });
      for (const c of copies) rmSync(c, { recursive: true, force: true, maxRetries: 5 });
    },
  };
}

function makeCopy(f: Fixture, calls: { n: number }) {
  return async () => {
    calls.n++;
    const root = mkdtempSync(join(tmpdir(), 'fixstep-copy-'));
    f.copies.push(root);
    const dir = join(root, 'repo');
    // -c on clone sets it before the checkout, so the files are not rewritten (global autocrlf=true here).
    git(root, 'clone', '-q', '-c', 'core.autocrlf=false', f.bare, dir);
    return { dir, branch: 'main', remove: async () => rmSync(root, { recursive: true, force: true, maxRetries: 5 }) };
  };
}

const group: ReportGroup = {
  id: 'g1',
  page: 'card',
  summary: 'The card picture blinks on the card page.',
  reports: [1, 2, 3].map((i) => ({ channel: 'C1', ts: `1.${i}`, sender: `U${i}`, text: `report ${i}` })),
  threadTs: '1.1',
};
const owner: Owner = { repo: 'o/card-app', codePath: 'src/pages/card/', githubLogin: 'dev', slackUserId: null, ownersLine: null };
const investigation = (sha: string): Investigation => ({
  found: true, repo: 'o/card-app', commitSha: sha, commitAuthor: 'dev', mergedAt: '2026-11-13T10:00:00Z', pullRequestUrl: null,
  file: PAGE, lines: '2', whatIsWrong: 'The state is bad.', customerEffect: 'appearance', revertsCleanly: true, nextSteps: [], seconds: 1,
});
const low: Verdict = { severity: 'low', reason: 'appearance', decidedBy: 'rule' };
const high: Verdict = { severity: 'high', reason: 'figure', decidedBy: 'rule' };

function harness(f: Fixture, mode: string, extra: { budgetSeconds?: number } = {}) {
  const copyCalls = { n: 0 };
  const depsCalls = { n: 0 };
  const prs: PullRequestRequest[] = [];
  let modelPid: number | undefined;
  const opts = {
    budgetSeconds: extra.budgetSeconds ?? 60,
    makeCopy: makeCopy(f, copyCalls),
    installDeps: async () => {
      depsCalls.n++;
    },
    modelCommand: { cmd: process.execPath, args: [STAND_IN, mode] },
    createPullRequest: async (p: PullRequestRequest) => {
      prs.push(p);
      return { ok: true as const, url: `https://example.test/o/card-app/pull/${prs.length + 6}`, number: prs.length + 6 };
    },
    onModelSpawn: (pid: number) => (modelPid = pid),
  };
  return { opts, copyCalls, depsCalls, prs, pid: () => modelPid };
}

const remoteBranches = (bare: string) =>
  git(bare, 'for-each-ref', '--format=%(refname:short)', 'refs/heads').split(/\r?\n/).filter(Boolean);
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

let fixture: Fixture | undefined;
afterEach(() => {
  fixture?.cleanup();
  fixture = undefined;
  vi.mocked(fix.run).mockClear();
  vi.mocked(fix.writeFixPullRequest).mockClear();
});

describe('fixStep: high severity does nothing at all', () => {
  for (const [name, input] of [
    ['severity high', { verdict: high, investigation: investigation('a'.repeat(40)) }],
    ['found false', { verdict: low, investigation: { ...investigation('a'.repeat(40)), found: false, commitSha: null } }],
  ] as const) {
    it(`${name}: no copy, no dependencies, no model, no git, no pull request`, async () => {
      fixture = plantedRepo();
      const h = harness(fixture, 'good');
      vi.mocked(fix.run).mockClear();
      const out = await fixStep({ group, owner, ...input } as FixStepInput, h.opts);
      expect(out).toMatchObject({ kind: 'none', prUrl: null, branch: null, filesChanged: [], testsPassed: null });
      expect(h.copyCalls.n).toBe(0);
      expect(h.depsCalls.n).toBe(0);
      expect(h.pid()).toBeUndefined();
      expect(h.prs).toHaveLength(0);
      expect(fix.run).not.toHaveBeenCalled();
      expect(fix.writeFixPullRequest).not.toHaveBeenCalled();
      expect(remoteBranches(fixture.bare)).toEqual(['main']);
    }, 60_000);
  }
});

describe('fixStep: low severity', () => {
  it('a good fix inside the page folder is pushed as kind fix, authored by the tool', async () => {
    fixture = plantedRepo();
    const h = harness(fixture, 'good');
    const out = await fixStepWithDetails({ group, owner, investigation: investigation(fixture.badSha), verdict: low }, h.opts);
    expect(out).toMatchObject({ kind: 'fix', testsPassed: true, filesChanged: [PAGE] });
    expect(out.branch?.startsWith(`${TOOL_BRANCH_PREFIX}fix-`)).toBe(true);
    expect(git(fixture.bare, 'log', '-1', '--format=%an', out.branch!)).toBe('Demo Bank Triage');
    expect(git(fixture.bare, 'show', `${out.branch}:${PAGE}`)).toContain('state good');
    expect(h.prs[0]!.body).toContain('3 customer reports');
    expect(h.prs[0]!.body).toContain(fixture.badSha.slice(0, 7));
    expect(h.prs[0]!.title + h.prs[0]!.body).not.toMatch(/[—–]/);
  }, 60_000);

  it('a model that never returns: killed at the budget, the undo branch is pushed', async () => {
    fixture = plantedRepo();
    const h = harness(fixture, 'hang', { budgetSeconds: 3 });
    const t0 = performance.now();
    const out = await fixStepWithDetails({ group, owner, investigation: investigation(fixture.badSha), verdict: low }, h.opts);
    expect(performance.now() - t0).toBeLessThan(40_000);
    expect(h.pid()).toBeDefined();
    expect(alive(h.pid()!)).toBe(false);
    expect(out.kind).toBe('undo');
    expect(out.fallbackReason).toMatch(/no tested fix within 3 s/);
    expect(out.branch?.startsWith(`${TOOL_BRANCH_PREFIX}undo-`)).toBe(true);
    const [author, subject] = git(fixture.bare, 'log', '-1', '--format=%an%n%s', out.branch!).split(/\r?\n/);
    expect(author).toBe('Demo Bank Triage');
    expect(subject).toMatch(/^Revert "Card: the planted change"/);
    expect(git(fixture.bare, 'show', `${out.branch}:${PAGE}`)).toContain('state ok');
    expect(out.testsPassed).toBe(true);
    expect(out.filesChanged).toEqual([PAGE]);
    expect(h.prs).toHaveLength(1);
    expect(h.prs[0]!.body).toContain(`undoes commit ${fixture.badSha.slice(0, 7)}`);
  }, 60_000);

  it('a revert that conflicts gives kind none with a note, and nothing is pushed', async () => {
    fixture = plantedRepo({ conflictAfter: true });
    const h = harness(fixture, 'hang', { budgetSeconds: 2 });
    const out = await fixStepWithDetails({ group, owner, investigation: investigation(fixture.badSha), verdict: low }, h.opts);
    expect(out.kind).toBe('none');
    expect(out.note).toMatch(/conflicts/);
    expect(remoteBranches(fixture.bare)).toEqual(['main']);
    expect(h.prs).toHaveLength(0);
  }, 60_000);

  for (const [mode, why] of [
    ['outside', /guard: .*src\/shared\/util\.ts/],
    ['empty', /diff: Claude changed nothing/],
    ['breaktests', /test: tests failed/],
  ] as const) {
    it(`the guard refuses a fix (${mode}): none of the model's change is pushed, the undo runs`, async () => {
      fixture = plantedRepo();
      const h = harness(fixture, mode);
      const out = await fixStepWithDetails({ group, owner, investigation: investigation(fixture.badSha), verdict: low }, h.opts);
      expect(out.kind).toBe('undo');
      expect(out.fallbackReason).toMatch(why);
      const branches = remoteBranches(fixture.bare);
      expect(branches.filter((b) => b.startsWith(`${TOOL_BRANCH_PREFIX}fix-`))).toEqual([]);
      expect(branches).toContain(out.branch);
      // The pushed branch is main plus exactly one revert commit, and none of the model's edits.
      expect(git(fixture.bare, 'rev-list', '--count', `main..${out.branch}`)).toBe('1');
      expect(git(fixture.bare, 'diff', '--name-only', 'main', out.branch!)).toBe(PAGE);
      const page = git(fixture.bare, 'show', `${out.branch}:${PAGE}`);
      expect(page).toContain('state ok');
      expect(page).not.toContain('BROKEN');
      expect(() => git(fixture!.bare, 'show', `${out.branch}:src/shared/util.ts`)).toThrow();
    }, 60_000);
  }
});

describe('isUnder', () => {
  it('accepts only files inside the folder', () => {
    expect(isUnder('src/pages/card/CardPage.tsx', 'src/pages/card/')).toBe(true);
    expect(isUnder('src/pages/card/CardPage.tsx', 'src/pages/card')).toBe(true);
    expect(isUnder('src/pages/cards/x.ts', 'src/pages/card/')).toBe(false);
    expect(isUnder('src/pages/card/../transfers/x.ts', 'src/pages/card/')).toBe(false);
    expect(isUnder('package.json', 'src/pages/card/')).toBe(false);
    expect(isUnder('src/pages/card/x.ts', null)).toBe(false);
  });
});
