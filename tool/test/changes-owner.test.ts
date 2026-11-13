import { describe, expect, it } from 'vitest';
import { listRecentChanges } from '../src/steps/changes.js';
import { findOwner, matchSlackMember, parseOwnersFile } from '../src/steps/owner.js';

const REPO = 'acme/app';
const pr = { number: 1, title: 'Live balance', body: 'Polls the balance.', html_url: 'https://github.com/acme/app/pull/1', merged_at: '2026-11-13T18:59:40Z' };
const api = async (path: string): Promise<unknown> => {
  const routes: Record<string, unknown> = {
    [`repos/${REPO}/commits/merge1`]: { files: [] },
    [`repos/${REPO}/commits/change1`]: { files: [{ filename: 'src/pages/card/useBalance.ts' }] },
    [`repos/${REPO}/commits/base1`]: { files: [{ filename: 'README.md' }, { filename: '.gitignore' }] },
    [`repos/${REPO}/commits/change1/pulls`]: [pr],
    [`repos/${REPO}/commits/base1/pulls`]: [],
    [`repos/${REPO}/issues/1/comments?per_page=100`]: [{ user: { login: 'ralf' }, body: 'Works on my phone' }],
    [`repos/${REPO}/pulls/1/comments?per_page=100`]: [{ user: { login: 'nadim' }, body: 'Interval too short?' }],
    [`repos/${REPO}/pulls/1/reviews?per_page=100`]: [{ user: { login: 'nadim' }, body: '' }],
  };
  if (path.startsWith(`repos/${REPO}/commits?since=`)) {
    return [
      { sha: 'merge1', parents: [{ sha: 'base1' }, { sha: 'change1' }], author: { login: 'ralf' }, commit: { message: 'Merge pull request #1', committer: { date: '2026-11-13T18:59:40Z' } } },
      { sha: 'change1', parents: [{ sha: 'base1' }], author: { login: 'ralf' }, commit: { message: 'Card page: keep the balance live', committer: { date: '2026-11-13T18:53:48Z' } } },
      { sha: 'base1', parents: [], author: null, commit: { message: 'Start', author: { name: 'Ralf' }, committer: { date: '2026-11-13T18:30:52Z' } } },
    ];
  }
  if (!(path in routes)) throw new Error(`unexpected ${path}`);
  return routes[path];
};

describe('listRecentChanges', () => {
  it('lists change commits newest first, merge commits once through their pull request', async () => {
    const list = await listRecentChanges({ repos: [REPO], days: 7, now: new Date('2026-11-14T10:00:00Z'), api });
    expect(list.map((c) => c.sha)).toEqual(['change1', 'base1']);
    expect(list[0]).toMatchObject({
      repo: REPO,
      author: 'ralf',
      mergedAt: '2026-11-13T18:59:40Z', // the merge time, not the commit time
      files: ['src/pages/card/useBalance.ts'],
      pullRequest: {
        number: 1,
        body: 'Polls the balance.',
        url: pr.html_url,
        comments: [
          { author: 'ralf', body: 'Works on my phone' },
          { author: 'nadim', body: 'Interval too short?' },
        ],
      },
    });
    expect(list[1]).toMatchObject({ author: 'Ralf', mergedAt: '2026-11-13T18:30:52Z', files: ['README.md', '.gitignore'] });
    expect(list[1]!.pullRequest).toBeUndefined();
  });

  it('asks for the right window', async () => {
    const seen: string[] = [];
    await listRecentChanges({ repos: [REPO], days: 7, now: new Date('2026-11-14T10:00:00Z'), api: async (p) => (seen.push(p), p.includes('?since=') ? [] : {}) });
    expect(seen).toEqual([`repos/${REPO}/commits?since=${encodeURIComponent('2026-11-07T10:00:00.000Z')}&per_page=100`]);
  });
});

const OWNERS = [
  '# Each page of the card app lives in its own folder under src/pages/.',
  '',
  '# Card page, web path /card',
  '/src/pages/card/ @nadimmetwalli',
  '',
  '# Transfers page, web path /transfers',
  '/src/pages/transfers/ @nadimmetwalli @someone-else',
  '',
  '/src/lib/ @marshalofthecentralaltar',
].join('\r\n');

describe('findOwner', () => {
  it('maps the web path in the comment above each line', () => {
    const entries = parseOwnersFile(OWNERS);
    expect(entries.map((e) => [e.webPath, e.pattern])).toEqual([
      ['/card', '/src/pages/card/'],
      ['/transfers', '/src/pages/transfers/'],
      [null, '/src/lib/'],
    ]);
  });

  it('returns the owner and asks the injected lookup for the Slack id', async () => {
    const asked: string[] = [];
    const owner = await findOwner('transfers', { repo: REPO, readOwnersFile: async () => OWNERS, lookupSlackUser: async (l) => (asked.push(l), 'U123') });
    expect(owner).toEqual({ repo: REPO, codePath: 'src/pages/transfers/', githubLogin: 'nadimmetwalli', slackUserId: 'U123', ownersLine: '/src/pages/transfers/ @nadimmetwalli @someone-else' });
    expect(asked).toEqual(['nadimmetwalli']);
  });

  it('no owners line for the page gives githubLogin null, not an error', async () => {
    const owner = await findOwner('account', { repo: REPO, readOwnersFile: async () => OWNERS, lookupSlackUser: async () => 'U1' });
    expect(owner).toEqual({ repo: REPO, codePath: null, githubLogin: null, slackUserId: null, ownersLine: null });
    const noFile = await findOwner('card', { repo: REPO, readOwnersFile: async () => null, lookupSlackUser: async () => 'U1' });
    expect(noFile.githubLogin).toBeNull();
  });

  it('a failing Slack lookup leaves slackUserId null', async () => {
    const owner = await findOwner('card', { repo: REPO, readOwnersFile: async () => OWNERS, lookupSlackUser: async () => { throw new Error('slack down'); } });
    expect(owner).toMatchObject({ githubLogin: 'nadimmetwalli', slackUserId: null });
  });

  it('matches Slack members by real name, display name or user name, ignoring bots and deleted users', () => {
    const members = [
      { id: 'UBOT', real_name: 'Ralf', is_bot: true },
      { id: 'UOLD', real_name: 'Ralf', deleted: true },
      { id: 'U1', real_name: 'Nadim Metwalli' },
      { id: 'U2', name: 'ralf.x', profile: { display_name: 'Ralf' } },
    ];
    expect(matchSlackMember(members, 'nadim metwalli')).toBe('U1');
    expect(matchSlackMember(members, 'Ralf')).toBe('U2');
    expect(matchSlackMember(members, 'Nobody')).toBeNull();
  });
});
