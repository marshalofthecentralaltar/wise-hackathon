// The ticket store: one JSON object per line in helpdesk/.state/tickets.jsonl, appended on each
// change, read back on start. Screenshots are files next to it. Everything personal stays here.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function openStore(dir) {
  mkdirSync(join(dir, 'screenshots'), { recursive: true });
  const file = join(dir, 'tickets.jsonl');
  const tickets = new Map();
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line);
        if (e.type === 'created') tickets.set(e.ticket.id, e.ticket);
        else if (e.type === 'update' && tickets.has(e.id)) Object.assign(tickets.get(e.id), e.patch);
      } catch {
        // a torn last line; skip it
      }
    }
  }
  // A ticket that was being checked when the server stopped is held, so a person decides.
  for (const t of tickets.values()) {
    if (t.status === 'New' || t.status === 'Checking') {
      const patch = { status: 'Held', heldReason: 'The helpdesk restarted while this ticket was being checked', proposedText: t.proposedText ?? '', history: [...(t.history ?? []), { status: 'Held', at: new Date().toISOString() }] };
      Object.assign(t, patch);
      appendFileSync(file, JSON.stringify({ type: 'update', id: t.id, patch }) + '\n');
    }
  }
  let next = 1001;
  for (const id of tickets.keys()) next = Math.max(next, Number(id.slice(2)) + 1);

  return {
    dir,
    list: () => [...tickets.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)),
    get: (id) => tickets.get(id),
    create(fields) {
      const id = `T-${next++}`;
      const t = { id, ...fields, status: 'New', history: [{ status: 'New', at: fields.createdAt }] };
      tickets.set(id, t);
      appendFileSync(file, JSON.stringify({ type: 'created', ticket: t }) + '\n');
      return t;
    },
    update(id, patch) {
      const t = tickets.get(id);
      if (!t) return null;
      if (patch.status && patch.status !== t.status) patch.history = [...(t.history ?? []), { status: patch.status, at: new Date().toISOString() }];
      Object.assign(t, patch);
      appendFileSync(file, JSON.stringify({ type: 'update', id, patch }) + '\n');
      return t;
    },
    /** Saves the image and returns its file name; the store keeps names, not paths, so the folder can move. */
    saveScreenshot(id, ext, bytes) {
      const name = `${id}.${ext}`;
      writeFileSync(join(dir, 'screenshots', name), bytes);
      return name;
    },
    screenshotPath: (t) => (t?.screenshotFile ? join(dir, 'screenshots', t.screenshotFile) : null),
  };
}
