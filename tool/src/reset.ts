// The reset command: removes the tool's own work from the product repository and clears its
// report state, so a demo can start again.
//
// - Closes each open pull request whose head branch the tool made, and deletes those branches.
//   "Made by the tool" means: the branch name starts with one of TOOL_BRANCH_PREFIXES AND the
//   branch's head commit is authored by the tool's git identity. A branch that matches the prefix
//   but fails the author check is left alone and named in the output.
// - Never pushes to, resets or deletes the default branch, and never touches any other branch.
// - Says when the default branch has moved from where the planted problems left it; restoring it
//   is not this command's job.

import { config } from './config.js';
import { toolGitIdentity } from './fix.js';
import { TOOL_BRANCH_PREFIX } from './fixStep.js';
import { ghApi, spawnTool } from './steps/exec.js';
import { clearReportState } from './steps/reports.js';

/** Branch prefixes the tool pushes: step 8's, and the thin path's (writeFixPullRequest's makeBranchName). */
export const TOOL_BRANCH_PREFIXES = [TOOL_BRANCH_PREFIX, 'fix/report-'] as const;

/** Where `main` of the card app stands with both problems planted (13 Nov). Override with RESET_EXPECTED_MAIN. */
export const PLANTED_MAIN = (process.env.RESET_EXPECTED_MAIN ?? '').trim() || 'ee38468';

export interface ResetApi {
  defaultBranch(repo: string): Promise<string>;
  branches(repo: string): Promise<{ name: string; sha: string }[]>;
  /** The author name of a commit. */
  commitAuthor(repo: string, sha: string): Promise<string>;
  openPulls(repo: string): Promise<{ number: number; head: string }[]>;
  closePull(repo: string, number: number): Promise<void>;
  deleteBranch(repo: string, name: string): Promise<void>;
}

export interface ResetResult {
  repo: string;
  closedPullRequests: number[];
  deletedBranches: string[];
  /** Branches with a tool prefix whose head commit is not the tool's: not touched. */
  leftAlone: { branch: string; author: string }[];
  main: { branch: string; sha: string; expected: string; moved: boolean; note: string };
  reportStateCleared: boolean;
  errors: string[];
}

export interface ResetOptions {
  repo?: string;
  api?: ResetApi;
  expectedMain?: string;
  clearState?: () => Promise<void>;
  toolAuthor?: string;
}

const enc = encodeURIComponent;

export const ghResetApi: ResetApi = {
  async defaultBranch(repo) {
    const r = await ghApi<{ default_branch: string }>(`repos/${repo}`);
    return r.default_branch;
  },
  async branches(repo) {
    const list = await ghApi<{ name: string; commit: { sha: string } }[]>(`repos/${repo}/branches?per_page=100`);
    return list.map((b) => ({ name: b.name, sha: b.commit.sha }));
  },
  async commitAuthor(repo, sha) {
    const c = await ghApi<{ commit: { author?: { name?: string } } }>(`repos/${repo}/commits/${sha}`);
    return c.commit.author?.name ?? '';
  },
  async openPulls(repo) {
    const list = await ghApi<{ number: number; head: { ref: string; repo: { full_name: string } | null } }[]>(`repos/${repo}/pulls?state=open&per_page=100`);
    // Only pull requests from a branch of this repository; a fork's branch is never ours.
    return list.filter((p) => p.head.repo?.full_name === repo).map((p) => ({ number: p.number, head: p.head.ref }));
  },
  async closePull(repo, number) {
    const r = await spawnTool('gh', ['api', '-X', 'PATCH', `repos/${repo}/pulls/${number}`, '-f', 'state=closed'], { timeoutMs: 60_000 });
    if (r.code !== 0) throw new Error(`closing #${number} failed: ${r.stderr.trim().slice(0, 300)}`);
  },
  async deleteBranch(repo, name) {
    const r = await spawnTool('gh', ['api', '-X', 'DELETE', `repos/${repo}/git/refs/heads/${name.split('/').map(enc).join('/')}`], { timeoutMs: 60_000 });
    if (r.code !== 0) throw new Error(`deleting ${name} failed: ${r.stderr.trim().slice(0, 300)}`);
  },
};

export const isToolBranchName = (name: string): boolean => TOOL_BRANCH_PREFIXES.some((p) => name.startsWith(p));

export async function resetTool(opts: ResetOptions = {}): Promise<ResetResult> {
  const repo = opts.repo ?? config.repos[0]!;
  const api = opts.api ?? ghResetApi;
  const expected = opts.expectedMain ?? PLANTED_MAIN;
  const toolAuthor = opts.toolAuthor ?? toolGitIdentity().name;
  const errors: string[] = [];

  const defaultBranch = await api.defaultBranch(repo);
  const branches = await api.branches(repo);
  const mainSha = branches.find((b) => b.name === defaultBranch)?.sha ?? '';

  // Which prefixed branches are really the tool's.
  const ours = new Set<string>();
  const leftAlone: ResetResult['leftAlone'] = [];
  for (const b of branches) {
    if (b.name === defaultBranch || !isToolBranchName(b.name)) continue;
    const author = await api.commitAuthor(repo, b.sha);
    if (author === toolAuthor) ours.add(b.name);
    else leftAlone.push({ branch: b.name, author });
  }

  const closedPullRequests: number[] = [];
  for (const p of await api.openPulls(repo)) {
    if (!ours.has(p.head)) continue;
    try {
      await api.closePull(repo, p.number);
      closedPullRequests.push(p.number);
    } catch (err) {
      errors.push(String(err));
    }
  }
  const deletedBranches: string[] = [];
  for (const name of ours) {
    if (name === defaultBranch) continue; // never, whatever the prefix check says
    try {
      await api.deleteBranch(repo, name);
      deletedBranches.push(name);
    } catch (err) {
      errors.push(String(err));
    }
  }

  let reportStateCleared = false;
  try {
    await (opts.clearState ?? (() => clearReportState()))();
    reportStateCleared = true;
  } catch (err) {
    errors.push(`clearing the report state failed: ${String(err)}`);
  }

  const moved = !mainSha.startsWith(expected);
  return {
    repo,
    closedPullRequests,
    deletedBranches,
    leftAlone,
    main: {
      branch: defaultBranch,
      sha: mainSha,
      expected,
      moved,
      note: moved
        ? `${defaultBranch} is at ${mainSha.slice(0, 7)}, not ${expected}: it has moved (a fix may have been merged). The reset does not touch it; restore the planted problems separately.`
        : `${defaultBranch} is at ${mainSha.slice(0, 7)} as planted; not touched.`,
    },
    reportStateCleared,
    errors,
  };
}
