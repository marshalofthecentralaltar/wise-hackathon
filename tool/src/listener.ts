// What the listener does with one Slack `message` event: filter it, add it to the report store,
// and queue each group that just reached the threshold. Kept apart from main.ts so it runs in
// tests without Slack. Never rejects.
import { isCustomerReportCandidate, type OwnIdentity, type SlackMessageEvent } from './slack.js';
import type { Report, ReportGroup } from './types.js';

export interface MessageHandlerDeps {
  own: OwnIdentity;
  /** The #support channel id; messages elsewhere are ignored. */
  channelId: string;
  addReports: (reports: Report[]) => Promise<ReportGroup[]>;
  /** Queues one pipeline run; patternSeconds is how long step 2 took for this message. */
  enqueue: (group: ReportGroup, patternSeconds: number) => unknown;
  log?: (line: string) => void;
}

export function makeMessageHandler(deps: MessageHandlerDeps): (event: SlackMessageEvent) => Promise<void> {
  const log = deps.log ?? ((m: string) => console.error(m));
  return async (event) => {
    try {
      if (event.channel !== deps.channelId || !isCustomerReportCandidate(event, deps.own)) return;
      const report: Report = { channel: deps.channelId, ts: event.ts ?? '', sender: event.user ?? event.bot_id ?? '', text: event.text ?? '' };
      const t0 = performance.now();
      const triggered = await deps.addReports([report]);
      const patternSeconds = (performance.now() - t0) / 1000;
      for (const group of triggered) {
        log(`[tool] ${group.id} reached ${group.reports.length} reports: ${group.summary}`);
        void deps.enqueue(group, patternSeconds);
      }
    } catch (err) {
      log(`[tool] message handler failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    }
  };
}
