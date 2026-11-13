// Times steps 6 and 7 on one planted problem, N times, each run from a new fresh copy.
//   npx tsx scripts/run-investigation.ts --problem flicker|amount [--runs 5] [--model sonnet] [--max-turns 15] [--effort low]
// Inputs that other lanes build (grouping, monitoring, recent changes, owner) are made here by hand
// or by a throwaway helper; the real steps replace them in the full run.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../src/config.js';
import { run } from '../src/fix.js';
import { investigateWithDetails, type CustomerEffect } from '../src/investigate.js';
import { classifyCustomerEffect, judge } from '../src/verdict.js';
import { freshCopy } from '../src/workspace.js';
import type { MonitoringFinding, Owner, Page, RecentCommit, ReportGroup } from '../src/types.js';

const here = dirname(fileURLToPath(import.meta.url));
const toolDir = join(here, '..');
const repo = config.repos[0]!;

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const problem = arg('problem');
if (problem !== 'flicker' && problem !== 'amount') {
  console.error('usage: --problem flicker|amount [--runs 5] [--model sonnet] [--max-turns 15] [--effort low]');
  process.exit(2);
}
const runs = Number(arg('runs', '5'));
const model = arg('model', config.investigationModel)!;
const maxTurns = Number(arg('max-turns', '15'));
const effortArg = arg('effort');
const effort = effortArg === 'low' || effortArg === 'medium' || effortArg === 'high' ? effortArg : undefined;

// ---- Inputs ---------------------------------------------------------------------------------

interface Fixture { id: string; text: string }
const fixtures = JSON.parse(readFileSync(join(toolDir, '..', 'fixtures', 'reports.json'), 'utf8')) as Fixture[];
const fixtureText = (id: string) => fixtures.find((f) => f.id === id)!.text;

const PROBLEMS: Record<'flicker' | 'amount', { page: Page; codePath: string; summary: string; texts: string[]; expected: 'low' | 'high' }> = {
  flicker: {
    page: 'card',
    codePath: 'src/pages/card/',
    summary: 'The picture of the card blinks on the card page, about once a second.',
    texts: ['r01', 'r04', 'r06'].map(fixtureText),
    expected: 'low',
  },
  amount: {
    page: 'transfers',
    codePath: 'src/pages/transfers/',
    summary: 'A transfer in the transfers list shows the wrong amount.',
    texts: [
      'Customer sent 2,040.00 EUR to Karl M. on 7 November but her transfers list shows 2,40.00 EUR for it, she is worried the wrong sum left her account.',
      'Second customer today: a transfer of 2,040 euros is listed as 2,40.00 EUR in the transfers list, can someone check the records?',
      'Klient kirjutab, et ülekannete nimekirjas on 7. novembri ülekande summa vale, ta saatis 2040 eurot aga näha on 2,40.00 EUR.',
    ],
    expected: 'high',
  },
};
const p = PROBLEMS[problem];

const group: ReportGroup = {
  id: `harness-${problem}`,
  page: p.page,
  summary: p.summary,
  reports: p.texts.map((text, i) => ({ channel: 'C-harness', ts: `1763060000.00000${i}`, sender: `U-agent-${i + 1}`, text })),
  threadTs: '1763060000.000000',
};
const owner: Owner = { repo, codePath: p.codePath, githubLogin: null, slackUserId: null, ownersLine: null };
const monitoring: MonitoringFinding = {
  source: 'prometheus',
  errorsPerSecond: 0,
  alertsFiring: [],
  p95Seconds: 0.02,
  logLinesRead: 240,
  logErrors: 0,
  logWarnings: 0,
  showsProblem: false,
  summary: `Prometheus shows no errors and no firing alerts for ${p.page === 'card' ? '/card' : '/transfers'} in the last hour; the request log has no error or warning lines.`,
};

// Throwaway stand-in for step 4 (another lane builds the real one): git log of the fresh copy plus gh pull requests.
async function recentCommits(copyDir: string): Promise<RecentCommit[]> {
  const log = await run('git', ['log', `--since=${config.recentDays} days ago`, '--name-only', '-m', '--first-parent', '--format=%x1e%H%x1f%an%x1f%cI%x1f%P%x1f%B%x1f'], { cwd: copyDir, timeoutMs: 30_000 });
  if (log.code !== 0) throw new Error('git log failed: ' + log.stderr);
  const commits: (RecentCommit & { parents: string[] })[] = [];
  for (const chunk of log.stdout.split('\x1e').slice(1)) {
    const [sha, author, date, parents, message, filesBlock] = chunk.split('\x1f');
    commits.push({
      repo,
      sha: sha!.trim(),
      author: author!.trim(),
      mergedAt: date!.trim(),
      message: message!.trim(),
      files: (filesBlock ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean),
      parents: parents!.trim().split(/\s+/).filter(Boolean),
    });
  }
  // `git log --first-parent` lists only main's own line; add the commits merges brought in.
  const listed = new Set(commits.map((c) => c.sha));
  for (const m of commits.filter((c) => c.parents.length > 1)) {
    const inner = await run('git', ['log', '--name-only', '--format=%x1e%H%x1f%an%x1f%cI%x1f%P%x1f%B%x1f', `${m.parents[0]}..${m.parents[1]}`], { cwd: copyDir, timeoutMs: 30_000 });
    for (const chunk of inner.stdout.split('\x1e').slice(1)) {
      const [sha, author, date, parents, message, filesBlock] = chunk.split('\x1f');
      if (listed.has(sha!.trim())) continue;
      listed.add(sha!.trim());
      commits.push({ repo, sha: sha!.trim(), author: author!.trim(), mergedAt: date!.trim(), message: message!.trim(), files: (filesBlock ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean), parents: parents!.trim().split(/\s+/) });
    }
  }
  const prs = await run('gh', ['pr', 'list', '-R', repo, '--state', 'merged', '--limit', '20', '--json', 'number,title,body,url,mergedAt,commits,comments,reviews,mergeCommit'], { cwd: copyDir, timeoutMs: 60_000 });
  if (prs.code !== 0) throw new Error('gh pr list failed: ' + prs.stderr);
  type GhPr = { number: number; title: string; body: string; url: string; mergedAt: string; commits: { oid: string }[]; comments: { author: { login: string }; body: string }[]; reviews: { author: { login: string }; body: string }[]; mergeCommit: { oid: string } | null };
  for (const pr of JSON.parse(prs.stdout) as GhPr[]) {
    const shas = new Set([...pr.commits.map((c) => c.oid), pr.mergeCommit?.oid].filter(Boolean));
    for (const c of commits) {
      if (!shas.has(c.sha)) continue;
      c.mergedAt = pr.mergedAt;
      c.pullRequest = {
        number: pr.number,
        title: pr.title,
        body: pr.body,
        url: pr.url,
        comments: [...pr.comments, ...pr.reviews].filter((x) => x.body?.trim()).map((x) => ({ author: x.author?.login ?? 'unknown', body: x.body })),
      };
    }
  }
  commits.sort((a, b) => b.mergedAt.localeCompare(a.mergedAt));
  return commits.map(({ parents: _p, ...c }) => c);
}

// ---- Runs -----------------------------------------------------------------------------------

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return NaN;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round(((s[m - 1]! + s[m]!) / 2) * 10) / 10;
};
const secondsSince = (t0: number) => Math.round((performance.now() - t0) / 100) / 10;

async function main() {
  const tc = performance.now();
  const listCopy = await freshCopy(repo);
  const commits = await recentCommits(listCopy.dir);
  await listCopy.remove();
  console.log(`problem ${problem}, model ${model}, max turns ${maxTurns}${effort ? `, effort ${effort}` : ''}; ${commits.length} recent commits listed by the stand-in for step 4 in ${secondsSince(tc)} s`);

  interface Row {
    run: number; commit: string; file: string; lines: string; codeEffect: CustomerEffect; textEffect: CustomerEffect;
    severity: string; decidedBy: string; reverts: string; copyS: number; investigationS: number; classifyS: number; totalS: number;
    attempts: number; turns: string; statusAfter: string; found: boolean; reason: string;
  }
  const rows: Row[] = [];
  const details: unknown[] = [];
  for (let i = 1; i <= runs; i++) {
    const t0 = performance.now();
    const copy = await freshCopy(repo);
    const copyS = copy.seconds;
    const tk = performance.now();
    let classifyS = 0;
    const textEffectP = classifyCustomerEffect(group.reports.map((r) => r.text)).then((e) => {
      classifyS = secondsSince(tk);
      return e;
    });
    const d = await investigateWithDetails({ group, owner, monitoring, commits }, { copyDir: copy.dir, model, maxTurns, effort });
    const verdict = await judge({ group, monitoring, investigation: d.investigation, textEffect: textEffectP });
    const textEffect = await textEffectP;
    const statusAfter = (await run('git', ['status', '--porcelain'], { cwd: copy.dir, timeoutMs: 10_000 })).stdout.trim();
    const totalS = secondsSince(t0);
    await copy.remove();
    const inv = d.investigation;
    const row: Row = {
      run: i,
      commit: inv.commitSha?.slice(0, 7) ?? '-',
      file: inv.file ?? '-',
      lines: inv.lines ?? '-',
      codeEffect: inv.customerEffect,
      textEffect,
      severity: verdict.severity,
      decidedBy: verdict.decidedBy,
      reverts: inv.revertsCleanly === null ? '-' : String(inv.revertsCleanly),
      copyS,
      investigationS: inv.seconds,
      classifyS,
      totalS,
      attempts: d.attempts.length,
      turns: d.attempts.map((a) => a.turns ?? '?').join('+'),
      statusAfter: statusAfter || 'clean',
      found: inv.found,
      reason: verdict.reason,
    };
    rows.push(row);
    details.push({ run: i, investigation: inv, verdict, textEffect, attempts: d.attempts, statusAfterModel: d.statusAfterModel, statusAfterRun: statusAfter, copy: { seconds: copy.seconds, fetch: copy.fetchSeconds, clone: copy.cloneSeconds, head: copy.head } });
    console.log(
      `run ${i}: commit ${row.commit} | ${row.file}:${row.lines} | effect code=${row.codeEffect} text=${row.textEffect} | ${row.severity} by ${row.decidedBy} | reverts ${row.reverts} | ` +
        `copy ${copyS}s investigation ${row.investigationS}s classify ${classifyS}s total ${totalS}s | attempts ${row.attempts} turns ${row.turns} | copy after: ${row.statusAfter}`,
    );
    for (const a of d.attempts) if (a.rejection || a.note) console.log(`   attempt: ${a.rejection ?? ''} ${a.note ?? ''}`.trimEnd());
  }

  // Correct: a commit found, the same commit as most runs, a file under the page's folder, the expected severity.
  const counts = new Map<string, number>();
  for (const r of rows) if (r.found) counts.set(r.commit, (counts.get(r.commit) ?? 0) + 1);
  const modal = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '-';
  const correct = rows.filter((r) => r.found && r.commit === modal && r.file.startsWith(p.codePath) && r.severity === p.expected).length;

  console.log('');
  console.log('| run | commit | file | lines | effect (code) | effect (text) | severity | decided by | reverts cleanly | copy s | investigation s | classify s | total s | attempts | turns |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    console.log(`| ${r.run} | ${r.commit} | ${r.file} | ${r.lines} | ${r.codeEffect} | ${r.textEffect} | ${r.severity} | ${r.decidedBy} | ${r.reverts} | ${r.copyS} | ${r.investigationS} | ${r.classifyS} | ${r.totalS} | ${r.attempts} | ${r.turns} |`);
  }
  console.log(`| median | | | | | | | | | ${median(rows.map((r) => r.copyS))} | ${median(rows.map((r) => r.investigationS))} | ${median(rows.map((r) => r.classifyS))} | ${median(rows.map((r) => r.totalS))} | | |`);
  console.log(`correct runs: ${correct} of ${rows.length} (same commit ${modal}, file under ${p.codePath}, severity ${p.expected}); copies clean after each run: ${rows.filter((r) => r.statusAfter === 'clean').length} of ${rows.length}`);

  mkdirSync(join(toolDir, 'artifacts'), { recursive: true });
  const out = join(toolDir, 'artifacts', `run-${problem}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(out, JSON.stringify({ problem, model, maxTurns, effort, commits, rows, details }, null, 2));
  console.log(`details: ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
