// The few Slack calls steps 9 and 10 make, behind a small port so the pipeline and the
// "Approve fix" handler run in tests against a fake and in the tool against @slack/web-api.
import { WebClient } from '@slack/web-api';

/** A Slack layout block. Kept loose: the tool builds only section, context and actions blocks. */
export type SlackBlock = Record<string, unknown>;

export interface SlackMessage {
  channel: string;
  /** Post as a reply in this thread. */
  threadTs?: string;
  /** Fallback text: notifications, and what clients without blocks show. */
  text: string;
  blocks?: SlackBlock[];
}

export interface SlackPort {
  postMessage(msg: SlackMessage): Promise<{ ts: string }>;
  updateMessage(msg: { channel: string; ts: string; text: string; blocks?: SlackBlock[] }): Promise<void>;
  /** A line only `user` sees. */
  postEphemeral(msg: { channel: string; user: string; threadTs?: string; text: string }): Promise<void>;
  getPermalink(channel: string, ts: string): Promise<string>;
}

export function webSlackPort(client: WebClient): SlackPort {
  return {
    async postMessage({ channel, threadTs, text, blocks }) {
      const r = await client.chat.postMessage({
        channel,
        text,
        ...(threadTs ? { thread_ts: threadTs } : {}),
        ...(blocks ? { blocks: blocks as never } : {}),
        unfurl_links: false,
        unfurl_media: false,
      });
      return { ts: String(r.ts ?? '') };
    },
    async updateMessage({ channel, ts, text, blocks }) {
      await client.chat.update({ channel, ts, text, ...(blocks ? { blocks: blocks as never } : {}) });
    },
    async postEphemeral({ channel, user, threadTs, text }) {
      await client.chat.postEphemeral({ channel, user, text, ...(threadTs ? { thread_ts: threadTs } : {}) });
    },
    async getPermalink(channel, ts) {
      const r = await client.chat.getPermalink({ channel, message_ts: ts });
      return String(r.permalink ?? '');
    },
  };
}

export interface RecordedMessage extends SlackMessage {
  ts: string;
}

/** For tests: records every call; any method can be made to throw. */
export class FakeSlack implements SlackPort {
  posted: RecordedMessage[] = [];
  updates: { channel: string; ts: string; text: string; blocks?: SlackBlock[] }[] = [];
  ephemerals: { channel: string; user: string; threadTs?: string; text: string }[] = [];
  /** Throws from postMessage when this returns an Error. */
  failPost: (msg: SlackMessage) => Error | null = () => null;
  failPermalink = false;
  private seq = 0;

  async postMessage(msg: SlackMessage): Promise<{ ts: string }> {
    const err = this.failPost(msg);
    if (err) throw err;
    const ts = `1763060000.${String(++this.seq).padStart(6, '0')}`;
    this.posted.push({ ...msg, ts });
    return { ts };
  }
  async updateMessage(msg: { channel: string; ts: string; text: string; blocks?: SlackBlock[] }): Promise<void> {
    this.updates.push(msg);
  }
  async postEphemeral(msg: { channel: string; user: string; threadTs?: string; text: string }): Promise<void> {
    this.ephemerals.push(msg);
  }
  async getPermalink(channel: string, ts: string): Promise<string> {
    if (this.failPermalink) throw new Error('permalink failed');
    return `https://example.slack.com/archives/${channel}/p${ts.replace('.', '')}`;
  }
}
