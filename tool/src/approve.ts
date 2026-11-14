// Step 10, the "Approve fix" button. A press merges the pull request only when the person who
// pressed is the owner named in that handoff. Everyone else gets a line only they see, and
// nothing is merged. After a merge the button is replaced by who approved and when; a later
// press does nothing.
//
// What a press is checked against survives a restart: the owner's Slack id, the repository and
// the pull request number travel in the button's own value (Slack returns it unchanged), and
// each merge is recorded in tool/.state/approvals.json.
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APPROVE_BLOCK_ID, formatUtc, type ApproveValue } from './handoff.js';
import type { SlackBlock, SlackPort } from './slackPost.js';
import { spawnTool } from './steps/exec.js';

export const DEFAULT_APPROVALS_PATH = fileURLToPath(new URL('../.state/approvals.json', import.meta.url));

export type GhRunner = (args: string[]) => Promise<{ code: number | null; stdout: string; stderr: string }>;

/** The real runner: `gh` without a shell, with the child environment of every other step. */
export const realGh: GhRunner = (args) => spawnTool('gh', args, { timeoutMs: 60_000 });

export interface ApprovePress {
  /** Slack user id of whoever pressed. */
  userId: string;
  channel: string;
  /** ts of the handoff message that carries the button. */
  messageTs: string;
  threadTs?: string;
  /** The button's value. */
  value: string;
  /** Set by the rehearsal script (autoApprove.ts): no person pressed; the thread must say so. */
  unattended?: boolean;
  /** The handoff's blocks as Slack sent them with the press, so the button can be replaced. */
  blocks?: SlackBlock[];
}

export interface ApproveDeps {
  slack: SlackPort;
  gh?: GhRunner;
  statePath?: string;
  now?: () => Date;
  log?: (m: string) => void;
}

export type ApproveResult = 'merged' | 'not-owner' | 'already-approved' | 'in-progress' | 'bad-value' | 'merge-failed';

interface ApprovalRecord {
  by: string;
  at: string;
  channel: string;
  messageTs: string;
}

export function parseApproveValue(value: string): ApproveValue | null {
  try {
    const v = JSON.parse(value) as Partial<ApproveValue>;
    if (typeof v.repo !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(v.repo)) return null;
    if (typeof v.pr !== 'number' || !Number.isInteger(v.pr) || v.pr <= 0) return null;
    if (typeof v.owner !== 'string' || !/^[UW][A-Z0-9]+$/.test(v.owner)) return null;
    const approvers = Array.isArray(v.approvers) ? v.approvers.filter((a): a is string => typeof a === 'string' && /^[UW][A-Z0-9]+$/.test(a)) : [];
    return { repo: v.repo, pr: v.pr, owner: v.owner, group: typeof v.group === 'string' ? v.group : '', ...(approvers.length ? { approvers } : {}) };
  } catch {
    return null;
  }
}

const keyOf = (v: ApproveValue) => `${v.repo}#${v.pr}`;

function readApprovals(path: string): Record<string, ApprovalRecord> {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, ApprovalRecord>;
  } catch {
    return {};
  }
}

/** Presses being handled right now, so two quick presses cannot merge twice. */
const inFlight = new Set<string>();

export function approvedBlocks(blocks: SlackBlock[] | undefined, line: string): SlackBlock[] | undefined {
  if (!blocks) return undefined;
  return blocks.map((b) =>
    b.block_id === APPROVE_BLOCK_ID ? { type: 'section', block_id: APPROVE_BLOCK_ID, text: { type: 'mrkdwn', text: line } } : b,
  );
}

export async function handleApprovePress(press: ApprovePress, deps: ApproveDeps): Promise<ApproveResult> {
  const gh = deps.gh ?? realGh;
  const statePath = deps.statePath ?? DEFAULT_APPROVALS_PATH;
  const log = deps.log ?? ((m: string) => console.error(m));
  const now = deps.now ?? (() => new Date());
  const tell = (text: string) =>
    deps.slack.postEphemeral({ channel: press.channel, user: press.userId, threadTs: press.threadTs, text }).catch((err) => log(`[approve] ephemeral failed: ${String(err)}`));

  const value = parseApproveValue(press.value);
  if (!value) {
    log('[approve] a press carried a value the tool did not write; nothing merged');
    return 'bad-value';
  }
  const key = keyOf(value);
  if (readApprovals(statePath)[key]) return 'already-approved';
  if (!(value.approvers ?? [value.owner]).includes(press.userId)) {
    await tell('Only the people tagged as owner in this handoff can approve the fix. Nothing was merged.');
    return 'not-owner';
  }
  if (inFlight.has(key)) return 'in-progress';
  inFlight.add(key);
  try {
    const r = await gh(['pr', 'merge', String(value.pr), '--repo', value.repo, '--merge']);
    if (r.code !== 0) {
      const why = (r.stderr || r.stdout).trim().split('\n')[0]?.slice(0, 200) ?? '';
      log(`[approve] gh pr merge ${value.pr} --repo ${value.repo} failed (exit ${r.code}): ${why}`);
      await tell(`The merge did not go through: ${why || `gh exit ${r.code}`}. Nothing was changed; you can press again.`);
      return 'merge-failed';
    }
    const at = now();
    const approvals = readApprovals(statePath);
    approvals[key] = { by: press.unattended ? `rehearsal script for ${press.userId}` : press.userId, at: at.toISOString(), channel: press.channel, messageTs: press.messageTs };
    await mkdir(dirname(statePath), { recursive: true });
    await writeFile(statePath, JSON.stringify(approvals, null, 2), 'utf8');
    const line = press.unattended
      ? `Approved by the rehearsal script for <@${press.userId}>, without a person pressing the button, on ${formatUtc(at)}. Pull request #${value.pr} is merged.`
      : `Fix approved by <@${press.userId}> on ${formatUtc(at)}. Pull request #${value.pr} is merged.`;
    try {
      await deps.slack.updateMessage({ channel: press.channel, ts: press.messageTs, text: line, blocks: approvedBlocks(press.blocks, line) });
    } catch (err) {
      log(`[approve] merged, but the button could not be replaced: ${String(err)}`);
    }
    if (press.unattended) {
      // The pull request says "Nothing is merged until a person approves it": say on it that no person did.
      const note = 'Merged by the rehearsal script on behalf of the owner named in the Slack handoff. No person pressed "Approve fix" for this pull request.';
      const c = await gh(['pr', 'comment', String(value.pr), '--repo', value.repo, '--body', note]);
      if (c.code !== 0) log(`[approve] merged, but the rehearsal note could not be added to #${value.pr}: ${(c.stderr || c.stdout).trim().split('\n')[0] ?? ''}`);
    }
    log(`[approve] merged ${key} for ${press.userId}`);
    return 'merged';
  } finally {
    inFlight.delete(key);
  }
}
