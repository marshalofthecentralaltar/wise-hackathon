// A stand-in for the grouping model that reads the real prompt and answers in the real format.
// A message's first word names its problem; "chat" marks chatter. Messages join the open group
// whose summary is that word, or start a new group per word.
import type { ModelCall } from '../../src/steps/grouping.js';

export interface FakeModel {
  call: ModelCall;
  calls: () => number;
  batches: string[][];
}

export function fakeModel(delayMs = 0): FakeModel {
  let calls = 0;
  const batches: string[][] = [];
  const call: ModelCall = async (prompt) => {
    calls++;
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    const groups = new Map<string, string>(); // summary word -> gN
    for (const m of prompt.matchAll(/^(g\d+) \[page: [^\]]+\] (\S+)/gm)) groups.set(m[2]!, m[1]!);
    const messages = [...prompt.matchAll(/^(m\d+): (".*")$/gm)].map((m) => ({ id: m[1]!, text: JSON.parse(m[2]!) as string }));
    batches.push(messages.map((m) => m.text));
    const labels = new Map<string, string>();
    const answer = messages.map(({ id, text }) => {
      const word = text.split(' ')[0]!;
      if (word === 'chat') return { id, is_report: false, page: null, group: null, summary: '' };
      let group = groups.get(word);
      if (!group) {
        group = labels.get(word) ?? `n${labels.size + 1}`;
        labels.set(word, group);
      }
      return { id, is_report: true, page: 'card', group, summary: word };
    });
    return { ok: true, text: JSON.stringify({ messages: answer }) };
  };
  return { call, calls: () => calls, batches };
}
