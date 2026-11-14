// The reset command: removes the tool's own work from the product repository and clears its
// report state, so a demo can start again.
//
// - Closes each open pull request whose head branch the tool made, and deletes those branches.
//   "Made by the tool" means: the branch name starts with one of TOOL_BRANCH_PREFIXES AND the
//   branch's head commit is authored by the tool's git identity. A branch that matches the prefix
//   but fails the author check is left alone and named in the output.
// - Never deletes the default branch, and never touches any branch but the tool's own and `main`.
// - The restore (after the steps above): when `main` of the card app has moved from the planted
//   commit, it is moved back, but only when every commit ahead of the planted one is the tool's
//   own work (authored by the tool's git identity, or a merge commit whose second parent is).
//   Only for CARD_APP_REPO (approved by the repository owner on 13 Nov, 21:12 UTC, for that one
//   repository); any other repository is refused. The move is one force update of `heads/main`
//   through GitHub's refs endpoint, never a `git push --force`.
// - Then, when the card app's deployment writes <deploy dir>/.deployed.json, waits up to 90 s
//   until it reports the planted commit.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';
import { toolGitIdentity } from './fix.js';
import { TOOL_BRANCH_PREFIX } from './fixStep.js';
import { paths } from './paths.js';
import { ghApi, spawnTool } from './steps/exec.js';
import { clearReportState } from './steps/reports.js';

/** Branch prefixes the tool pushes: step 8's, and the thin path's (writeFixPullRequest's makeBranchName). */
export const TOOL_BRANCH_PREFIXES = [TOOL_BRANCH_PREFIX, 'fix/report-'] as const;

/** The one repository whose `main` the reset may move back. Never any other. */
export const CARD_APP_REPO = 'marshalofthecentralaltar/demo-bank-card-app';

/** The commit `main` of the card app stands at with both problems planted: the merge of the restyle (card app #28, 14 Nov) on top of ee38468 (13 Nov). */
export const PLANTED_MAIN_SHA = 'a2215445f9924ef8bb6c7c419f0acaf1a5760b86';

/** Where `main` should stand. Override with RESET_EXPECTED_MAIN (a full or short sha). */
export const PLANTED_MAIN = (process.env.RESET_EXPECTED_MAIN ?? '').trim() || PLANTED_MAIN_SHA;

/** The branch the restore may move. Never any other. */
const RESTORE_BRANCH = 'main';

export const DEFAULT_DEPLOY_DIR = paths.deployDir; // CARD_APP_DEPLOY_DIR overrides (src/paths.ts)
export const DEPLOY_WAIT_MS = 90_000;

export interface AheadCommit {
  sha: string;
  author: string;
  parents: string[];
  message: string;
}

/** What the restore reads and the one write it makes. */
export interface RestoreApi {
  /** GitHub's compare endpoint, base...head. */
  compare(repo: string, base: string, head: string): Promise<{ status: string; aheadBy: number; behindBy: number; commits: AheadCommit[] }>;
  /** The full sha of a commit, from a full or short one. */
  resolveCommit(repo: string, ref: string): Promise<string>;
  /** Where a branch head stands now (read fresh, never cached). */
  branchSha(repo: string, branch: string): Promise<string>;
  /** The author name of a commit. */
  commitAuthor(repo: string, sha: string): Promise<string>;
  /** PATCH repos/{repo}/git/refs/heads/{branch} with sha and force. */
  forceUpdateRef(repo: string, branch: string, sha: string): Promise<void>;
}

export interface DeployWait {
  /** True when a deployment file was there and was watched. */
  waited: boolean;
  /** Seconds until it reported the planted commit; null when not waited or it never did. */
  seconds: number | null;
  /** The commit the deployment file reported last. */
  commit: string | null;
  ok: boolean;
  note: string;
}

export interface RestoreResult {
  status: 'not-needed' | 'restored' | 'refused' | 'failed' | 'skipped';
  repo: string;
  branch: string;
  planted: string;
  /** Where main stood before the restore. */
  mainWas: string;
  /** Where main stands after it. */
  mainNow: string;
  /** The commits that were ahead of the planted one and are no longer on main. */
  dropped: { sha: string; author: string; message: string }[];
  reason: string;
  deploy: DeployWait | null;
}

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
  restore: RestoreResult;
  errors: string[];
}

export interface ResetOptions {
  repo?: string;
  api?: ResetApi;
  expectedMain?: string;
  clearState?: () => Promise<void>;
  toolAuthor?: string;
  /** The restore's GitHub calls. Defaults to the real ones only when `api` is not given either. */
  restoreApi?: RestoreApi;
  /** false skips the restore (and the deployment wait). */
  restore?: boolean;
  deployDir?: string;
  deployWaitMs?: number;
  deployPollMs?: number;
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

export const ghRestoreApi: RestoreApi = {
  async compare(repo, base, head) {
    const r = await ghApi<{
      status: string;
      ahead_by: number;
      behind_by: number;
      commits: { sha: string; parents: { sha: string }[]; commit: { message: string; author?: { name?: string } } }[];
    }>(`repos/${repo}/compare/${base}...${head}?per_page=250`);
    return {
      status: r.status,
      aheadBy: r.ahead_by,
      behindBy: r.behind_by,
      commits: r.commits.map((c) => ({ sha: c.sha, author: c.commit.author?.name ?? '', parents: c.parents.map((p) => p.sha), message: c.commit.message.split('\n')[0] ?? '' })),
    };
  },
  async resolveCommit(repo, ref) {
    const c = await ghApi<{ sha: string }>(`repos/${repo}/commits/${ref}`);
    return c.sha;
  },
  async branchSha(repo, branch) {
    const r = await ghApi<{ object: { sha: string } }>(`repos/${repo}/git/ref/heads/${branch}`);
    return r.object.sha;
  },
  async commitAuthor(repo, sha) {
    return ghResetApi.commitAuthor(repo, sha);
  },
  async forceUpdateRef(repo, branch, sha) {
    if (repo !== CARD_APP_REPO || branch !== RESTORE_BRANCH) throw new Error(`refusing to move ${branch} of ${repo}`);
    const r = await spawnTool('gh', ['api', '-X', 'PATCH', `repos/${repo}/git/refs/heads/${branch}`, '-f', `sha=${sha}`, '-F', 'force=true'], { timeoutMs: 60_000 });
    if (r.code !== 0) throw new Error(`moving ${branch} failed: ${(r.stderr || r.stdout).trim().slice(0, 300)}`);
  },
};

export interface RestoreOptions {
  repo: string;
  api: RestoreApi;
  /** Full or short sha of the planted commit. */
  planted: string;
  toolAuthor: string;
}

/**
 * Moves `main` of the card app back to the planted commit when everything ahead of it is the
 * tool's own work. Refuses (and changes nothing) for any other repository, when main does not
 * descend from the planted commit, when any commit ahead is someone else's, or when main moved
 * while it was being read. Never throws.
 */
export async function restoreMain(opts: RestoreOptions): Promise<RestoreResult> {
  const { repo, api, toolAuthor } = opts;
  const out: RestoreResult = { status: 'refused', repo, branch: RESTORE_BRANCH, planted: opts.planted, mainWas: '', mainNow: '', dropped: [], reason: '', deploy: null };
  const refuse = (reason: string): RestoreResult => ({ ...out, status: 'refused', reason, mainNow: out.mainWas });
  if (repo !== CARD_APP_REPO) {
    return refuse(`the restore is only for ${CARD_APP_REPO}; ${repo} is refused and was not touched`);
  }
  try {
    const planted = await api.resolveCommit(repo, opts.planted);
    out.planted = planted;
    const head = await api.branchSha(repo, RESTORE_BRANCH);
    out.mainWas = head;
    out.mainNow = head;
    if (head === planted) return { ...out, status: 'not-needed', reason: `${RESTORE_BRANCH} is at the planted commit ${planted.slice(0, 7)}` };

    const cmp = await api.compare(repo, planted, head);
    if (cmp.status !== 'ahead' || cmp.behindBy !== 0) {
      return refuse(`${RESTORE_BRANCH} (${head.slice(0, 7)}) does not descend from the planted commit ${planted.slice(0, 7)} (compare says ${cmp.status}); nothing was changed`);
    }
    if (cmp.commits.length !== cmp.aheadBy) {
      return refuse(`GitHub listed ${cmp.commits.length} of ${cmp.aheadBy} commits ahead; nothing was changed`);
    }
    const authorOf = new Map(cmp.commits.map((c) => [c.sha, c.author]));
    for (const c of cmp.commits) {
      if (c.author === toolAuthor) continue;
      const second = c.parents.length === 2 ? c.parents[1]! : null;
      const secondAuthor = second ? (authorOf.get(second) ?? (await api.commitAuthor(repo, second))) : null;
      if (second && secondAuthor === toolAuthor) continue;
      return refuse(`commit ${c.sha.slice(0, 7)} ("${c.message}") by ${c.author || 'unknown'} is on ${RESTORE_BRANCH} and is not the tool's work; nothing was changed`);
    }
    out.dropped = cmp.commits.map((c) => ({ sha: c.sha, author: c.author, message: c.message }));

    // Re-read just before the move: if anything landed meanwhile, it was not checked.
    const again = await api.branchSha(repo, RESTORE_BRANCH);
    if (again !== head) {
      return { ...refuse(`${RESTORE_BRANCH} moved from ${head.slice(0, 7)} to ${again.slice(0, 7)} while it was being checked; nothing was changed`), mainNow: again, dropped: [] };
    }
    await api.forceUpdateRef(repo, RESTORE_BRANCH, planted);
    out.mainNow = await api.branchSha(repo, RESTORE_BRANCH);
    if (out.mainNow !== planted) return { ...out, status: 'failed', reason: `after the move ${RESTORE_BRANCH} reads ${out.mainNow.slice(0, 7)}, not ${planted.slice(0, 7)}` };
    return { ...out, status: 'restored', reason: `${RESTORE_BRANCH} moved back from ${head.slice(0, 7)} to the planted commit ${planted.slice(0, 7)}; ${out.dropped.length} commit(s) of the tool dropped` };
  } catch (err) {
    return { ...out, status: 'failed', reason: `the restore failed: ${err instanceof Error ? err.message : String(err)}`, dropped: out.mainNow === out.planted ? out.dropped : [] };
  }
}

/** Reads <deployDir>/.deployed.json; null when it is not there or not readable. */
export function readDeployed(deployDir: string): { commit: string; at: string } | null {
  const path = join(deployDir, '.deployed.json');
  if (!existsSync(path)) return null;
  try {
    const v = JSON.parse(readFileSync(path, 'utf8')) as { commit?: unknown; at?: unknown };
    return { commit: typeof v.commit === 'string' ? v.commit : '', at: typeof v.at === 'string' ? v.at : '' };
  } catch {
    return { commit: '', at: '' };
  }
}

const sameCommit = (a: string, b: string) => !!a && !!b && (a.startsWith(b) || b.startsWith(a));

/** Waits until the deployment file reports `commit`. No file: says so and does not wait. */
export async function waitForDeployment(commit: string, opts: { deployDir: string; waitMs?: number; pollMs?: number }): Promise<DeployWait> {
  const path = join(opts.deployDir, '.deployed.json');
  if (!readDeployed(opts.deployDir)) return { waited: false, seconds: null, commit: null, ok: true, note: 'no deployment file, not waited' };
  const t0 = performance.now();
  const deadline = t0 + (opts.waitMs ?? DEPLOY_WAIT_MS);
  let last = '';
  for (;;) {
    last = readDeployed(opts.deployDir)?.commit ?? '';
    if (sameCommit(last, commit)) {
      return { waited: true, seconds: Math.round((performance.now() - t0) / 100) / 10, commit: last, ok: true, note: `${path} reports ${commit.slice(0, 7)}` };
    }
    if (performance.now() >= deadline) break;
    await new Promise((r) => setTimeout(r, opts.pollMs ?? 1000));
  }
  const secs = Math.round((opts.waitMs ?? DEPLOY_WAIT_MS) / 1000);
  return { waited: true, seconds: null, commit: last || null, ok: false, note: `${path} still reports ${last.slice(0, 7) || 'nothing'} after ${secs} s, not ${commit.slice(0, 7)}` };
}

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

  // The restore, after the branches above are gone.
  const restoreApi = opts.restoreApi ?? (opts.api ? undefined : ghRestoreApi);
  let restore: RestoreResult;
  if (opts.restore === false || !restoreApi) {
    restore = { status: 'skipped', repo, branch: RESTORE_BRANCH, planted: expected, mainWas: mainSha, mainNow: mainSha, dropped: [], reason: opts.restore === false ? 'the restore was switched off' : 'no restore api given', deploy: null };
  } else if (defaultBranch !== RESTORE_BRANCH) {
    restore = { status: 'refused', repo, branch: RESTORE_BRANCH, planted: expected, mainWas: mainSha, mainNow: mainSha, dropped: [], reason: `the default branch is ${defaultBranch}, not ${RESTORE_BRANCH}; nothing was changed`, deploy: null };
  } else {
    restore = await restoreMain({ repo, api: restoreApi, planted: expected, toolAuthor });
    if (restore.status === 'restored' || restore.status === 'not-needed') {
      restore.deploy = await waitForDeployment(restore.planted, { deployDir: opts.deployDir ?? DEFAULT_DEPLOY_DIR, waitMs: opts.deployWaitMs, pollMs: opts.deployPollMs });
      if (!restore.deploy.ok) errors.push(`the deployment did not reach the planted commit: ${restore.deploy.note}`);
    }
  }
  if (restore.status === 'refused' && moved) errors.push(`main was not restored: ${restore.reason}`);
  if (restore.status === 'failed') errors.push(restore.reason);

  const note = !moved
    ? `${defaultBranch} is at ${mainSha.slice(0, 7)} as planted; not touched.`
    : restore.status === 'restored'
      ? `${defaultBranch} was at ${mainSha.slice(0, 7)}, not ${expected.slice(0, 7)}: it had moved (a fix was merged). ${restore.reason}.`
      : `${defaultBranch} is at ${mainSha.slice(0, 7)}, not ${expected.slice(0, 7)}: it has moved (a fix may have been merged). Not restored: ${restore.reason}.`;
  return {
    repo,
    closedPullRequests,
    deletedBranches,
    leftAlone,
    main: { branch: defaultBranch, sha: mainSha, expected, moved, note },
    reportStateCleared,
    restore,
    errors,
  };
}
