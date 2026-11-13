import { describe, expect, it } from 'vitest';
import { resetTool, type ResetApi } from '../src/reset.js';

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
