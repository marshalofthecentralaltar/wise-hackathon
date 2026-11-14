// npm run approve-latest
// For a rehearsal without the owner at the keyboard: finds the newest thread in #support that still
// carries an "Approve fix" button and presses it for the owner named in it, through the same handler
// a click runs. The thread then says "Approved by the rehearsal script ... without a person pressing
// the button", and the pull request gets a comment that no person pressed. On stage the owner presses.
import { WebClient } from '@slack/web-api';
import { approveFromThread, newestThreadWithButton, slackThreadReader, type ThreadMessage } from '../src/autoApprove.js';
import { approveWithProof, settleProofs } from '../src/browserProof.js';
import { makeRunEvents } from '../src/events.js';
import { webSlackPort } from '../src/slackPost.js';

const token = (process.env.SLACK_BOT_TOKEN ?? '').trim();
if (!token) {
  console.error('SLACK_BOT_TOKEN is empty: run npm run doctor');
  process.exit(2);
}
const channel = (process.env.SUPPORT_CHANNEL_ID ?? '').trim() || 'C0CHF22D9AR';
const client = new WebClient(token);
const read = slackThreadReader(client);
const history = (await client.conversations.history({ channel, limit: 30 })).messages as ThreadMessage[];
const threadTs = await newestThreadWithButton(history ?? [], channel, read);
if (!threadTs) {
  console.log('No thread in #support has an "Approve fix" button right now: wait for the handoff, then run this again.');
  process.exit(1);
}
const slack = webSlackPort(client);
const events = makeRunEvents(); // the same events file the tool writes
const out = await approveFromThread({ channel, threadTs, read, slack, approve: approveWithProof({ slack, emit: events.emitBare }) });
if (!out.pressed) {
  console.log(`Nothing pressed: ${out.refused}`);
  process.exit(1);
}
console.log(`Pressed "Approve fix" for the owner on pull request #${out.pr} (${out.repo}): ${out.result}.`);
if (out.result === 'merged') console.log('Checking the page in a browser after the redeploy (up to 60 s); the result goes in the thread.');
await settleProofs(90_000);
await events.idle();
process.exit(out.result === 'merged' ? 0 : 1);
