import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isAlive, startToolProcess, stopTree } from '../scripts/lib/procs.js';

const dir = () => mkdtempSync(join(tmpdir(), 'procs-'));

describe('startToolProcess: the wait for the "Listening in" line', () => {
  it('a stand-in that never prints it: a plain failure within the limit, and the stand-in is stopped', async () => {
    const d = dir();
    const pidFile = join(d, 'pid');
    const code = "require('fs').writeFileSync(process.argv[1], String(process.pid)); console.log('connecting...'); setInterval(() => {}, 1000)";
    const t0 = performance.now();
    await expect(startToolProcess({ log: join(d, 'tool.log'), limitMs: 2000, args: ['-e', code, pidFile] })).rejects.toThrow(/^the tool did not print \/Listening in #\/ within 2 s; see .*tool\.log$/);
    const seconds = (performance.now() - t0) / 1000;
    expect(seconds).toBeGreaterThanOrEqual(2);
    expect(seconds).toBeLessThan(12); // the limit, plus the tree kill on a loaded PC
    const pid = Number(readFileSync(pidFile, 'utf8'));
    expect(pid).toBeGreaterThan(0);
    expect(isAlive(pid)).toBe(false);
    expect(readFileSync(join(d, 'tool.log'), 'utf8')).toContain('connecting...');
  });

  it('a stand-in that exits first: says so instead of waiting out the limit', async () => {
    const d = dir();
    const t0 = performance.now();
    await expect(startToolProcess({ log: join(d, 'tool.log'), limitMs: 30_000, args: ['-e', "console.error('SLACK_BOT_TOKEN is empty'); process.exit(2)"] })).rejects.toThrow(/the tool exited \(code 2\) before printing/);
    expect(performance.now() - t0).toBeLessThan(15_000);
  });

  it('a stand-in that prints it: started, and stopTree ends it', async () => {
    const d = dir();
    const s = await startToolProcess({ log: join(d, 'tool.log'), limitMs: 20_000, args: ['-e', "console.log('Listening in #support (C0X) as U0X'); setInterval(() => {}, 1000)"] });
    expect(isAlive(s.pid)).toBe(true);
    expect(await stopTree(s.pid)).toBe(true);
  });
});
