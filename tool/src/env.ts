// Secrets come from the process environment, which is filled by
// src/loadSecrets.ts, which the npm scripts import first (the file's path is in src/paths.ts).
// The file is read by path; it is never copied, printed or committed.

export interface ToolEnv {
  slackBotToken: string;
  slackAppToken: string;
  fixModel: string;
}

export const DEFAULT_FIX_MODEL = 'sonnet';

export function readEnv(env: NodeJS.ProcessEnv = process.env): ToolEnv {
  return {
    slackBotToken: (env.SLACK_BOT_TOKEN ?? '').trim(),
    slackAppToken: (env.SLACK_APP_TOKEN ?? '').trim(),
    fixModel: (env.FIX_MODEL ?? '').trim() || DEFAULT_FIX_MODEL,
  };
}

/** Names the child processes (claude, git, gh, the repo's tests) must never receive. */
const STRIPPED_NAMES = new Set([
  // Claude Code would bill an API key instead of the owner's plan.
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'GROUPING_ANTHROPIC_KEY',
  // The child has no business with the Slack tokens either.
  'SLACK_BOT_TOKEN',
  'SLACK_APP_TOKEN',
  'SLACK_TEST_BOT_TOKEN',
]);

export function isStrippedName(name: string): boolean {
  const upper = name.toUpperCase(); // Windows env names are case-insensitive.
  // Every CLAUDE* variable: when the tool itself runs inside Claude Code these mark the
  // child as a nested session; on stage, from a plain terminal, none are present.
  return STRIPPED_NAMES.has(upper) || upper.startsWith('CLAUDE');
}

/** The environment for every child process the tool spawns. Pure: does not touch process.env. */
export function buildChildEnv(parent: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const child: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(parent)) {
    if (value === undefined || isStrippedName(name)) continue;
    child[name] = value;
  }
  return child;
}

/** Names (never values) of the variables buildChildEnv drops from this parent. */
export function strippedNames(parent: NodeJS.ProcessEnv): string[] {
  return Object.keys(parent).filter(isStrippedName).sort();
}
