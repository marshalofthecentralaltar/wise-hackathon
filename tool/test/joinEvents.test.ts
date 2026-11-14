// The join of the events file (#22) and the browser proof (#23): one whole run, from the reports to
// the page checked after the redeploy, must be ONE run in the events file. The pipeline writes
// `group-1@<startedAt>`; the browser proof and the approval know only `group-1`. A second id in
// the middle of a run would make the process screen (#20) clear the steps it already shows.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ApprovePress, GhRunner } from '../src/approve.js';
import { approveWithProof, settleProofs, withReproduction, type CheckRun, type ProofDeps } from '../src/browserProof.js';
import { makeRunEvents, type ToolEvent } from '../src/events.js';
import { buildHandoffMessage } from '../src/handoff.js';
import { runPipeline } from '../src/pipeline.js';
import { FakeSlack } from '../src/slackPost.js';
import type { CodeSteps } from '../src/types.js';
import { FIX_PR, INVESTIGATION, LOW, MONITORING, OWNER, group } from './fixtures-b2.js';

const tmp = (prefix: string) => mkdtempSync(join(tmpdir(), prefix));
const REPRODUCED: CheckRun = { ran: true, pass: true, seconds: 7.2, result: { card_picture_replaced: true, card_picture_replacements: 5, seconds_watched: 5 } };
const STABLE: CheckRun = { ran: true, pass: true, seconds: 7.0, result: { card_picture_replaced: false, card_picture_replacements: 0, seconds_watched: 5 } };

const code: CodeSteps = {
  investigate: async () => {
    await new Promise((r) => setTimeout(r, 30));
    return INVESTIGATION;
  },
  classifyCustomerEffect: async () => 'appearance',
  judge: async () => LOW,
  fix: async () => FIX_PR,
};

const read = (path: string) =>
  readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as ToolEvent);

describe('events file and browser proof joined: one run, one run id', () => {
  for (const host of ['the tool process approves (a person presses on stage)', 'another process approves (full-run, approve-latest)'] as const) {
    it(`${host}: every line from the reports to the proof carries the pipeline's run id`, async () => {
      const path = join(tmp('join-events-'), 'events.jsonl');
      const deployDir = tmp('join-deploy-');
      writeFileSync(join(deployDir, '.deployed.json'), JSON.stringify({ commit: 'aaaaaaa', at: '2026-11-14T01:00:00Z' }));
      const slack = new FakeSlack();
      const toolEvents = makeRunEvents(path);
      const proof = (emit: ProofDeps['emit']): ProofDeps => ({
        slack,
        emit,
        statePath: join(tmp('join-proof-'), 'reproductions.json'),
        deployDir,
        baseUrl: 'http://localhost:1',
        retryMs: 5,
        pollMs: 5,
        proofWindowMs: 3_000,
        enabled: true,
        log: () => undefined,
        runCheck: async (_file, expect) => (expect === 'replaced' ? REPRODUCED : STABLE),
      });
      const toolProof = proof(toolEvents.emitBare);

      const result = await runPipeline(group('group-1'), {
        code: withReproduction(code, toolProof),
        slack,
        checkMonitoring: async () => MONITORING,
        listRecentChanges: async () => [],
        findOwner: async () => OWNER,
        customerSentence: async () => 'We know about the blinking picture and are working on it.',
        timingsPath: null,
        log: () => undefined,
        emit: toolEvents.emit,
      });
      expect(result.ok).toBe(true);
      await settleProofs(5_000);
      await toolEvents.idle();

      // The press, with the button value the handoff of this very run carries.
      const message = buildHandoffMessage(result.handoff!);
      const button = (message.blocks.find((b) => b.type === 'actions') as { elements: { value: string }[] }).elements[0]!;
      const press: ApprovePress = { userId: OWNER.slackUserId!, channel: 'C0SUPPORT', messageTs: result.handoffTs ?? '1', threadTs: group('group-1').threadTs, value: button.value, blocks: message.blocks };
      // The merge makes the card app redeploy.
      const gh: GhRunner = async () => {
        writeFileSync(join(deployDir, '.deployed.json'), JSON.stringify({ commit: 'ccccccc', at: '2026-11-14T01:01:00Z' }));
        return { code: 0, stdout: '', stderr: '' };
      };
      const approveDeps = { slack, gh, statePath: join(tmp('join-approve-'), 'approvals.json'), log: () => undefined };
      const scriptEvents = host.startsWith('another') ? makeRunEvents(path) : toolEvents;
      const approvalProof: ProofDeps = host.startsWith('another') ? { ...toolProof, emit: scriptEvents.emitBare } : toolProof;
      expect(await approveWithProof(approvalProof)(press, approveDeps)).toBe('merged');
      await settleProofs(5_000);
      await scriptEvents.idle();

      const events = read(path);
      const runId = `group-1@${result.timings.startedAt}`;
      expect(new Set(events.map((e) => e.groupId))).toEqual(new Set([runId]));
      for (const e of events) {
        expect(e.v).toBe(1);
        expect(Number.isNaN(Date.parse(e.at))).toBe(false);
      }
      const seq = events.map((e) => `${e.step}:${e.state}`);
      expect(seq[0]).toBe('reports:done');
      for (const s of ['reproduction:start', 'reproduction:done', 'handoff:done', 'approval:done', 'deploy:start', 'deploy:done', 'proof:start', 'proof:done']) expect(seq, s).toContain(s);
      expect(seq.indexOf('reproduction:start')).toBeGreaterThan(seq.indexOf('investigation:start') - 2); // starts beside the investigation
      expect(seq.indexOf('approval:done')).toBeGreaterThan(seq.indexOf('handoff:done'));
      expect(seq.at(-1)).toBe('proof:done');
      const done = (step: string) => events.find((e) => e.step === step && e.state === 'done')!.evidence as Record<string, unknown>;
      expect(done('approval')).toEqual({ by: 'owner', prNumber: FIX_PR.prNumber, result: 'merged' });
      expect(done('deploy')).toMatchObject({ sha: 'ccccccc' });
      expect(done('proof')).toMatchObject({ check: 'check-flicker.mjs', pass: true });
      // No Slack id anywhere in the file.
      expect(readFileSync(path, 'utf8')).not.toContain(OWNER.slackUserId!);
    });
  }
});
