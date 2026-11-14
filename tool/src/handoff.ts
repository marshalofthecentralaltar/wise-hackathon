// Step 9. The handoff: one Slack message in the eight parts of docs/CONTEXT.md "The handoff",
// in that order. Part 7 (the pull request and the "Approve fix" button) only when a pull
// request exists. This is the only message of a run that names or tags the owner.
import { config } from './config.js';
import { askClaude } from './steps/exec.js';
import { grafanaLink } from './grafana.js';
import type { Handoff, Investigation, ReportGroup } from './types.js';
import type { SlackBlock } from './slackPost.js';

export const APPROVE_ACTION_ID = 'approve_fix';
export const APPROVE_BLOCK_ID = 'approve_fix_block';

export type HandoffPartId = 'problem' | 'reports' | 'monitoring' | 'origin' | 'code' | 'next' | 'fix' | 'customers';
export const PART_ORDER: HandoffPartId[] = ['problem', 'reports', 'monitoring', 'origin', 'code', 'next', 'fix', 'customers'];

export interface HandoffPart {
  id: HandoffPartId;
  /** Slack mrkdwn. */
  text: string;
}

/** What the "Approve fix" button carries, so a press can be checked after a restart. */
export interface ApproveValue {
  repo: string;
  pr: number;
  /** Slack user id of the owner named in the handoff: the only person whose press merges. */
  owner: string;
  group: string;
  /** Everyone whose press merges: the owner, then config.approvers. Missing: the owner only. */
  approvers?: string[];
}

/** The owner first, then config.approvers, no repeats. Empty when nobody is matched in Slack. */
export function approversFor(ownerSlackId: string | null, extra: string[] = config.approvers): string[] {
  return [...new Set([...(ownerSlackId ? [ownerSlackId] : []), ...extra])];
}

export interface HandoffMessage {
  parts: HandoffPart[];
  blocks: SlackBlock[];
  /** The whole handoff as one string, for notifications and clients without blocks. */
  text: string;
  approve: ApproveValue | null;
}

/** Slack mrkdwn needs &, < and > escaped in any text the tool did not write itself. */
export const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const link = (url: string, label: string) => `<${url}|${esc(label)}>`;
const code = (s: string) => '`' + s.replace(/`/g, "'") + '`';
const shortSha = (sha: string) => sha.slice(0, 7);
const sentence = (s: string) => {
  const t = s.trim();
  return t === '' || /[.!?]$/.test(t) ? t : `${t}.`;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "13 Nov 2026, 14:02 UTC"; the input unchanged when it is not a date. */
export function formatUtc(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return String(iso);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${hh}:${mm} UTC`;
}

export function revertSentence(revertsCleanly: boolean | null): string {
  if (revertsCleanly === true) return 'A trial revert in a scratch copy applied cleanly, so this commit reverts cleanly.';
  if (revertsCleanly === false) return 'A trial revert in a scratch copy conflicted with later changes, so this commit does not revert cleanly.';
  return 'A trial revert was not tried, so whether it reverts cleanly is not known.';
}

function originPart(inv: Investigation): string {
  if (!inv.found || !inv.commitSha) return '*Origin:* the tool could not name the commit responsible.';
  const bits = [`commit ${code(shortSha(inv.commitSha))}`];
  if (inv.commitAuthor) bits.push(`by ${esc(inv.commitAuthor)}`);
  let first = `*Origin:* ${bits.join(' ')}`;
  if (inv.mergedAt) first += `, merged ${formatUtc(inv.mergedAt)}`;
  if (inv.pullRequestUrl) first += ` (${link(inv.pullRequestUrl, 'its pull request')})`;
  return `${first}. ${revertSentence(inv.revertsCleanly)}`;
}

function codePart(inv: Investigation): string {
  const where = inv.file ? `${code(inv.file)}${inv.lines ? `, lines ${esc(inv.lines)}` : ''}. ` : '';
  const what = sentence(esc(inv.whatIsWrong)) || 'The tool did not find what is wrong in the code.';
  return `*The problem in the code:* ${where}${what}`;
}

function ownerLine(h: Handoff): string {
  const o = h.owner;
  if (!o.githubLogin) {
    return 'No owners line covers this page, so nobody is tagged. Who owns it? Please answer in this thread.';
  }
  const tagged = approversFor(o.slackUserId);
  const who = tagged.length ? tagged.map((id) => `<@${id}>`).join(' ') : `${esc(o.githubLogin)} on GitHub (not found in this Slack workspace)`;
  const from = o.ownersLine ? `, from the owners line ${code(o.ownersLine)}` : '';
  return `Owner: ${who}${from}.`;
}

function nextPart(h: Handoff): string {
  const lines = h.investigation.nextSteps.map((s) => `• ${sentence(esc(s))}`);
  if (h.verdict.severity === 'low' && !h.fix.prUrl) {
    lines.push(`• No pull request was opened${h.fix.note ? `: ${sentence(esc(h.fix.note))}` : '.'}`);
  }
  lines.push(`• ${ownerLine(h)}`);
  return `*Next steps:*\n${lines.join('\n')}`;
}

function fixPart(h: Handoff): string {
  const f = h.fix;
  const label = f.prNumber ? `pull request #${f.prNumber}` : 'pull request';
  const what = f.kind === 'undo' ? 'undoes the commit above' : 'fixes it';
  const files = f.filesChanged.length ? ` It changes ${f.filesChanged.map(code).join(', ')}.` : '';
  const tests = f.testsPassed === true ? ' The tests passed.' : f.testsPassed === false ? ' The tests failed.' : '';
  const who = approversFor(h.owner.slackUserId).length ? ' Anyone tagged as owner here can approve it.' : ' There is no "Approve fix" button because nobody in this Slack workspace is matched to the owner. Merge it on GitHub.';
  return `*Fix:* ${link(f.prUrl!, label)} ${what}.${files}${tests}${who}`;
}

/** Builds the handoff. Pure: no Slack or model call. */
export function buildHandoffMessage(h: Handoff): HandoffMessage {
  const { group, monitoring, verdict } = h;
  const grafana = grafanaLink(group);
  const reportLinks = group.reports.map((r, i) => (r.permalink ? link(r.permalink, String(i + 1)) : String(i + 1)));
  const n = group.reports.length;
  const parts: HandoffPart[] = [
    {
      id: 'problem',
      text: `*Problem:* ${sentence(esc(group.summary))} *Severity: ${verdict.severity}.* ${sentence(esc(verdict.reason))}`,
    },
    { id: 'reports', text: `*Reports:* ${n} ${n === 1 ? 'message' : 'messages'} in #${config.supportChannel}: ${reportLinks.join(', ')}.` },
    { id: 'monitoring', text: `*Monitoring and logs:* ${sentence(esc(monitoring.summary)) || 'nothing.'}${grafana ? ` ${grafana}` : ''}` },
    { id: 'origin', text: originPart(h.investigation) },
    { id: 'code', text: codePart(h.investigation) },
    { id: 'next', text: nextPart(h) },
  ];
  if (h.fix.prUrl) parts.push({ id: 'fix', text: fixPart(h) });
  parts.push({ id: 'customers', text: `*What support may tell customers:* "${esc(h.sentenceForCustomers.trim())}"` });

  const blocks: SlackBlock[] = [];
  let approve: ApproveValue | null = null;
  for (const p of parts) {
    blocks.push({ type: 'section', block_id: `handoff_${p.id}`, text: { type: 'mrkdwn', text: p.text.slice(0, 2900) } });
    const approvers = approversFor(h.owner.slackUserId);
    if (p.id === 'fix' && approvers.length && h.fix.prNumber && h.fix.prUrl) {
      approve = { repo: h.investigation.repo || h.owner.repo, pr: h.fix.prNumber, owner: approvers[0]!, group: group.id, approvers };
      blocks.push({
        type: 'actions',
        block_id: APPROVE_BLOCK_ID,
        elements: [
          {
            type: 'button',
            action_id: APPROVE_ACTION_ID,
            style: 'primary',
            text: { type: 'plain_text', text: 'Approve fix' },
            value: JSON.stringify(approve),
          },
        ],
      });
    }
  }
  return { parts, blocks, text: parts.map((p) => p.text).join('\n\n'), approve };
}

// ---------------------------------------------------------------------------------------------
// Part 8: one sentence support may tell the customers.

export const CUSTOMER_SENTENCE_TIMEOUT_MS = 15_000;

export function fallbackCustomerSentence(group: Pick<ReportGroup, 'page'>): string {
  const where = group.page ? ` on the ${group.page} page` : '';
  return `We know about this problem${where} and our team is working on it.`;
}

const SYSTEM = [
  'You write exactly one sentence a bank support agent may send to customers who reported a problem in the app.',
  'Plain, calm English. Say we know about the problem and are working on it.',
  'Never name a person, a team, a commit, a file, code or a cause inside the code.',
  'Never promise a time or a date. Do not apologise more than once. No em dashes.',
  'Answer with the sentence only.',
].join(' ');

/** The prompt carries only what customers said: no commit, file or owner is ever given to it. */
export function buildCustomerSentencePrompt(group: Pick<ReportGroup, 'summary' | 'page'>): string {
  return [`The problem, as customers describe it: ${group.summary}`, `Page: ${group.page ?? 'not known'}`, 'Write the sentence.'].join('\n');
}

/** Words and shapes a customer sentence must not carry; the fallback is used instead. */
export function customerSentenceProblem(text: string, forbidden: string[] = []): string | null {
  const t = text.trim();
  if (!t) return 'empty';
  if (t.length > 300) return 'too long';
  if (t.split(/(?<=[.!?])\s+/).filter(Boolean).length > 1) return 'more than one sentence';
  if (/[—–]/.test(t)) return 'dash';
  if (/\b[0-9a-f]{7,40}\b/i.test(t)) return 'commit-like id';
  if (/[\w-]+\.(tsx?|jsx?|json|css|html)\b|\bsrc\//i.test(t)) return 'file name';
  if (/\b(today|tomorrow|tonight|minutes?|hours?|days?|by (monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d))\b/i.test(t)) return 'time promise';
  for (const f of forbidden) if (f && t.toLowerCase().includes(f.toLowerCase())) return 'names a person or code';
  return null;
}

export type TextModel = (prompt: string, system: string) => Promise<{ ok: boolean; text: string }>;

const defaultModel: TextModel = (prompt, system) => askClaude(prompt, system, config.groupingModel, CUSTOMER_SENTENCE_TIMEOUT_MS);

/**
 * The model call alone: the draft sentence, or null when the call fails or takes more than 15 s.
 * It needs only the group, so the pipeline starts it at the top of the run. Never rejects.
 */
export async function draftCustomerSentence(
  group: Pick<ReportGroup, 'summary' | 'page'>,
  opts: { model?: TextModel; timeoutMs?: number } = {},
): Promise<string | null> {
  const model = opts.model ?? defaultModel;
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), opts.timeoutMs ?? CUSTOMER_SENTENCE_TIMEOUT_MS);
  });
  try {
    const answer = await Promise.race([model(buildCustomerSentencePrompt(group), SYSTEM).catch(() => null), timeout]);
    return answer && answer.ok ? answer.text.trim().replace(/^"|"$/g, '') : null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The sentence that goes into part 8: the draft when it passes every rule, with the owner, the
 * commit and the file known by now as forbidden strings; otherwise the fixed sentence.
 */
export function finalCustomerSentence(
  draft: string | null,
  group: Pick<ReportGroup, 'page'>,
  forbidden: string[] = [],
  log?: (m: string) => void,
): string {
  const fallback = fallbackCustomerSentence(group);
  if (draft === null) {
    log?.('[handoff] customer sentence: model failed or timed out; using the fixed sentence');
    return fallback;
  }
  const problem = customerSentenceProblem(draft, forbidden);
  if (problem) {
    log?.(`[handoff] customer sentence rejected (${problem}); using the fixed sentence`);
    return fallback;
  }
  return draft;
}

/** Draft and check in one go. Never rejects. */
export async function customerSentence(
  group: Pick<ReportGroup, 'summary' | 'page'>,
  opts: { forbidden?: string[]; model?: TextModel; timeoutMs?: number; log?: (m: string) => void } = {},
): Promise<string> {
  return finalCustomerSentence(await draftCustomerSentence(group, opts), group, opts.forbidden, opts.log);
}
