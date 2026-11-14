// Posting to #support as the "Support Desk" app, the way tool/scripts/post-reports.ts does.
// The token comes from the same secrets file as the tool, found the same way as tool/src/paths.ts.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DEFAULT_CHANNEL = 'C0CHF22D9AR'; // same default as tool/scripts/post-reports.ts

export function secretsFile(env = process.env) {
  const set = (k) => (env[k] ?? '').trim();
  if (set('WISE_SECRETS_FILE')) return resolve(set('WISE_SECRETS_FILE'));
  const buildDir = set('WISE_BUILD_DIR') ? resolve(set('WISE_BUILD_DIR')) : resolve(repoDir, '..');
  return resolve(buildDir, 'secrets.env');
}

/** KEY=value lines; # comments and blank lines skipped. */
export function parseSecrets(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#')) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

/** A variable already set in the environment wins over the file. */
export function loadSlackSettings(env = process.env) {
  const file = secretsFile(env);
  const fromFile = existsSync(file) ? parseSecrets(readFileSync(file, 'utf8')) : {};
  const pick = (k) => (env[k] ?? '').trim() || (fromFile[k] ?? '').trim();
  return { file, token: pick('SLACK_TEST_BOT_TOKEN'), channel: pick('SUPPORT_CHANNEL_ID') || DEFAULT_CHANNEL };
}

async function call(token, method, body) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Slack ${method}: ${data.error ?? res.status}`);
  return data;
}

/** Posts one plain message. Resolves {ts, link}. */
export function slackPoster({ token, channel }) {
  return async (text) => {
    if (!token) throw new Error('SLACK_TEST_BOT_TOKEN is empty');
    const posted = await call(token, 'chat.postMessage', { channel, text, unfurl_links: false, unfurl_media: false });
    let link = null;
    try {
      link = (await call(token, 'chat.getPermalink', { channel: posted.channel, message_ts: posted.ts })).permalink;
    } catch {
      link = null;
    }
    return { ts: posted.ts, link };
  };
}
