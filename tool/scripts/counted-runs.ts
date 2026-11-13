// npm run counted-runs -- --flicker <n> --amount <m> [--via slack|direct] [--require-prometheus] [--tool own|external]
// (--no-deploy-check is refused with exit 2: a counted flicker run must have its redeployed page checked.)
// Runs full-run n + m times in a row, the flicker runs first (each with --approve), each from the
// reset (full-run makes it). Never stops early: a failed run is recorded and the next one starts.
// Every line goes to tool/artifacts/counted-runs-<UTC stamp>.jsonl as it comes; at the end
// counted-runs-<stamp>.md holds the table and one "k of n ok" line per case.
// Exit 0 only when every run is ok. Needs `npm run demo-start` first (the watcher and Prometheus).
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { countsOk, notCountedReason, summarizeRuns, type CountedLine } from '../src/countedRuns.js';
import type { Problem } from '../src/fullRun.js';
import { ARTIFACTS_DIR, TOOL_DIR, TSX_CLI, fileStamp } from './lib/procs.js';
import { SECRETS_FILE } from './lib/secretsLine.js';

const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const flickerN = Number(arg('flicker', '0'));
const amountN = Number(arg('amount', '0'));
const via = arg('via', 'slack');
if (process.argv.includes('--no-deploy-check')) {
  console.error('counted-runs does not take --no-deploy-check: a counted flicker run is ok only when the redeployed page was checked. Run full-run on its own to skip that check.');
  process.exit(2);
}
const passOn = [
  ...(process.argv.includes('--require-prometheus') ? ['--require-prometheus'] : []),
  ...(arg('tool') ? ['--tool', arg('tool')!] : []),
];
if (!Number.isInteger(flickerN) || !Number.isInteger(amountN) || flickerN < 0 || amountN < 0 || flickerN + amountN === 0 || (via !== 'slack' && via !== 'direct')) {
  console.error('usage: counted-runs.ts --flicker <n> --amount <m> [--via slack|direct] [--require-prometheus] [--tool own|external]');
  process.exit(2);
}

const stamp = fileStamp();
mkdirSync(ARTIFACTS_DIR, { recursive: true });
const jsonl = join(ARTIFACTS_DIR, `counted-runs-${stamp}.jsonl`);
const md = join(ARTIFACTS_DIR, `counted-runs-${stamp}.md`);
const command = `npm run counted-runs -- ${process.argv.slice(2).join(' ')}`;
const say = (s: string) => process.stderr.write(`[counted-runs] ${new Date().toISOString().slice(11, 19)} ${s}\n`);

/** One full-run as its own process; its progress streams to this stderr. Resolves with its line. */
function fullRun(problem: Problem, index: number): Promise<CountedLine> {
  const args = [TSX_CLI, `--env-file-if-exists=${SECRETS_FILE}`, join(TOOL_DIR, 'scripts', 'full-run.ts'), '--problem', problem, '--via', via!, ...(problem === 'flicker' ? ['--approve'] : []), ...passOn];
  say(`run ${index}: ${problem} (full-run ${args.slice(3).join(' ')})`);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: TOOL_DIR, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    child.stdout.on('data', (b) => (out += String(b)));
    child.stderr.on('data', (b) => process.stderr.write(b));
    child.on('close', (code) => {
      const last = out.trim().split(/\r?\n/).filter((l) => l.startsWith('{')).at(-1);
      try {
        if (last) return resolve(JSON.parse(last) as CountedLine);
      } catch {
        // falls through
      }
      resolve({ problem, ok: false, failed: [`full-run printed no line (exit ${code})`] });
    });
    child.on('error', (err) => resolve({ problem, ok: false, failed: [`full-run did not start: ${err.message}`] }));
  });
}

const plan: Problem[] = [...Array<Problem>(flickerN).fill('flicker'), ...Array<Problem>(amountN).fill('amount')];
const lines: CountedLine[] = [];
writeFileSync(jsonl, '');
say(`${plan.length} runs; lines to ${jsonl}`);
for (const [i, problem] of plan.entries()) {
  const t0 = performance.now();
  const line = await fullRun(problem, i + 1);
  lines.push(line);
  appendFileSync(jsonl, `${JSON.stringify(line)}\n`);
  console.log(JSON.stringify(line));
  say(`run ${i + 1} (${problem}): ${countsOk(line) ? 'ok' : `FAILED: ${line.ok ? notCountedReason(line) : line.failed.join('; ')}`} in ${Math.round((performance.now() - t0) / 1000)} s`);
}
writeFileSync(md, summarizeRuns(lines, { title: `Counted runs ${stamp}`, command }));
say(`summary: ${md}`);
for (const p of ['flicker', 'amount'] as const) if (plan.includes(p)) say(summarizeRuns(lines).split('\n').find((l) => l.startsWith(`${p}:`)) ?? '');
process.exit(lines.every(countsOk) ? 0 : 1);
