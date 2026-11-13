// Times writeFixPullRequest N times in a row, each from a fresh clone and a new branch.
// npx tsx --env-file=C:/Users/ralfs/wise-build/secrets.env scripts/time-fix.ts [--model sonnet] [--runs 5]
import { mkdirSync, writeFileSync } from 'node:fs';
import { readEnv, strippedNames } from '../src/env.js';
import { claudeArgs, writeFixPullRequest, type FixResult } from '../src/fix.js';

const REPO = 'marshalofthecentralaltar/demo-bank-hello';
const REPORT = 'Customers say the greeting on the welcome screen is misspelled. It says Helo instead of Hello.';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

async function main() {
  const model = arg('model') ?? readEnv().fixModel;
  const runs = Number(arg('runs') ?? 5);
  console.log(`repo ${REPO}, model ${model}, ${runs} runs`);
  console.log(`claude ${claudeArgs(model).join(' ')}  (prompt on stdin)`);
  console.log(`stripped from the child env: ${strippedNames(process.env).join(', ') || '(none)'}`);
  const results: { run: number; startedAt: string; result: FixResult }[] = [];
  for (let run = 1; run <= runs; run++) {
    const startedAt = new Date().toISOString();
    const result = await writeFixPullRequest({
      repo: REPO,
      reportText: REPORT,
      model,
      onStage: (stage, s) => console.log(`  run ${run} ${stage} ${s}s`),
    });
    results.push({ run, startedAt, result });
    console.log(result.ok ? `run ${run}: ${result.prUrl} ${result.seconds.total}s, turns ${result.claudeTurns}` : `run ${run}: FAILED at ${result.stage}: ${result.message}\n${result.output}`);
  }

  const rows = results.map(({ run, result: r }) => [
    String(run),
    r.ok ? 'ok' : `FAILED (${r.stage})`,
    ...(['clone', 'claude', 'test', 'push', 'pr', 'total'] as const).map((k) => r.seconds[k].toFixed(1)),
    r.ok ? r.prUrl : r.message,
  ]);
  const header = ['run', 'status', 'clone', 'claude', 'test', 'push', 'pr', 'total', 'pull request'];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i] ?? 0)).join(' | ');
  console.log('\n' + line(header));
  console.log(widths.map((w) => '-'.repeat(w)).join('-|-'));
  for (const r of rows) console.log(line(r));
  const okTotals = results.filter((r) => r.result.ok).map((r) => r.result.seconds.total);
  const allTotals = results.map((r) => r.result.seconds.total);
  console.log(`\nmedian total (successful runs, n=${okTotals.length}): ${median(okTotals)?.toFixed(1) ?? 'n/a'} s`);
  console.log(`median total (all runs, n=${allTotals.length}): ${median(allTotals)?.toFixed(1) ?? 'n/a'} s`);

  mkdirSync('artifacts', { recursive: true });
  const file = `artifacts/time-fix-${model}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  writeFileSync(file, JSON.stringify({ repo: REPO, model, report: REPORT, args: claudeArgs(model), results }, null, 2));
  console.log(`log: ${file}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
