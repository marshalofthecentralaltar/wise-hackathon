// Criterion 10: the real owners line for the card page, with the Slack id looked up live.
// Prints names only when no id is found. Run from tool/:
// npx tsx --import ./src/loadSecrets.ts scripts/owner-slack-id.ts
import { WebClient } from '@slack/web-api';
import { findOwner, readOwnersMap, slackLookupFromEnv } from '../src/steps/owner.js';

const owner = await findOwner('card', { lookupSlackUser: slackLookupFromEnv() });
console.log(JSON.stringify(owner));
if (owner.slackUserId === null) {
  const r = await new WebClient(process.env.SLACK_BOT_TOKEN).users.list({ limit: 200 });
  const names = (r.members ?? []).filter((m) => !m.deleted && !m.is_bot).map((m) => [m.real_name, m.profile?.display_name, m.name].filter(Boolean).join(' / '));
  console.log(JSON.stringify({ wanted: readOwnersMap()[owner.githubLogin ?? ''] ?? null, names }));
}
