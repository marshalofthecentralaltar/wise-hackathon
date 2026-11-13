// STAND-IN for step 8 until the fix step (src/fixStep.ts, another lane) is joined. It changes
// no code and opens no pull request. The orchestrator replaces its use in main.ts at the join.
import type { FixOutcome, FixStepInput } from './types.js';

export async function standInFix(_input: FixStepInput): Promise<FixOutcome> {
  return { kind: 'none', prUrl: null, prNumber: null, branch: null, filesChanged: [], testsPassed: null, note: 'fix step not joined yet', seconds: 0 };
}
