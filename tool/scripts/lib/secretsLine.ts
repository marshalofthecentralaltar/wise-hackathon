// Which line of the secrets file holds SLACK_TEST_BOT_TOKEN. Reads names only; never a value.
import { existsSync, readFileSync } from 'node:fs';

export const SECRETS_FILE = (process.env.SECRETS_FILE ?? '').trim() || 'C:/Users/ralfs/wise-build/secrets.env';

export function emptyTestTokenMessage(path: string): string {
  let where = `add a line SLACK_TEST_BOT_TOKEN=... to ${path}`;
  if (existsSync(path)) {
    const n = readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .findIndex((l) => /^\s*SLACK_TEST_BOT_TOKEN\s*=/.test(l));
    if (n >= 0) where = `fill line ${n + 1} of ${path} (SLACK_TEST_BOT_TOKEN=)`;
  }
  return `SLACK_TEST_BOT_TOKEN is empty: ${where} with the Bot User OAuth Token (xoxb-...) of the "Support Desk" app (tool/slack-test-manifest.yaml), then run again.`;
}
