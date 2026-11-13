import { describe, expect, it } from 'vitest';
import {
  APPROVE_ACTION_ID,
  buildHandoffMessage,
  customerSentence,
  customerSentenceProblem,
  fallbackCustomerSentence,
  PART_ORDER,
} from '../src/handoff.js';
import { FIX_NONE, HIGH, INVESTIGATION, OWNER, handoff } from './fixtures-b2.js';

/** Index of each part's heading in the text: proves the order as a reader sees it, not just the array. */
const HEADINGS = ['*Problem:*', '*Reports:*', '*Monitoring and logs:*', '*Origin:*', '*The problem in the code:*', '*Next steps:*', '*Fix:*', '*What support may tell customers:*'];

describe('handoff parts', () => {
  it('low severity with a pull request: all eight parts, in the order of docs/CONTEXT.md', () => {
    const m = buildHandoffMessage(handoff());
    expect(m.parts.map((p) => p.id)).toEqual(PART_ORDER);
    const positions = HEADINGS.map((h) => m.text.indexOf(h));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    // Blocks follow the same order, with the button right after part 7.
    const ids = m.blocks.map((b) => b.block_id);
    expect(ids).toEqual(['handoff_problem', 'handoff_reports', 'handoff_monitoring', 'handoff_origin', 'handoff_code', 'handoff_next', 'handoff_fix', 'approve_fix_block', 'handoff_customers']);
    // Content of each part.
    expect(m.parts[0]!.text).toContain('Severity: low');
    expect(m.parts[1]!.text).toContain('3 messages');
    expect(m.parts[1]!.text).toContain('<https://x.slack.com/archives/C0SUPPORT/p0|1>');
    expect(m.parts[2]!.text).toContain('Prometheus shows no errors');
    expect(m.parts[3]!.text).toContain('`abcdef1`');
    expect(m.parts[3]!.text).toContain('someauthor');
    expect(m.parts[3]!.text).toContain('12 Nov 2026, 10:05 UTC');
    expect(m.parts[4]!.text).toContain('`src/pages/card/Card.tsx`, lines 12-20');
    expect(m.parts[5]!.text).toContain('<@U0OWNER01>');
    expect(m.parts[6]!.text).toContain('<https://github.com/acme/demo-app/pull/9|pull request #9>');
    expect(m.parts[7]!.text).toContain('We know the card picture blinks');
    expect(m.text).not.toMatch(/[—–]/);
  });

  it('carries the button with the owner and the pull request in its value', () => {
    const m = buildHandoffMessage(handoff());
    const actions = m.blocks.find((b) => b.type === 'actions') as { elements: { action_id: string; value: string; text: { text: string } }[] };
    expect(actions.elements[0]!.action_id).toBe(APPROVE_ACTION_ID);
    expect(actions.elements[0]!.text.text).toBe('Approve fix');
    expect(JSON.parse(actions.elements[0]!.value)).toEqual({ repo: 'acme/demo-app', pr: 9, owner: 'U0OWNER01', group: 'group-1' });
  });

  it('high severity: no part 7, no button, the other seven in order', () => {
    const m = buildHandoffMessage(handoff({ verdict: HIGH, fix: FIX_NONE }));
    expect(m.parts.map((p) => p.id)).toEqual(PART_ORDER.filter((p) => p !== 'fix'));
    expect(m.text).not.toContain('*Fix:*');
    expect(m.blocks.some((b) => b.type === 'actions')).toBe(false);
    expect(m.approve).toBeNull();
    expect(m.parts[0]!.text).toContain('Severity: high');
    // A high-severity handoff does not say a pull request is missing: none was meant to exist.
    expect(m.text).not.toContain('No pull request was opened');
  });

  it('low severity without a pull request: no part 7, and part 6 says why', () => {
    const m = buildHandoffMessage(handoff({ fix: { ...FIX_NONE, note: 'fix step not joined yet' } }));
    expect(m.parts.map((p) => p.id)).not.toContain('fix');
    expect(m.parts[5]!.text).toContain('No pull request was opened: fix step not joined yet.');
  });
});

describe('part 4: does the commit revert cleanly', () => {
  const origin = (revertsCleanly: boolean | null) =>
    buildHandoffMessage(handoff({ investigation: { ...INVESTIGATION, revertsCleanly } })).parts.find((p) => p.id === 'origin')!.text;

  it('true: reverts cleanly', () => {
    expect(origin(true)).toContain('so this commit reverts cleanly.');
  });
  it('false: does not revert cleanly', () => {
    expect(origin(false)).toContain('so this commit does not revert cleanly.');
    expect(origin(false)).not.toContain('so this commit reverts cleanly');
  });
  it('null: not tried', () => {
    expect(origin(null)).toContain('A trial revert was not tried');
    expect(origin(null)).not.toMatch(/so this commit (does not )?reverts? cleanly/);
  });
  it('the three sentences differ', () => {
    expect(new Set([origin(true), origin(false), origin(null)]).size).toBe(3);
  });
  it('no commit named: says so and claims nothing about a revert', () => {
    const m = buildHandoffMessage(handoff({ investigation: { ...INVESTIGATION, found: false, commitSha: null, revertsCleanly: null } }));
    expect(m.parts[3]!.text).toBe('*Origin:* the tool could not name the commit responsible.');
  });
});

describe('owner', () => {
  it('no owners line: says so, asks in the thread, tags nobody', () => {
    const m = buildHandoffMessage(handoff({ owner: { ...OWNER, githubLogin: null, slackUserId: null, ownersLine: null } }));
    expect(m.text).toContain('No owners line covers this page, so nobody is tagged. Who owns it? Please answer in this thread.');
    expect(m.text).not.toMatch(/<@[A-Z0-9]+>/);
    expect(m.text).not.toContain('ownerlogin');
    // No Slack id to check a press against: no button.
    expect(m.blocks.some((b) => b.type === 'actions')).toBe(false);
  });

  it('login known but not in Slack: names the login as plain text, tags nobody', () => {
    const m = buildHandoffMessage(handoff({ owner: { ...OWNER, slackUserId: null } }));
    expect(m.parts[5]!.text).toContain('ownerlogin on GitHub (not found in this Slack workspace)');
    expect(m.text).not.toMatch(/<@[A-Z0-9]+>/);
    expect(m.blocks.some((b) => b.type === 'actions')).toBe(false);
  });

  it('escapes Slack control characters in text the tool did not write', () => {
    const h = handoff();
    h.group.summary = 'Amount shows <b>&</b> twice';
    expect(buildHandoffMessage(h).parts[0]!.text).toContain('Amount shows &lt;b&gt;&amp;&lt;/b&gt; twice');
  });
});

describe('part 8: the sentence for customers', () => {
  const g = { summary: 'The card picture blinks', page: 'card' as const };

  it('uses the model sentence when it passes the rules', async () => {
    const s = await customerSentence(g, { model: async () => ({ ok: true, text: 'We know the card picture is blinking and we are working on it.' }) });
    expect(s).toBe('We know the card picture is blinking and we are working on it.');
  });

  it('falls back when the model fails', async () => {
    expect(await customerSentence(g, { model: async () => ({ ok: false, text: '' }) })).toBe(fallbackCustomerSentence(g));
    expect(await customerSentence(g, { model: async () => Promise.reject(new Error('x')) })).toBe(fallbackCustomerSentence(g));
  });

  it('falls back after the timeout', async () => {
    const t0 = Date.now();
    const s = await customerSentence(g, { timeoutMs: 50, model: () => new Promise((r) => setTimeout(() => r({ ok: true, text: 'Late.' }), 2000)) });
    expect(s).toBe(fallbackCustomerSentence(g));
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('falls back when the sentence names a commit, a file, a person or a time', async () => {
    for (const text of [
      'Commit abcdef1 broke it and we are fixing it.',
      'A change in CardPage.tsx caused it.',
      'Ownerlogin is fixing it.',
      'It will be fixed within two hours.',
      'It will be fixed today.',
      'We are sorry. We know about it and are working on it.',
    ]) {
      expect(await customerSentence(g, { forbidden: ['ownerlogin'], model: async () => ({ ok: true, text }) })).toBe(fallbackCustomerSentence(g));
    }
  });

  it('the fixed sentence passes its own rules', () => {
    expect(customerSentenceProblem(fallbackCustomerSentence(g))).toBeNull();
    expect(customerSentenceProblem(fallbackCustomerSentence({ page: null }))).toBeNull();
  });
});
