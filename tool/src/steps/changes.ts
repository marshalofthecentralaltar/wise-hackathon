// Step 4. Recent changes: the commits that reached each product repository's default branch
// in the last config.recentDays days, with their files and their pull request (body and
// comments). Merge commits are not listed: their pull request is attached to the commits
// that carry the change.
import { config } from '../config.js';
import type { RecentCommit } from '../types.js';
import { ghApi } from './exec.js';

export type ApiGet = (path: string) => Promise<unknown>;

export interface ChangesOptions {
  repos?: readonly string[];
  days?: number;
  now?: Date;
  /** `gh api` by default; tests pass a stub. */
  api?: ApiGet;
  /** gh processes at once. */
  concurrency?: number;
}

interface GhCommit {
  sha: string;
  parents?: { sha: string }[];
  author?: { login?: string } | null;
  commit: { message: string; author?: { name?: string; date?: string }; committer?: { date?: string } };
  files?: { filename: string }[];
}

interface GhPull {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  merged_at: string | null;
}

interface GhComment {
  user?: { login?: string } | null;
  body?: string | null;
}

/** Runs fn over items with at most `limit` running at once, keeping the order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const comments = (list: unknown): { author: string; body: string }[] =>
  (Array.isArray(list) ? (list as GhComment[]) : [])
    .filter((c) => typeof c.body === 'string' && c.body.trim() !== '')
    .map((c) => ({ author: c.user?.login ?? 'unknown', body: (c.body ?? '').trim() }));

export async function listRecentChanges(opts: ChangesOptions = {}): Promise<RecentCommit[]> {
  const repos = opts.repos ?? config.repos;
  const days = opts.days ?? config.recentDays;
  const now = opts.now ?? new Date();
  const api: ApiGet = opts.api ?? ((path) => ghApi(path));
  const limit = opts.concurrency ?? 8;
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();

  const perRepo = await Promise.all(
    repos.map(async (repo) => {
      // Without sha= the list follows the default branch.
      const list = (await api(`repos/${repo}/commits?since=${encodeURIComponent(since)}&per_page=100`)) as GhCommit[];
      const changes = list.filter((c) => (c.parents?.length ?? 0) <= 1);

      const pullCache = new Map<number, Promise<RecentCommit['pullRequest']>>();
      const pullFor = (pr: GhPull) => {
        let p = pullCache.get(pr.number);
        if (!p) {
          p = (async () => {
            const [issueComments, reviewComments, reviews] = await Promise.all([
              api(`repos/${repo}/issues/${pr.number}/comments?per_page=100`),
              api(`repos/${repo}/pulls/${pr.number}/comments?per_page=100`),
              api(`repos/${repo}/pulls/${pr.number}/reviews?per_page=100`),
            ]);
            return {
              number: pr.number,
              title: pr.title,
              body: pr.body ?? '',
              url: pr.html_url,
              comments: [...comments(issueComments), ...comments(reviews), ...comments(reviewComments)],
            };
          })();
          pullCache.set(pr.number, p);
        }
        return p;
      };

      return mapLimit(changes, limit, async (c): Promise<RecentCommit> => {
        const [detail, pulls] = await Promise.all([
          api(`repos/${repo}/commits/${c.sha}`) as Promise<GhCommit>,
          api(`repos/${repo}/commits/${c.sha}/pulls`) as Promise<GhPull[]>,
        ]);
        const merged = (Array.isArray(pulls) ? pulls : []).find((p) => p.merged_at);
        const commit: RecentCommit = {
          repo,
          sha: c.sha,
          author: c.author?.login ?? c.commit.author?.name ?? 'unknown',
          mergedAt: merged?.merged_at ?? c.commit.committer?.date ?? c.commit.author?.date ?? '',
          message: c.commit.message,
          files: (detail.files ?? []).map((f) => f.filename),
        };
        if (merged) commit.pullRequest = await pullFor(merged);
        return commit;
      });
    }),
  );

  // Newest first. The sort is stable, so equal times keep GitHub's order (newest commit first).
  return perRepo.flat().sort((a, b) => Date.parse(b.mergedAt || '0') - Date.parse(a.mergedAt || '0'));
}
