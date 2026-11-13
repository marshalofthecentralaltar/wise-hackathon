// Test helper: small throwaway git repositories in the temp folder.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export function git(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', ['-c', 'user.name=Test Author', '-c', 'user.email=test@example.com', ...args], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

export function newRepo(prefix = 'gitrepo-'): { dir: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const dir = join(root, 'repo');
  mkdirSync(dir);
  git(dir, 'init', '-q', '-b', 'main');
  // In the repository's own config, so the code under test (plain `git`) sees the same setting.
  git(dir, 'config', 'core.autocrlf', 'false');
  return { dir, cleanup: () => rmSync(root, { recursive: true, force: true, maxRetries: 5 }) };
}

export function writeAndCommit(dir: string, files: Record<string, string>, message: string): string {
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', message);
  return git(dir, 'rev-parse', 'HEAD');
}

export const numbered = (n: number, change?: Record<number, string>) =>
  Array.from({ length: n }, (_, i) => change?.[i + 1] ?? `line ${i + 1}`).join('\n') + '\n';
