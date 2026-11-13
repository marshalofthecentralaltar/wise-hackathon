// Step 4. Recent changes: the commits that reached each product repository's default branch
// in the last config.recentDays days, with their files and their pull request (body and
// comments). Merge commits are not listed: their pull request is attached to the commits
// that carry the change.
import { config } from '../config.js';
import type { RecentCommit } from '../types.js';
import { GhError, ghApi, spawnTool } from './exec.js';

export type ApiGet = (path: string) => Promise<unknown>;

// Each `gh api` call is a new process (about 1.1 s on the demo laptop, measured 13 Nov 2026), and
// a run makes one per commit and pull request page. So gh is started once, for its login token,
// and the same REST paths are fetched in this process. Same endpoints, same Accept header, same
// answers. The token stays in memory and is never logged. When gh cannot give a token, every call
// goes through `gh api` as before.
let tokenPromise: Promise<string | null> | undefined;
const ghToken = (): Promise<string | null> =>
  (tokenPromise ??= spawnTool('gh', ['auth', 'token'], { timeoutMs: 15_000 }).then((r) => (r.code === 0 && r.stdout.trim() ? r.stdout.trim() : null)));

export const githubRestApi: ApiGet = async (path) => {
  const token = await ghToken();
  if (!token) return ghApi(path);
  let res: Response;
  try {
    res = await fetch(`https://api.github.com/${path}`, {
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'User-Agent': 'demo-bank-triage' },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw new GhError(`GET ${path} failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  const text = await res.text();
  if (!res.ok) throw new GhError(`GET ${path} failed (HTTP ${res.status}): ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new GhError(`GET ${path} did not return JSON`);
  }
};

export interface ChangesOptions {
  repos?: readonly string[];
  days?: number;
  now?: Date;
  /** GitHub's REST API with gh's login by default; tests pass a stub. */
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
  const api: ApiGet = opts.api ?? githubRestApi;
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
