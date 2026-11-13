// The counted runs' summary: one table of every run and one "k of n ok" line per case. Pure, so a
// test can give it made-up lines. scripts/counted-runs.ts writes it next to the JSONL it reads.
import type { FullRunLine, Problem } from './fullRun.js';

/** A full-run line, or what counted-runs records for a run that printed none. */
export type CountedLine = Pick<FullRunLine, 'problem' | 'ok' | 'failed'> & Partial<Omit<FullRunLine, 'problem' | 'ok' | 'failed'>>;

const STEPS = ['pattern', 'monitoring', 'changes', 'owner', 'investigation', 'verdict', 'fix'] as const;

const cell = (v: number | string | null | undefined) => (v === null || v === undefined || v === '' ? '-' : String(v));
const prNumber = (url: string | null | undefined) => (url ? (/\/pull\/(\d+)/.exec(url)?.[1] ?? '?') : null);

export function caseLine(problem: Problem, lines: CountedLine[]): string {
  const runs = lines.filter((l) => l.problem === problem);
  const ok = runs.filter((l) => l.ok).length;
  let consecutive = 0;
  for (const l of runs) {
    if (!l.ok) break;
    consecutive++;
  }
  return `${problem}: ${ok} of ${runs.length} ok, consecutive from the first: ${consecutive}`;
}

export function summarizeRuns(lines: CountedLine[], opts: { title?: string; command?: string } = {}): string {
  const head = ['run', 'problem', 'ok', 'severity', 'outcome', 'pull request', ...STEPS.map((s) => `${s} s`), 'first report to handoff s', 'approval to merged s', 'merged to page stable s', 'monitoring source'];
  const rows = lines.map((l, i) => {
    const s = l.timings?.secondsByStep ?? {};
    return [
      String(i + 1),
      l.problem,
      l.ok ? 'yes' : 'NO',
      cell(l.severity),
      l.kind ?? 'none',
      cell(prNumber(l.prUrl) && `#${prNumber(l.prUrl)}`),
      ...STEPS.map((k) => cell(s[k])),
      cell(l.seconds?.handoff),
      cell(l.seconds?.approvalToMerged),
      cell(l.seconds?.mergedToStable),
      cell(l.monitoringSource),
    ];
  });
  const table = [head, head.map(() => '---'), ...rows].map((r) => `| ${r.join(' | ')} |`).join('\n');
  const problems = [...new Set(lines.map((l) => l.problem))];
  const failures = lines.flatMap((l, i) => (l.ok ? [] : [`- run ${i + 1} (${l.problem}): ${l.failed.join('; ') || 'not ok, no reason given'}`]));
  return [
    `# ${opts.title ?? 'Counted runs'}`,
    '',
    ...(opts.command ? ['`' + opts.command + '`', ''] : []),
    table,
    '',
    ...problems.map((p) => caseLine(p, lines)),
    ...(failures.length ? ['', 'Why a run failed:', '', ...failures] : []),
    '',
  ].join('\n');
}
