import { describe, expect, it } from 'vitest';
import { buildFixStepPrompt, fixTitle, parseFixAnswer } from '../src/fixStep.js';

const SUMMARY = 'On Chrome, the card image on the card page keeps blinking on and off about every second.';

describe('the pull request title from the fix model', () => {
  it('takes the Title line and leaves the sentence for "What was changed"', () => {
    const answer = 'Title: Keep the summary component stable across balance polls\nI moved CardSummary out of CardPage.';
    expect(parseFixAnswer(answer)).toEqual({ title: 'Keep the summary component stable across balance polls', changed: 'I moved CardSummary out of CardPage.' });
    expect(fixTitle(answer, SUMMARY)).toBe('Keep the summary component stable across balance polls');
  });

  it('accepts markdown around the label and drops quotes, backticks and a final dot', () => {
    expect(parseFixAnswer('**Title:** "Inline `CardSummary` in CardPage."\nDone.').title).toBe('Inline CardSummary in CardPage');
  });

  it('falls back to the reports summary when the line is missing, too short or too long', () => {
    const fallback = `Fix: ${SUMMARY}`;
    expect(fixTitle('I inlined the summary.', SUMMARY)).toBe(fallback);
    expect(fixTitle('Title: Fix\nI inlined it.', SUMMARY)).toBe(fallback);
    expect(fixTitle(`Title: ${'x'.repeat(73)}\nI inlined it.`, SUMMARY)).toBe(fallback);
    expect(fixTitle('', SUMMARY)).toBe(fallback);
  });

  it('keeps model text on one line and free of dashes', () => {
    const t = parseFixAnswer('Title: Stop remounting — CardPicture   on poll\nok').title;
    expect(t).toBe('Stop remounting, CardPicture on poll');
  });

  it('asks for the title without naming any part of the planted bug', () => {
    const prompt = buildFixStepPrompt({
      group: { id: 'g', page: 'card', summary: SUMMARY, reports: [], threadTs: '1' },
      owner: { page: 'card', repo: 'acme/app', codePath: 'src/pages/card/', githubLogin: 'o', slackUserId: 'U1' },
      investigation: { found: true, repo: 'acme/app', commitSha: 'abc1234', commitAuthor: null, mergedAt: null, pullRequestUrl: null, file: 'src/pages/card/CardPage.tsx', lines: '12-25', whatIsWrong: 'w', customerEffect: 'appearance', revertsCleanly: true, nextSteps: [], seconds: 1 },
      verdict: { severity: 'low', reason: 'r' },
    } as never);
    const ask = prompt.split('\n').at(-1)!;
    expect(ask).toMatch(/Title: /);
    expect(ask).not.toMatch(/CardPicture|CardSummary|balance|remount/i);
  });
});
