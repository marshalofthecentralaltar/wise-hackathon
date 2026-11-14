import { describe, expect, it } from 'vitest';
import { approversFor } from '../src/handoff.js';
import { parseApproveValue } from '../src/approve.js';

describe('approvers (Ralf, Nadim, Roger)', () => {
  it('owner first, then the list, no repeats', () => {
    expect(approversFor('U0CJEMEMMT2', ['U0CHQ0RKFS8', 'U0CJEMEMMT2', 'U0CJEMFJTS4'])).toEqual(['U0CJEMEMMT2', 'U0CHQ0RKFS8', 'U0CJEMFJTS4']);
  });
  it('no owner in Slack still tags the list', () => {
    expect(approversFor(null, ['U0CHQ0RKFS8'])).toEqual(['U0CHQ0RKFS8']);
  });
  it('the button value keeps only valid ids', () => {
    const v = parseApproveValue(JSON.stringify({ repo: 'a/b', pr: 3, owner: 'U0CHQ0RKFS8', group: 'g', approvers: ['U0CHQ0RKFS8', 'bad', 'U0CJEMFJTS4'] }));
    expect(v?.approvers).toEqual(['U0CHQ0RKFS8', 'U0CJEMFJTS4']);
  });
});
