// Step 5. Owner: the owners file (CODEOWNERS) of the first product repository maps the page's
// web path, named in the comment above each owners line, to the code folder and its owner.
// Nothing is sent to Slack here; the Slack user id is only looked up.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WebClient } from '@slack/web-api';
import { config, PAGE_PATHS } from '../config.js';
import type { Owner, Page } from '../types.js';
import { ghApi } from './exec.js';

export type SlackLookup = (githubLogin: string) => Promise<string | null>;

export interface OwnerOptions {
  repo?: string;
  /** Reads the owners file text; null when the repository has none. */
  readOwnersFile?: (repo: string) => Promise<string | null>;
  lookupSlackUser?: SlackLookup;
}

export const OWNERS_FILE_PATHS = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'];

export interface OwnersEntry {
  pattern: string;
  owners: string[];
  /** Web path named in the comment above the line, e.g. /card. */
  webPath: string | null;
  line: string;
}

/** Parses an owners file. Each owners line takes the web path from the nearest comment above it in the same block. */
export function parseOwnersFile(text: string): OwnersEntry[] {
  const entries: OwnersEntry[] = [];
  let comment: string | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') {
      comment = null;
      continue;
    }
    if (line.startsWith('#')) {
      comment = line;
      continue;
    }
    const [pattern, ...owners] = line.split(/\s+/);
    const webPath = comment ? (/web path\s+(\/[^\s,;]*)/i.exec(comment)?.[1] ?? null) : null;
    entries.push({ pattern: pattern!, owners: owners.filter((o) => o.startsWith('@')), webPath, line });
    comment = null;
  }
  return entries;
}

async function readOwnersFileFromGitHub(repo: string): Promise<string | null> {
  for (const path of OWNERS_FILE_PATHS) {
    try {
      const file = await ghApi<{ content?: string; encoding?: string }>(`repos/${repo}/contents/${path}`);
      if (file.content) return Buffer.from(file.content, (file.encoding as BufferEncoding) ?? 'base64').toString('utf8');
    } catch {
      // not at this path; try the next
    }
  }
  return null;
}

export async function findOwner(page: Page | null, opts: OwnerOptions = {}): Promise<Owner> {
  const repo = opts.repo ?? config.repos[0] ?? '';
  const none: Owner = { repo, codePath: null, githubLogin: null, slackUserId: null, ownersLine: null };
  if (page === null || !repo) return none;
  const text = await (opts.readOwnersFile ?? readOwnersFileFromGitHub)(repo);
  if (text === null) return none;
  const webPath = PAGE_PATHS[page];
  // The last matching line wins, as in CODEOWNERS itself.
  const entry = parseOwnersFile(text).filter((e) => e.webPath === webPath).at(-1);
  if (!entry) return none;
  const codePath = entry.pattern.replace(/^\//, '');
  const githubLogin = entry.owners[0]?.replace(/^@/, '') ?? null;
  let slackUserId: string | null = null;
  if (githubLogin && opts.lookupSlackUser !== undefined) {
    try {
      slackUserId = await opts.lookupSlackUser(githubLogin);
    } catch {
      slackUserId = null;
    }
  } else if (githubLogin) {
    slackUserId = await slackLookupFromEnv()(githubLogin).catch(() => null);
  }
  return { repo, codePath, githubLogin, slackUserId, ownersLine: entry.line };
}

const OWNERS_MAP_PATH = fileURLToPath(new URL('../../owners.json', import.meta.url));

/** tool/owners.json: GitHub login to the person's name as it appears in Slack. */
export function readOwnersMap(path = OWNERS_MAP_PATH): Record<string, string> {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>;
  } catch {
    return {};
  }
}

interface SlackMember {
  id?: string;
  name?: string;
  real_name?: string;
  deleted?: boolean;
  is_bot?: boolean;
  profile?: { real_name?: string; display_name?: string };
}

/** Finds the Slack member whose real name, display name or user name equals the mapped name, ignoring case. */
export function matchSlackMember(members: SlackMember[], name: string): string | null {
  const want = name.trim().toLowerCase();
  const hit = members.find(
    (m) =>
      !m.deleted &&
      !m.is_bot &&
      [m.real_name, m.profile?.real_name, m.profile?.display_name, m.name].some((n) => (n ?? '').trim().toLowerCase() === want),
  );
  return hit?.id ?? null;
}

/** The real lookup: owners.json maps the login to a name, Slack users.list maps the name to an id. */
export function slackLookup(token: string, ownersMap: Record<string, string> = readOwnersMap()): SlackLookup {
  let members: Promise<SlackMember[]> | undefined;
  const client = new WebClient(token);
  const loadMembers = async (): Promise<SlackMember[]> => {
    const all: SlackMember[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.users.list({ limit: 200, cursor });
      all.push(...((page.members ?? []) as SlackMember[]));
      cursor = page.response_metadata?.next_cursor || undefined;
    } while (cursor);
    return all;
  };
  return async (githubLogin) => {
    const name = ownersMap[githubLogin];
    if (!name) return null;
    members ??= loadMembers();
    return matchSlackMember(await members, name);
  };
}

/** Uses SLACK_BOT_TOKEN when present; without it every lookup is null. */
export function slackLookupFromEnv(env: NodeJS.ProcessEnv = process.env): SlackLookup {
  const token = (env.SLACK_BOT_TOKEN ?? '').trim();
  if (!token) return async () => null;
  return slackLookup(token);
}
