// Step 2. Pattern: which new #support messages are customer reports, which page each is
// about, and which reports are about the same problem. One `claude -p` call per batch.
import { config } from '../config.js';
import type { Page, Report, ReportGroup } from '../types.js';
import { askClaude } from './exec.js';

export const PAGES: readonly Page[] = ['card', 'transfers', 'account'];

export type GroupTarget = { kind: 'existing'; groupId: string } | { kind: 'new'; label: string };

export interface GroupingDecision {
  report: Report;
  isReport: boolean;
  page: Page | null;
  /** null when the message is not a report. */
  target: GroupTarget | null;
  /** One English sentence; '' for chatter. */
  summary: string;
}

export interface GroupingResult {
  /** False when no valid answer came back after one retry; decisions is then empty. */
  ok: boolean;
  decisions: GroupingDecision[];
  calls: number;
  seconds: number;
  error?: string;
}

export type ModelCall = (prompt: string, systemPrompt: string) => Promise<{ ok: boolean; text: string; error?: string }>;

export interface GroupingOptions {
  callModel?: ModelCall;
  log?: (message: string) => void;
}

export const GROUPING_SYSTEM_PROMPT =
  'You sort messages from the #support Slack channel of a small bank app. You answer with one JSON object and nothing else: no code fence, no prose.';

const SAMPLES_PER_GROUP = 3;

const oneLine = (text: string, max = 400) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max - 3) + '...' : flat;
};

/** The prompt for one batch. Open groups are named g1..gN and new messages m1..mN, so the model never sees internal ids. */
export function buildGroupingPrompt(newReports: Report[], openGroups: ReportGroup[]): string {
  const groupLines = openGroups.length
    ? openGroups.flatMap((g, i) => [
        `g${i + 1} [page: ${g.page ?? 'unknown'}] ${oneLine(g.summary, 200)}`,
        ...g.reports.slice(0, SAMPLES_PER_GROUP).map((r) => `    example: ${JSON.stringify(oneLine(r.text, 200))}`),
      ])
    : ['(none yet)'];
  const messageLines = newReports.map((r, i) => `m${i + 1}: ${JSON.stringify(oneLine(r.text))}`);
  return [
    'Support agents at Demo Bank post in #support what customers told them. They also chat with each other there.',
    'The app has three pages:',
    '- card: the payment card page. It shows the card picture, the balance and the recent card payments.',
    '- transfers: the list of money transfers and their amounts.',
    '- account: the account holder\'s details, such as name and address.',
    '',
    'Open groups. Each group is one problem customers have already reported:',
    ...groupLines,
    '',
    'New messages, in the order they arrived. They may be in English, Estonian or Russian:',
    ...messageLines,
    '',
    'For every new message decide four things:',
    '1. is_report: true when the message passes on a problem a customer has with the app. false for chatter between agents: greetings, shift notes, lunch, thanks, questions about procedures, anything that is not a customer\'s problem with the app.',
    '2. page: "card", "transfers" or "account" when the problem is on that page; null when the message does not say or the problem is somewhere else (login, statements, settings, language and so on).',
    '3. group: the id of the open group (g1, g2, ...) when the message is about the SAME problem as that group. Otherwise a new label n1, n2, ... for a new problem; new messages about the same new problem share one label. Being on the same page is not enough: the same problem means the same symptom. For example, a flickering or blinking card picture and a declined card payment are two different problems on the card page, and a wrong amount in the transfers list is a different problem from a failed transfer. Use null when is_report is false.',
    '4. summary: one short English sentence that states the problem as customers describe it. Use "" when is_report is false.',
    '',
    'Answer with exactly this JSON shape, one entry per new message, in the same order:',
    '{"messages":[{"id":"m1","is_report":true,"page":"card","group":"n1","summary":"The card picture blinks on the card page."}]}',
  ].join('\n');
}

interface RawEntry {
  id?: unknown;
  is_report?: unknown;
  page?: unknown;
  group?: unknown;
  summary?: unknown;
}

/** Pulls the JSON object out of the model's text, tolerating a code fence or stray words around it. */
export function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON object in the answer');
  return JSON.parse(text.slice(start, end + 1));
}

/** Checks the answer against the batch. Throws with a plain reason when it does not fit. */
export function parseGroupingAnswer(text: string, newReports: Report[], openGroups: ReportGroup[]): GroupingDecision[] {
  const parsed = extractJson(text) as { messages?: unknown };
  if (!parsed || !Array.isArray(parsed.messages)) throw new Error('answer has no "messages" array');
  const byId = new Map<string, RawEntry>();
  for (const raw of parsed.messages as RawEntry[]) {
    if (!raw || typeof raw.id !== 'string') throw new Error('an entry has no id');
    const index = /^m(\d+)$/.exec(raw.id);
    const n = index ? Number(index[1]) : NaN;
    if (!(n >= 1 && n <= newReports.length)) throw new Error(`unknown message id ${raw.id}`);
    if (byId.has(raw.id)) throw new Error(`message ${raw.id} answered twice`);
    byId.set(raw.id, raw);
  }
  return newReports.map((report, i) => {
    const raw = byId.get(`m${i + 1}`);
    if (!raw) throw new Error(`message m${i + 1} not answered`);
    if (typeof raw.is_report !== 'boolean') throw new Error(`m${i + 1}: is_report is not true or false`);
    if (!raw.is_report) return { report, isReport: false, page: null, target: null, summary: '' };
    const page = raw.page === null || raw.page === undefined ? null : raw.page;
    if (page !== null && !PAGES.includes(page as Page)) throw new Error(`m${i + 1}: unknown page ${String(page)}`);
    let target: GroupTarget;
    const group = raw.group;
    if (typeof group !== 'string') throw new Error(`m${i + 1}: a report without a group`);
    const existing = /^g(\d+)$/.exec(group);
    if (existing) {
      const g = openGroups[Number(existing[1]) - 1];
      if (!g) throw new Error(`m${i + 1}: unknown group id ${group}`);
      target = { kind: 'existing', groupId: g.id };
    } else if (/^n\d+$/.test(group)) {
      target = { kind: 'new', label: group };
    } else {
      throw new Error(`m${i + 1}: unknown group id ${group}`);
    }
    const summary = typeof raw.summary === 'string' && raw.summary.trim() ? raw.summary.trim() : oneLine(report.text, 160);
    return { report, isReport: true, page: page as Page | null, target, summary };
  });
}

const defaultCall: ModelCall = (prompt, systemPrompt) => askClaude(prompt, systemPrompt, config.groupingModel);

/**
 * Classifies a batch of new messages against the open groups. An invalid answer is retried
 * once; after that the result is ok:false with the reason, and nothing is thrown.
 */
export async function groupReports(newReports: Report[], openGroups: ReportGroup[], opts: GroupingOptions = {}): Promise<GroupingResult> {
  const t0 = performance.now();
  const seconds = () => Math.round((performance.now() - t0) / 100) / 10;
  const log = opts.log ?? ((m: string) => console.error(m));
  if (newReports.length === 0) return { ok: true, decisions: [], calls: 0, seconds: 0 };
  const callModel = opts.callModel ?? defaultCall;
  const prompt = buildGroupingPrompt(newReports, openGroups);
  let calls = 0;
  let lastError = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    calls++;
    try {
      const answer = await callModel(prompt, GROUPING_SYSTEM_PROMPT);
      if (!answer.ok) throw new Error(answer.error || 'the model call failed');
      const decisions = parseGroupingAnswer(answer.text, newReports, openGroups);
      return { ok: true, decisions, calls, seconds: seconds() };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      log(`[grouping] attempt ${attempt} of 2 for ${newReports.length} message(s) failed: ${lastError}`);
    }
  }
  log(`[grouping] giving up on ${newReports.length} message(s); they stay ungrouped: ${newReports.map((r) => r.ts).join(', ')}`);
  return { ok: false, decisions: [], calls, seconds: seconds(), error: lastError };
}
