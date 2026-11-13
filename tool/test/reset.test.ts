import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CARD_APP_REPO, PLANTED_MAIN_SHA, resetTool, restoreMain, waitForDeployment, type AheadCommit, type ResetApi, type RestoreApi } from '../src/reset.js';

function stubApi(mainSha = 'ee38468aaaa') {
  const branches = [
    { name: 'main', sha: mainSha },
    { name: 'feat/live-balance', sha: 'f1' },
    { name: 'triage/fix-20261113-aaa', sha: 't1' },
    { name: 'triage/undo-20261113-bbb', sha: 't2' },
    { name: 'fix/report-20261113-ccc', sha: 't3' },
    // Carries the tool's prefix but a person made it: must be left alone.
    { name: 'triage/fix-by-hand', sha: 'h1' },
  ];
  const authors: Record<string, string> = { [mainSha]: 'Someone', f1: 'Someone', t1: 'Demo Bank Triage', t2: 'Demo Bank Triage', t3: 'Demo Bank Triage', h1: 'A Developer' };
  const pulls = [
    { number: 3, head: 'triage/fix-20261113-aaa' },
    { number: 4, head: 'triage/fix-by-hand' },
    { number: 5, head: 'feat/live-balance' },
  ];
  const closed: number[] = [];
  const deleted: string[] = [];
  const api: ResetApi = {
    defaultBranch: async () => 'main',
    branches: async () => branches,
    commitAuthor: async (_r, sha) => authors[sha] ?? '',
    openPulls: async () => pulls,
    closePull: async (_r, n) => void closed.push(n),
    deleteBranch: async (_r, name) => void deleted.push(name),
  };
  return { api, closed, deleted };
}

describe('resetTool', () => {
  it('closes and deletes only the branches the tool made; a prefixed branch by someone else is left and named', async () => {
    const s = stubApi();
    let cleared = 0;
    const r = await resetTool({ repo: 'o/card-app', api: s.api, expectedMain: 'ee38468', clearState: async () => void cleared++ });
    expect(s.closed).toEqual([3]);
    expect(s.deleted.sort()).toEqual(['fix/report-20261113-ccc', 'triage/fix-20261113-aaa', 'triage/undo-20261113-bbb']);
    expect(s.deleted).not.toContain('main');
    expect(s.deleted).not.toContain('feat/live-balance');
    expect(s.deleted).not.toContain('triage/fix-by-hand');
    expect(r.leftAlone).toEqual([{ branch: 'triage/fix-by-hand', author: 'A Developer' }]);
    expect(r.main.moved).toBe(false);
    expect(r.reportStateCleared).toBe(true);
    expect(cleared).toBe(1);
  });

  it('says so when main has moved, and still never touches it', async () => {
    const s = stubApi('1234567ffff');
    const r = await resetTool({ repo: 'o/card-app', api: s.api, expectedMain: 'ee38468', clearState: async () => undefined });
    expect(r.main.moved).toBe(true);
    expect(r.main.note).toMatch(/has moved/);
    expect(s.deleted).not.toContain('main');
  });
});

// ---------------------------------------------------------------------------------------------
// The restore: main of the card app moved back to the planted commit, only when everything ahead
// of it is the tool's work. A stand-in GitHub that records every call.

const TOOL = 'Demo Bank Triage';
const P = PLANTED_MAIN_SHA;

function standInGitHub(opts: { main: string; compareStatus?: string; behindBy?: number; ahead?: AheadCommit[]; authors?: Record<string, string>; mainAfterCheck?: string }) {
  let main = opts.main;
  let branchReads = 0;
  const refCalls: { repo: string; branch: string; sha: string }[] = [];
  const api: RestoreApi = {
    resolveCommit: async (_r, ref) => (P.startsWith(ref) ? P : ref),
    branchSha: async () => {
      branchReads++;
      // The second read is the one just before the move.
      if (branchReads === 2 && opts.mainAfterCheck) main = opts.mainAfterCheck;
      return main;
    },
    compare: async () => {
      const ahead = opts.ahead ?? [];
      return { status: opts.compareStatus ?? (ahead.length ? 'ahead' : 'identical'), aheadBy: ahead.length, behindBy: opts.behindBy ?? 0, commits: ahead };
    },
    commitAuthor: async (_r, sha) => opts.authors?.[sha] ?? '',
    forceUpdateRef: async (repo, branch, sha) => {
      refCalls.push({ repo, branch, sha });
      main = sha;
    },
  };
  return { api, refCalls };
}

const toolCommit: AheadCommit = { sha: 'a1'.repeat(20), author: TOOL, parents: [P], message: 'Stop the card picture from being remounted' };
const mergeOfTool: AheadCommit = { sha: 'b2'.repeat(20), author: 'marshalofthecentralaltar', parents: [P, toolCommit.sha], message: 'Merge pull request #9 from triage/fix-x' };

describe('restoreMain', () => {
  it("everything ahead is the tool's (its commit and the merge of it): exactly one refs call with the planted commit and force", async () => {
    const gh = standInGitHub({ main: mergeOfTool.sha, ahead: [toolCommit, mergeOfTool] });
    const r = await restoreMain({ repo: CARD_APP_REPO, api: gh.api, planted: P, toolAuthor: TOOL });
    expect(gh.refCalls).toEqual([{ repo: CARD_APP_REPO, branch: 'main', sha: P }]);
    expect(r.status).toBe('restored');
    expect(r.mainWas).toBe(mergeOfTool.sha);
    expect(r.mainNow).toBe(P);
    expect(r.dropped.map((d) => d.sha)).toEqual([toolCommit.sha, mergeOfTool.sha]);
  });

  it('a commit by "A Developer" ahead: zero calls, and the commit is named', async () => {
    const human: AheadCommit = { sha: 'c3'.repeat(20), author: 'A Developer', parents: [toolCommit.sha], message: 'Tweak the header' };
    const gh = standInGitHub({ main: human.sha, ahead: [toolCommit, human] });
    const r = await restoreMain({ repo: CARD_APP_REPO, api: gh.api, planted: P, toolAuthor: TOOL });
    expect(gh.refCalls).toEqual([]);
    expect(r.status).toBe('refused');
    expect(r.reason).toContain('c3c3c3c');
    expect(r.reason).toContain('A Developer');
    expect(r.mainNow).toBe(human.sha);
    expect(r.dropped).toEqual([]);
  });

  it("a merge whose second parent is someone else's: zero calls", async () => {
    const human: AheadCommit = { sha: 'd4'.repeat(20), author: 'A Developer', parents: [P], message: 'Hand fix' };
    const merge: AheadCommit = { sha: 'e5'.repeat(20), author: 'marshalofthecentralaltar', parents: [P, human.sha], message: 'Merge pull request #10' };
    const gh = standInGitHub({ main: merge.sha, ahead: [human, merge] });
    const r = await restoreMain({ repo: CARD_APP_REPO, api: gh.api, planted: P, toolAuthor: TOOL });
    expect(gh.refCalls).toEqual([]);
    expect(r.status).toBe('refused');
  });

  it('main not descending from the planted commit: zero calls', async () => {
    const gh = standInGitHub({ main: 'f6'.repeat(20), compareStatus: 'diverged', behindBy: 2, ahead: [toolCommit] });
    const r = await restoreMain({ repo: CARD_APP_REPO, api: gh.api, planted: P, toolAuthor: TOOL });
    expect(gh.refCalls).toEqual([]);
    expect(r.status).toBe('refused');
    expect(r.reason).toMatch(/does not descend/);
  });

  it('another repository: zero calls of any kind, and a refusal', async () => {
    let calls = 0;
    const counting = new Proxy({} as RestoreApi, {
      get: () => async () => {
        calls++;
        return '';
      },
    });
    const r = await restoreMain({ repo: 'marshalofthecentralaltar/wise-hackathon', api: counting, planted: P, toolAuthor: TOOL });
    expect(calls).toBe(0);
    expect(r.status).toBe('refused');
    expect(r.reason).toMatch(/only for marshalofthecentralaltar\/demo-bank-card-app/);
  });

  it('main already at the planted commit: zero calls', async () => {
    const gh = standInGitHub({ main: P });
    const r = await restoreMain({ repo: CARD_APP_REPO, api: gh.api, planted: 'ee38468', toolAuthor: TOOL });
    expect(gh.refCalls).toEqual([]);
    expect(r.status).toBe('not-needed');
    expect(r.mainNow).toBe(P);
  });

  it('main moving between the check and the move: zero calls', async () => {
    const gh = standInGitHub({ main: mergeOfTool.sha, ahead: [toolCommit, mergeOfTool], mainAfterCheck: '99'.repeat(20) });
    const r = await restoreMain({ repo: CARD_APP_REPO, api: gh.api, planted: P, toolAuthor: TOOL });
    expect(gh.refCalls).toEqual([]);
    expect(r.status).toBe('refused');
    expect(r.reason).toMatch(/moved .* while it was being checked/);
  });
});

describe('resetTool with the restore', () => {
  it('runs the restore after closing and deleting, and reports what main was and is', async () => {
    const s = stubApi(mergeOfTool.sha);
    const gh = standInGitHub({ main: mergeOfTool.sha, ahead: [toolCommit, mergeOfTool] });
    const dir = mkdtempSync(join(tmpdir(), 'reset-deploy-'));
    try {
      const r = await resetTool({ repo: CARD_APP_REPO, api: s.api, restoreApi: gh.api, expectedMain: P, clearState: async () => undefined, deployDir: dir });
      expect(s.closed).toEqual([3]);
      expect(gh.refCalls).toHaveLength(1);
      expect(r.restore.status).toBe('restored');
      expect(r.restore.mainWas).toBe(mergeOfTool.sha);
      expect(r.restore.mainNow).toBe(P);
      expect(r.restore.deploy?.note).toBe('no deployment file, not waited');
      expect(r.errors).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('waitForDeployment', () => {
  it('no file: does not wait; a file that reaches the commit: waits and reports seconds; one that never does: not ok', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'deploy-wait-'));
    try {
      expect(await waitForDeployment(P, { deployDir: dir })).toMatchObject({ waited: false, note: 'no deployment file, not waited' });
      writeFileSync(join(dir, '.deployed.json'), JSON.stringify({ commit: 'old1234', at: '' }));
      setTimeout(() => writeFileSync(join(dir, '.deployed.json'), JSON.stringify({ commit: P, at: '' })), 30);
      const ok = await waitForDeployment(P, { deployDir: dir, waitMs: 2000, pollMs: 10 });
      expect(ok.ok).toBe(true);
      expect(ok.waited).toBe(true);
      expect(typeof ok.seconds).toBe('number');
      writeFileSync(join(dir, '.deployed.json'), JSON.stringify({ commit: 'old1234', at: '' }));
      const late = await waitForDeployment(P, { deployDir: dir, waitMs: 50, pollMs: 10 });
      expect(late.ok).toBe(false);
      expect(late.seconds).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
