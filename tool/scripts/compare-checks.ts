// Proof that the browser check moved into tool/checks answers like the original.
// Serves two tiny static pages on random ports: one whose #card-picture node is replaced every
// second (with a fade and a balance change, as the planted problem does), one where it is not.
// Runs the original check and the moved one with --expect replaced and --expect stable on each,
// and prints the four exit codes per check. Exit 0 when both give the same four codes and those
// are the expected ones (replaced page 0 and 1, stable page 1 and 0).
// Run from tool/: npx tsx scripts/compare-checks.ts [--original <path to check-flicker.mjs>]
import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname } from 'node:path';
import { paths } from '../src/paths.js';

const argIndex = process.argv.indexOf('--original');
const original = argIndex >= 0 ? process.argv[argIndex + 1]! : `${paths.buildDir}/checks/check-flicker.mjs`;
const moved = paths.checkFlicker;

const page = (script: string): string => `<!doctype html><html><body>
<div id="balance">EUR 100.00</div>
<div id="card-picture" style="width:200px;height:120px;background:#163;opacity:1;transition:opacity 0.2s">card</div>
<script>${script}</script></body></html>`;

const REPLACED = page(`let n = 0;
setInterval(() => {
  n += 1;
  const old = document.getElementById('card-picture');
  const fresh = document.createElement('div');
  fresh.id = 'card-picture';
  fresh.style.cssText = old.style.cssText;
  fresh.style.opacity = '0.2';
  fresh.textContent = 'card ' + n;
  old.replaceWith(fresh);
  document.getElementById('balance').textContent = 'EUR ' + (100 + n) + '.00';
  setTimeout(() => { fresh.style.opacity = '1'; }, 400);
}, 1000);`);
const STABLE = page('');

function serve(html: string): Promise<Server> {
  const server = createServer((req, res) => {
    res.writeHead(req.url === '/card' ? 200 : 404, { 'content-type': 'text/html' });
    res.end(req.url === '/card' ? html : 'not found');
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function runCheck(check: string, baseUrl: string, expect: string): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [check, '--expect', expect], { cwd: dirname(check), env: { ...process.env, BASE_URL: baseUrl } });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => resolve({ code, out: out.trim().split('\n').at(-1) ?? '' }));
  });
}

const replacedServer = await serve(REPLACED);
const stableServer = await serve(STABLE);
const url = (s: Server) => `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
const cases = [
  ['replaced page', url(replacedServer), 'replaced'],
  ['replaced page', url(replacedServer), 'stable'],
  ['stable page', url(stableServer), 'replaced'],
  ['stable page', url(stableServer), 'stable'],
] as const;
const codes: Record<string, (number | null)[]> = { original: [], moved: [] };
for (const [label, check] of [['original', original], ['moved', moved]] as const) {
  console.log(`${label}: ${check}`);
  for (const [pageName, base, expect] of cases) {
    const r = await runCheck(check, base, expect);
    codes[label]!.push(r.code);
    console.log(`  ${pageName} --expect ${expect}: exit ${r.code} ${r.out}`);
  }
}
replacedServer.close();
stableServer.close();
const want = [0, 1, 1, 0];
const same = JSON.stringify(codes.original) === JSON.stringify(codes.moved);
const right = JSON.stringify(codes.moved) === JSON.stringify(want);
console.log(`original ${JSON.stringify(codes.original)} moved ${JSON.stringify(codes.moved)} expected ${JSON.stringify(want)}: ${same && right ? 'SAME' : 'DIFFERENT'}`);
process.exit(same && right ? 0 : 1);
