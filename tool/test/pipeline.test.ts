import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PipelineQueue, runPipeline, type PipelineDeps } from '../src/pipeline.js';
import { FakeSlack } from '../src/slackPost.js';
import type { CodeSteps, Investigation } from '../src/types.js';
import { FIX_NONE, FIX_PR, HIGH, INVESTIGATION, LOW, MONITORING, OWNER, group } from './fixtures-b2.js';

const tick = () => new Promise((r) => setTimeout(r, 5));

/** Stand-ins for steps 6 to 8 that record what they were given and when. */
function recordingSteps(over: Partial<CodeSteps> = {}) {
  const events: string[] = [];
  const seen: { textEffect?: unknown; fixCalls: number; judgeInput?: unknown } = { fixCalls: 0 };
  let classifyPromise: Promise<Investigation['customerEffect']> | undefined;
  const code: CodeSteps = {
    investigate: async () => {
      events.push('investigate:start');
      await tick();
      events.push('investigate:end');
      return INVESTIGATION;
    },
    classifyCustomerEffect: (texts) => {
      events.push(`classify:start:${texts.length}`);
      classifyPromise = tick().then(() => {
        events.push('classify:end');
        return 'appearance' as const;
      });
      return classifyPromise;
    },
    judge: async (input) => {
      events.push('judge');
      seen.textEffect = input.textEffect;
      seen.judgeInput = input;
      return LOW;
    },
    fix: async () => {
      seen.fixCalls++;
      events.push('fix');
      return FIX_PR;
    },
    ...over,
  };
  return { code, events, seen, classify: () => classifyPromise };
}

function deps(code: CodeSteps, slack = new FakeSlack(), over: Partial<PipelineDeps> = {}): PipelineDeps {
  return {
    code,
    slack,
    checkMonitoring: async () => MONITORING,
    listRecentChanges: async () => [],
    findOwner: async () => OWNER,
    customerSentence: async () => 'We know about the blinking picture and are working on it.',
    timingsPath: null,
    log: () => undefined,
    ...over,
  };
}

describe('runPipeline order', () => {
  it('starts investigate and classifyCustomerEffect together and passes the same promise to judge', async () => {
    const r = recordingSteps();
    const result = await runPipeline(group(), deps(r.code));
    expect(result.ok).toBe(true);
    // Both start before either ends.
    expect(r.events.slice(0, 2).sort()).toEqual(['classify:start:3', 'investigate:start']);
    expect(r.events.indexOf('judge')).toBeGreaterThan(r.events.indexOf('investigate:end'));
    expect(r.seen.textEffect).toBe(r.classify()); // the very promise, not an awaited value
    expect(r.seen.fixCalls).toBe(1);
    expect(r.events.at(-1)).toBe('fix');
  });

  it('calls fix once for a high verdict too, and the handoff has no part 7', async () => {
    const r = recordingSteps({ judge: async () => HIGH, fix: async () => FIX_NONE });
    let fixCalls = 0;
    const code = { ...r.code, fix: async (i: Parameters<CodeSteps['fix']>[0]) => (fixCalls++, r.code.fix(i)) };
    const slack = new FakeSlack();
    const result = await runPipeline(group(), deps(code, slack));
    expect(fixCalls).toBe(1);
    expect(result.handoff!.verdict.severity).toBe('high');
    expect(slack.posted.at(-1)!.text).not.toContain('*Fix:*');
  });

  it('fills report links, writes the timings line, and the handoff is the last message', async () => {
    const r = recordingSteps();
    const slack = new FakeSlack();
    const timingsPath = join(mkdtempSync(join(tmpdir(), 'timings-')), 'timings.jsonl');
    const result = await runPipeline(group(), deps(r.code, slack, { timingsPath, patternSeconds: 6.04 }));
    expect(result.handoff!.group.reports.every((x) => x.permalink?.startsWith('https://'))).toBe(true);
    expect(slack.posted.at(-1)!.blocks).toBeDefined();
    expect(slack.posted.at(-1)!.ts).toBe(result.handoffTs);
    expect(slack.posted.every((m) => m.threadTs === '1763050000.000100' && m.channel === 'C0SUPPORT')).toBe(true);
    const line = JSON.parse(readFileSync(timingsPath, 'utf8').trim());
    expect(line.groupId).toBe('group-1');
    expect(Object.keys(line.secondsByStep).sort()).toEqual(['changes', 'fix', 'handoff', 'investigation', 'monitoring', 'owner', 'pattern', 'post', 'verdict']);
    expect(line.secondsByStep.pattern).toBe(6);
  });
});

describe('the owner is named only in the handoff', () => {
  it('no message before the handoff carries the login, the name or the Slack id', async () => {
    const r = recordingSteps();
    const slack = new FakeSlack();
    // The owner as the real owners file has it, so the name from owners.json is checked too.
    const owner = { ...OWNER, githubLogin: 'nadimmetwalli', slackUserId: 'U0NADIM01', ownersLine: '/src/pages/card/ @nadimmetwalli' };
    await runPipeline(group(), deps(r.code, slack, { findOwner: async () => owner }));
    const texts = slack.posted.map((m) => m.text + JSON.stringify(m.blocks ?? []));
    expect(texts.length).toBeGreaterThan(3);
    const ownerStrings = ['nadimmetwalli', 'Nadim Metwalli', 'U0NADIM01'];
    for (const t of texts.slice(0, -1)) for (const s of ownerStrings) expect(t.toLowerCase()).not.toContain(s.toLowerCase());
    expect(texts.at(-1)).toContain('<@U0NADIM01>');
  });

  it('an error message that names the owner is scrubbed before it reaches the thread', async () => {
    const r = recordingSteps({ investigate: async () => Promise.reject(new Error('clone failed for ownerlogin (U0OWNER01)')) });
    const slack = new FakeSlack();
    await runPipeline(group(), deps(r.code, slack));
    const last = slack.posted.at(-1)!.text;
    expect(last).toContain('Stopped while investigating the code');
    expect(last).not.toContain('ownerlogin');
    expect(last).not.toContain('U0OWNER01');
  });
});

describe('a step that throws', () => {
  for (const [name, over, words] of [
    ['monitoring', { checkMonitoring: async () => Promise.reject(new Error('prometheus exploded')) }, 'Stopped while checking monitoring and logs: prometheus exploded'],
    ['owner', { findOwner: async () => Promise.reject(new Error('owners file unreadable')) }, 'Stopped while reading the owners file: owners file unreadable'],
  ] as const) {
    it(`${name}: a plain line in the thread, no handoff, runPipeline resolves`, async () => {
      const r = recordingSteps();
      const slack = new FakeSlack();
      const result = await runPipeline(group(), deps(r.code, slack, over as Partial<PipelineDeps>));
      expect(result.ok).toBe(false);
      expect(result.failedStep).toBe(name);
      expect(slack.posted.at(-1)!.text).toBe(`${words}. No handoff was posted for these reports.`);
      expect(slack.posted.some((m) => m.blocks)).toBe(false);
      expect(r.events).not.toContain('investigate:start');
    });
  }

  it('investigate: a plain line, no verdict, no fix, and the classification rejection is not left unhandled', async () => {
    const r = recordingSteps({
      investigate: async () => Promise.reject(new Error('claude did not answer')),
      classifyCustomerEffect: async () => Promise.reject(new Error('classify also failed')),
    });
    const slack = new FakeSlack();
    const result = await runPipeline(group(), deps(r.code, slack));
    expect(result.failedStep).toBe('investigation');
    expect(slack.posted.at(-1)!.text).toBe('Stopped while investigating the code: claude did not answer. No handoff was posted for these reports.');
    expect(r.events).not.toContain('judge');
    expect(r.seen.fixCalls).toBe(0);
  });

  it('verdict: a plain line in the thread', async () => {
    const r = recordingSteps({ judge: async () => Promise.reject(new Error('judge broke')) });
    const slack = new FakeSlack();
    const result = await runPipeline(group(), deps(r.code, slack));
    expect(result.failedStep).toBe('verdict');
    expect(slack.posted.at(-1)!.text).toContain('Stopped while judging severity: judge broke');
  });

  it('post: the handoff post fails, a plain line follows, runPipeline resolves', async () => {
    const r = recordingSteps();
    const slack = new FakeSlack();
    slack.failPost = (m) => (m.blocks ? new Error('invalid_blocks') : null);
    const result = await runPipeline(group(), deps(r.code, slack));
    expect(result.ok).toBe(false);
    expect(result.failedStep).toBe('post');
    expect(slack.posted.at(-1)!.text).toBe('Stopped while posting the handoff: invalid_blocks. No handoff was posted for these reports.');
  });

  it('fix: the handoff still goes out, without part 7, after a line saying the fix failed', async () => {
    const r = recordingSteps({ fix: async () => Promise.reject(new Error('tests failed twice')) });
    const slack = new FakeSlack();
    const result = await runPipeline(group(), deps(r.code, slack));
    expect(result.ok).toBe(true);
    expect(slack.posted.at(-2)!.text).toContain('The fix step failed: tests failed twice');
    expect(slack.posted.at(-1)!.text).not.toContain('*Fix:*');
    expect(slack.posted.at(-1)!.text).toContain('No pull request was opened: the fix step failed: tests failed twice.');
  });

  it('every Slack post failing: still resolves, never throws', async () => {
    const r = recordingSteps();
    const slack = new FakeSlack();
    slack.failPost = () => new Error('slack down');
    slack.failPermalink = true;
    const result = await runPipeline(group(), deps(r.code, slack));
    expect(result.ok).toBe(false);
    expect(result.failedStep).toBe('post');
  });
});

describe('PipelineQueue', () => {
  it('the same group fed twice runs once', async () => {
    const runs: string[] = [];
    const q = new PipelineQueue(async (g) => {
      runs.push(g.id);
      return runPipeline(g, deps(recordingSteps().code));
    });
    const g = group('group-7');
    const [a, b] = await Promise.all([q.enqueue(g), q.enqueue({ ...g, reports: [...g.reports] })]);
    await q.enqueue(g);
    expect(runs).toEqual(['group-7']);
    expect(a?.ok).toBe(true);
    expect(b).toBeNull();
  });

  it('runs one group at a time, in order, and a throwing run does not stop the next', async () => {
    const log: string[] = [];
    const q = new PipelineQueue(async (g) => {
      log.push(`start ${g.id}`);
      await tick();
      log.push(`end ${g.id}`);
      if (g.id === 'g1') throw new Error('boom');
      return runPipeline(g, deps(recordingSteps().code));
    });
    await Promise.all([q.enqueue(group('g1')), q.enqueue(group('g2'))]);
    expect(log).toEqual(['start g1', 'end g1', 'start g2', 'end g2']);
  });

  it('runs the real pipeline once per group with a real step chain end to end', async () => {
    let investigations = 0;
    const r = recordingSteps({ investigate: async () => (investigations++, INVESTIGATION) });
    const q = new PipelineQueue((g) => runPipeline(g, deps(r.code)));
    await Promise.all([q.enqueue(group('g9')), q.enqueue(group('g9'))]);
    await q.idle();
    expect(investigations).toBe(1);
  });
});

describe('part 8 and error lines (review round 1)', () => {
  it('the customer-sentence call starts before investigate is called', async () => {
    const r = recordingSteps();
    const order: string[] = [];
    const code = { ...r.code, investigate: async (i: Parameters<CodeSteps['investigate']>[0]) => (order.push('investigate'), r.code.investigate(i)) };
    await runPipeline(group(), deps(code, new FakeSlack(), {
      customerSentence: async () => (order.push('sentence'), 'We know about the blinking picture and are working on it.'),
      checkMonitoring: async () => (order.push('monitoring'), MONITORING),
    }));
    expect(order[0]).toBe('sentence');
    expect(order.indexOf('sentence')).toBeLessThan(order.indexOf('investigate'));
  });

  for (const draft of ['ownerlogin is looking at it now.', 'Commit abcdef1 caused this and we are working on it.', 'The bug is in Card.tsx and we are working on it.']) {
    it(`a draft naming the owner, the commit or the file falls back to the fixed sentence: "${draft}"`, async () => {
      const slack = new FakeSlack();
      const result = await runPipeline(group(), deps(recordingSteps().code, slack, { customerSentence: async () => draft }));
      expect(result.handoff!.sentenceForCustomers).toBe('We know about this problem on the card page and our team is working on it.');
      expect(slack.posted.at(-1)!.text).not.toContain(draft);
    });
  }

  it('a draft that passes is used as it is', async () => {
    const result = await runPipeline(group(), deps(recordingSteps().code, new FakeSlack(), { customerSentence: async () => 'We know the picture blinks and are working on it.' }));
    expect(result.handoff!.sentenceForCustomers).toBe('We know the picture blinks and are working on it.');
  });

  it('error text with Slack mentions is escaped in the stop line and the fix-failed line', async () => {
    const boom = () => Promise.reject(new Error('boom <!channel> <@U0CJEMEMMT2>'));
    for (const over of [{ checkMonitoring: boom }, {}]) {
      const r = recordingSteps(Object.keys(over).length ? {} : { fix: boom });
      const slack = new FakeSlack();
      await runPipeline(group(), deps(r.code, slack, over as Partial<PipelineDeps>));
      const all = slack.posted.map((m) => m.text + JSON.stringify(m.blocks ?? []));
      expect(all.some((t) => t.includes('boom &lt;!channel&gt;'))).toBe(true);
      for (const t of all) {
        expect(t).not.toContain('<!channel>');
        expect(t).not.toContain('<@U0CJEMEMMT2>');
      }
    }
  });
});
