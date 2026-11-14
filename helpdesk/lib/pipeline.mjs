// From a submitted ticket to the Slack text, or to "Held" with the reason. Layer 1 rules, layer 2
// Claude check, layer 3 leak gate. The model calls and the Slack post are passed in, so tests
// replace them.
import { applyRemovals, applyRules, leakCheck } from './pii.mjs';

export const SLACK_LIMIT = 600;
export const NOT_DESCRIBED = 'Screenshot attached in the helpdesk, not described.';
const PAGE_WORDS = { card: 'card page', transfers: 'transfers page', account: 'account page', other: 'page not given' };

/** "Chrome on Windows" from a user agent; good enough for the header, never personal. */
export function describeAgent(ua = '') {
  const browser = /Edg\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Firefox\//.test(ua) ? 'Firefox' : /(Chrome|CriOS)\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'a browser';
  const system = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'an unknown system';
  return `${browser} on ${system}`;
}

export function hhmm(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Cuts at a word boundary and adds "…" when the text is longer than the limit. */
export function cut(text, limit = SLACK_LIMIT) {
  if (text.length <= limit) return text;
  const room = text.slice(0, limit - 1);
  const at = room.lastIndexOf(' ');
  return (at > limit / 2 ? room.slice(0, at) : room).replace(/[\s,;:.]+$/, '') + '…';
}

export function slackText(ticket, body, screenshotPart) {
  const header = `Ticket ${ticket.id}, ${PAGE_WORDS[ticket.page] ?? 'page not given'}, ${describeAgent(ticket.userAgent)}, ${hhmm(ticket.createdAt)}:`;
  const parts = [header, body.trim()];
  if (screenshotPart) parts.push(screenshotPart);
  return cut(parts.join(' ').replace(/\s+/g, ' ').trim());
}

const fieldsOf = (t) => ({ name: t.name, email: t.email, phone: t.phone, customerNumber: t.customerNumber });

/** Layer 1 then layer 2 on one piece of text. Resolves {text, removed, held?}. */
async function filterText(text, fields, deps) {
  const one = applyRules(text, fields);
  const check = await deps.claudeCheck(one.text);
  if (check.error) return { text: one.text, removed: one.removed, held: `Claude check failed: ${check.error}` };
  const two = applyRemovals(one.text, check.remove);
  const removed = [...one.removed, ...two.removed];
  if (check.unsure) return { text: two.text, removed, held: `Claude check unsure: ${check.reason || 'no reason given'}` };
  return { text: two.text, removed, ignored: two.ignored };
}

/**
 * Resolves {status: 'ready', slackText, removed, description?} or {status: 'held', reason,
 * proposedText, removed}. Never rejects.
 */
export async function processTicket(ticket, deps) {
  const fields = fieldsOf(ticket);
  try {
    const textJob = filterText(ticket.text, fields, deps);
    const shotJob = ticket.screenshotPath
      ? deps.describeScreenshot(ticket.screenshotPath, applyRules(ticket.text, fields).text).then(async (d) => {
          if (d.error) return { note: NOT_DESCRIBED, describeError: d.error };
          const f = await filterText(d.description, fields, deps);
          return { filtered: f };
        })
      : Promise.resolve(null);
    const [body, shot] = await Promise.all([textJob, shotJob]);

    let removed = [...body.removed];
    let held = body.held;
    let screenshotPart = null;
    if (shot?.filtered) {
      removed = removed.concat(shot.filtered.removed);
      held ??= shot.filtered.held;
      screenshotPart = `Screenshot shows: ${shot.filtered.text}`;
    } else if (shot?.note) {
      screenshotPart = shot.note;
    }
    const text = slackText(ticket, body.text, screenshotPart);
    const leaks = leakCheck(text, fields);
    if (!held && leaks.length) held = `Leak gate found ${[...new Set(leaks.map((l) => l.kind))].join(', ')} in the outgoing text`;
    if (held) return { status: 'held', reason: held, proposedText: body.text, removed, describeError: shot?.describeError };
    return { status: 'ready', slackText: text, removed, describeError: shot?.describeError };
  } catch (err) {
    return { status: 'held', reason: `Filter failed: ${err.message}`, proposedText: '', removed: [] };
  }
}

/** An agent's edit of a held ticket: layer 1 and layer 3 again, not Claude, so a person can always get it out. */
export function processEdit(ticket, editedText) {
  const fields = fieldsOf(ticket);
  const one = applyRules(String(editedText ?? ''), fields);
  const text = slackText(ticket, one.text, null);
  const leaks = leakCheck(text, fields);
  if (leaks.length) return { status: 'held', reason: `Leak gate found ${[...new Set(leaks.map((l) => l.kind))].join(', ')} in the edited text`, proposedText: one.text, removed: one.removed };
  if (one.removed.length) {
    // The rules removed something from the agent's edit; show it back rather than post blind.
    return { status: 'held', reason: `The rules removed ${[...new Set(one.removed.map((r) => r.kind))].join(', ')} from the edited text; check it and send again`, proposedText: one.text, removed: one.removed };
  }
  return { status: 'ready', slackText: text, removed: [] };
}
