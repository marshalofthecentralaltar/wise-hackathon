// node helpdesk/test.mjs
// No Slack and no Claude: both are replaced by fakes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyRemovals, applyRules, ibanValid, leakCheck } from './lib/pii.mjs';
import { NOT_DESCRIBED, SLACK_LIMIT, cut, describeAgent, processEdit, processTicket, slackText } from './lib/pipeline.mjs';
import { imageKind, isLocal, readTicketInput } from './lib/http.mjs';
import { extractStructured } from './lib/claude.mjs';
import { parseSecrets, secretsFile } from './lib/slack.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const F = { name: 'Oliver Brandt', email: 'oliver.brandt@example.com', phone: '+372 5555 0142', customerNumber: 'DB-482913' };
const rules = (text, fields = {}) => applyRules(text, fields).text;
const ticket = (over = {}) => ({ id: 'T-1042', page: 'card', userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/131.0 Safari/537.36', createdAt: '2026-11-14T08:42:00.000Z', ...F, text: 'The card picture blinks.', ...over });
const claudeNone = async () => ({ remove: [], unsure: false, reason: '' });
const noShot = async () => ({ error: 'not called' });

// ---- layer 1, each rule, in English, Estonian and Russian -------------------------------------

test('the ticket\'s own field values are removed, also inside the text and in another letter case', () => {
  assert.equal(rules('This is Oliver Brandt, write to OLIVER.BRANDT@example.com', F), 'This is [name], write to [email]');
  assert.equal(rules('Kirjutab oliver, kliendinumber DB-482913', F), 'Kirjutab [name], kliendinumber [customer number]');
  assert.equal(rules('Это Brandt, телефон +372 5555 0142', F), 'Это [name], телефон [phone]');
});

test('the phone from the field is found with other spacing', () => {
  assert.equal(rules('helistage 55550142', F), 'helistage [phone]');
});

test('any email address', () => {
  assert.equal(rules('mail me at someone.else@example.org please'), 'mail me at [email] please');
  assert.equal(rules('kirjutage tiit@example.com'), 'kirjutage [email]');
  assert.equal(rules('почта ivan@example.com'), 'почта [email]');
});

test('phone numbers', () => {
  assert.equal(rules('call +372 5555 0178 today'), 'call [phone] today');
  assert.equal(rules('helistage 5555 0178'), 'helistage [phone]');
  assert.equal(rules('звоните +7 912 345-67-89'), 'звоните [phone]');
});

test('card numbers that pass the Luhn check', () => {
  assert.equal(rules('paid with 4111 1111 1111 1111'), 'paid with [card number]');
  assert.equal(rules('maksin kaardiga 4111-1111-1111-1111'), 'maksin kaardiga [card number]');
  assert.equal(rules('картой 4111111111111111'), 'картой [card number]');
});

test('IBANs that pass mod-97, also with a currency after them', () => {
  assert.ok(ibanValid('EE38 2200 2210 2014 5685'));
  assert.equal(rules('from EE38 2200 2210 2014 5685 yesterday'), 'from [account number] yesterday');
  assert.equal(rules('kontolt EE382200221020145685 EUR'), 'kontolt [account number] EUR');
  assert.equal(rules('со счёта GB82 WEST 1234 5698 7654 32'), 'со счёта [account number]');
});

test('customer numbers', () => {
  assert.equal(rules('customer DB-731905 here'), 'customer [customer number] here');
  assert.equal(rules('klient db-731905'), 'klient [customer number]');
  assert.equal(rules('клиент DB-731905'), 'клиент [customer number]');
});

test('dates of birth', () => {
  assert.equal(rules('born 03.05.1988, thanks'), 'born [date of birth], thanks');
  assert.equal(rules('sünnipäev 3.5.1988'), 'sünnipäev [date of birth]');
  assert.equal(rules('дата рождения 03.05.1988'), 'дата рождения [date of birth]');
});

test('street addresses', () => {
  assert.equal(rules('I live at Tamme tänav 12, Tartu'), 'I live at [address], Tartu');
  assert.equal(rules('elan Pärnu mnt 5a-3'), 'elan [address]');
  assert.equal(rules('at 12 Baker Street now'), 'at [address] now');
  assert.equal(rules('живу ул. Ленина 5'), 'живу [address]');
});

// ---- what the tool needs survives ---------------------------------------------------------------

test('kept on purpose: ticket number, card ending, amounts, times, dates of the problem, browser', () => {
  const t = 'Ticket T-1042: card ending 4821, sent 250.00 EUR, shows 25.00 EUR, 1,200.00 EUR, 80 eurot, 1 200,00 евро, since 9 this morning, 10:42 on 2026-11-14, Chrome on an iPhone 14.';
  assert.equal(rules(t, F), t);
});

test('a name part of 2 letters does not remove other words', () => {
  assert.equal(rules('Li says the light blinks, like a list', { name: 'Li Wu' }), 'Li says the light blinks, like a list');
  assert.equal(rules('Li Wu says the light blinks', { name: 'Li Wu' }), '[name] says the light blinks');
});

test('name parts match whole words only', () => {
  assert.equal(rules('Marianne and Mari wrote', { name: 'Mari Kask' }), 'Marianne and [name] wrote');
});

// ---- layer 2, applied by code ------------------------------------------------------------------

test('a Claude removal that is not a substring of the text is ignored', () => {
  const r = applyRemovals('Kase Mari says it blinks', [{ text: 'Mari Kase', kind: 'name' }, { text: 'Kase Mari', kind: 'name' }]);
  assert.equal(r.text, '[name] says it blinks');
  assert.deepEqual(r.ignored, ['Mari Kase']);
});

test('Claude removals cannot add text or touch markers', () => {
  const r = applyRemovals('[name] says it blinks', [{ text: '[name]', kind: 'other' }, { text: 'x', kind: 'name' }, { text: 'says', kind: 'nonsense' }]);
  assert.equal(r.text, '[name] [personal data] it blinks');
  assert.ok(r.text.length <= '[name] says it blinks'.length + '[personal data]'.length);
});

test('a Claude failure holds the ticket', async () => {
  const r = await processTicket(ticket(), { claudeCheck: async () => ({ error: 'claude did not start' }), describeScreenshot: noShot });
  assert.equal(r.status, 'held');
  assert.match(r.reason, /Claude check failed/);
});

test('a Claude timeout holds the ticket', async () => {
  const r = await processTicket(ticket(), { claudeCheck: async () => ({ error: 'claude did not answer in 20 s' }), describeScreenshot: noShot });
  assert.equal(r.status, 'held');
  assert.match(r.reason, /20 s/);
});

test('Claude unsure holds the ticket', async () => {
  const r = await processTicket(ticket(), { claudeCheck: async () => ({ remove: [], unsure: true, reason: 'maybe a name' }), describeScreenshot: noShot });
  assert.equal(r.status, 'held');
  assert.match(r.reason, /maybe a name/);
});

test('a name only Claude finds is removed', async () => {
  const r = await processTicket(ticket({ text: 'Kirjutas Kase Mari, kaardi pilt vilgub.' }), {
    claudeCheck: async () => ({ remove: [{ text: 'Kase Mari', kind: 'name' }], unsure: false, reason: '' }),
    describeScreenshot: noShot,
  });
  assert.equal(r.status, 'ready');
  assert.match(r.slackText, /Kirjutas \[name\], kaardi pilt vilgub\./);
  assert.ok(r.removed.some((x) => x.by === 'claude'));
});

// ---- layer 3 ------------------------------------------------------------------------------------

test('the leak gate finds the customer name in another letter case', () => {
  assert.deepEqual(leakCheck('Ticket T-1042, card page: OLIVER BRANDT says it blinks', F).map((l) => l.kind), ['name']);
  assert.deepEqual(leakCheck('Ticket T-1042, card page: [name] says it blinks', F), []);
});

test('an edited held ticket with an email in it is held again', () => {
  const r = processEdit(ticket(), 'Customer says it blinks, reach them at new.address@example.com');
  assert.equal(r.status, 'held');
  assert.match(r.proposedText, /\[email\]/);
  assert.equal(processEdit(ticket(), r.proposedText).status, 'ready');
});

// ---- the screenshot ------------------------------------------------------------------------------

test('the screenshot description goes through the filter too', async () => {
  const r = await processTicket(ticket({ screenshotPath: '/x.png' }), {
    claudeCheck: claudeNone,
    describeScreenshot: async () => ({ description: 'The card image for Oliver Brandt is missing in this frame.' }),
  });
  assert.equal(r.status, 'ready');
  assert.match(r.slackText, /Screenshot shows: The card image for \[name\] is missing in this frame\./);
});

test('a failed description says the screenshot was not described', async () => {
  const r = await processTicket(ticket({ screenshotPath: '/x.png' }), { claudeCheck: claudeNone, describeScreenshot: async () => ({ error: 'timeout' }) });
  assert.equal(r.status, 'ready');
  assert.ok(r.slackText.endsWith(NOT_DESCRIBED));
});

// ---- the Slack message ---------------------------------------------------------------------------

test('the Slack message starts with ticket, page, browser and system, and time', () => {
  const t = ticket({ createdAt: new Date(2026, 10, 14, 10, 42).toISOString() });
  assert.equal(slackText(t, 'It blinks.', null), 'Ticket T-1042, card page, Chrome on Windows, 10:42: It blinks.');
  assert.match(slackText({ ...t, page: 'other' }, 'x', null), /page not given/);
  assert.equal(describeAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) Version/18.1 Mobile Safari/604.1'), 'Safari on iPhone');
});

test('the Slack message is at most 600 characters, cut at a word', () => {
  const long = slackText(ticket(), 'word '.repeat(300), null);
  assert.ok(long.length <= SLACK_LIMIT);
  assert.ok(long.endsWith('word…'));
  assert.equal(cut('short'), 'short');
});

test('every seed ticket comes out with none of its personal values, with a Claude that finds nothing', async () => {
  const seeds = JSON.parse(readFileSync(join(here, 'seed-tickets.json'), 'utf8'));
  for (const [i, s] of seeds.entries()) {
    const r = await processTicket({ ...s, id: `T-${1001 + i}`, createdAt: '2026-11-14T08:42:00Z', screenshotPath: null }, { claudeCheck: claudeNone, describeScreenshot: noShot });
    assert.equal(r.status, 'ready', `${s.problem} ${s.lang}: ${r.reason}`);
    for (const v of [s.name, ...s.name.split(' '), s.email, s.phone, s.customerNumber].filter(Boolean)) {
      assert.ok(!r.slackText.toLowerCase().includes(v.toLowerCase()), `${v} leaked`);
    }
    for (const kept of ['4821', '250.00 EUR', '25.00 EUR', '120,00 евро', '8.00 EUR']) {
      if (s.text.includes(kept)) assert.ok(r.slackText.includes(kept), `${kept} lost`);
    }
    assert.ok(!/4111|EE38|Tamme|1988/.test(r.slackText), 'card, IBAN, address or birth date leaked');
  }
});

// ---- the form endpoint and the inbox address check -------------------------------------------------

test('only this computer may open the inbox', () => {
  assert.ok(isLocal('127.0.0.1') && isLocal('::1') && isLocal('::ffff:127.0.0.1'));
  assert.ok(!isLocal('192.168.1.20') && !isLocal('::ffff:10.0.0.5') && !isLocal(undefined));
});

test('the screenshot is checked by its first bytes', () => {
  const png = readFileSync(join(here, 'seed-screenshots', 'flicker.png'));
  assert.equal(imageKind(png), 'png');
  assert.equal(imageKind(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'jpg');
  assert.equal(imageKind(Buffer.from('GIF89a')), null);
  const base = { name: 'A B', email: 'a@example.com', page: 'card', text: 'The card picture blinks' };
  assert.match(readTicketInput({ ...base, screenshot: { dataBase64: Buffer.from('<svg>').toString('base64') } }, '').error, /PNG or JPEG/);
  assert.equal(readTicketInput({ ...base, screenshot: { dataBase64: 'data:image/png;base64,' + png.toString('base64') } }, '').screenshot.ext, 'png');
  assert.match(readTicketInput({ ...base, screenshot: { dataBase64: Buffer.alloc(5 * 1024 * 1024 + 10, 0xff).toString('base64') } }, '').error, /5 MB/);
});

test('the form fields are checked', () => {
  const base = { name: 'A B', email: 'a@example.com', page: 'card', text: 'The card picture blinks' };
  assert.ok(readTicketInput(base, '').fields);
  assert.match(readTicketInput({ ...base, email: 'nope' }, '').error, /email/);
  assert.match(readTicketInput({ ...base, page: 'home' }, '').error, /page/);
  assert.match(readTicketInput({ ...base, text: 'short' }, '').error, /10 to 1000/);
  assert.match(readTicketInput({ ...base, customerNumber: 'DB-12' }, '').error, /DB-/);
});

// ---- small parts ----------------------------------------------------------------------------------

test('the structured Claude answer is read from the result', () => {
  assert.deepEqual(extractStructured(JSON.stringify({ type: 'result', is_error: false, result: '{"remove":[]}' })), { remove: [] });
  assert.deepEqual(extractStructured(JSON.stringify({ type: 'result', structured_output: { a: 1 } })), { a: 1 });
  assert.equal(extractStructured('not json'), null);
  assert.equal(extractStructured(JSON.stringify({ type: 'result', is_error: true, result: '{}' })), null);
});

test('the secrets file is found the same way as the tool finds it', () => {
  assert.equal(secretsFile({ WISE_SECRETS_FILE: '/x/s.env' }), resolve('/x/s.env'));
  assert.equal(secretsFile({ WISE_BUILD_DIR: '/b' }), resolve('/b', 'secrets.env'));
  assert.deepEqual(parseSecrets('# c\nSLACK_TEST_BOT_TOKEN=xoxb-1\nEMPTY=\n'), { SLACK_TEST_BOT_TOKEN: 'xoxb-1', EMPTY: '' });
});
