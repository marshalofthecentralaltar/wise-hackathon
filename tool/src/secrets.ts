// Reading the secrets file. loadSecrets.ts applies it to process.env at start; the doctor reads it.
// The file is paths.secretsFile: <build folder>/secrets.env, or WISE_SECRETS_FILE. Never prints a value.

import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

export interface LoadResult {
  file: string;
  found: boolean;
  /** Names set from the file (never values). */
  loaded: string[];
  /** Names in the file that were already set in the environment and kept. */
  kept: string[];
}

/** Reads names and values from a secrets file's text. */
export function parseSecrets(text: string): Record<string, string> {
  return parseEnv(text) as Record<string, string>;
}

/** Fills env from the file at `file`; a name already in env is left alone. */
export function loadSecretsInto(env: NodeJS.ProcessEnv, file: string): LoadResult {
  if (!existsSync(file)) return { file, found: false, loaded: [], kept: [] };
  const values = parseSecrets(readFileSync(file, 'utf8'));
  const loaded: string[] = [];
  const kept: string[] = [];
  for (const [name, value] of Object.entries(values)) {
    if (env[name] !== undefined) {
      kept.push(name);
      continue;
    }
    env[name] = value;
    loaded.push(name);
  }
  return { file, found: true, loaded, kept };
}

/** The one line printed when the file is missing. Names the file, never a value. */
export function missingSecretsMessage(file: string): string {
  return `[secrets] no secrets file at ${file}: create it (npm run doctor makes an empty one) or set WISE_SECRETS_FILE to its path.`;
}
