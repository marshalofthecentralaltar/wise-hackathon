// The deterministic parts of the PII filter: layer 1 (rules) and layer 3 (leak gate), and the
// code that applies the removals the Claude check (layer 2) asks for. Nothing here calls out.
// Every function only removes text; none adds anything but a [marker].

export const MARKERS = {
  name: '[name]',
  email: '[email]',
  phone: '[phone]',
  customerNumber: '[customer number]',
  card: '[card number]',
  iban: '[account number]',
  dob: '[date of birth]',
  address: '[address]',
  other: '[personal data]',
};

const L = '\\p{L}\\p{N}';
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordRe = (s) => new RegExp(`(?<![${L}])${escapeRe(s)}(?![${L}])`, 'giu');
const digitsOnly = (s) => s.replace(/\D/g, '');

/** The values the customer typed into the personal fields, as strings to look for. */
export function fieldValues(fields = {}) {
  const out = [];
  const name = (fields.name ?? '').trim();
  if (name) {
    out.push({ kind: 'name', value: name });
    for (const part of name.split(/\s+/)) if ([...part].length >= 3 && part !== name) out.push({ kind: 'name', value: part });
  }
  for (const [key, kind] of [['email', 'email'], ['phone', 'phone'], ['customerNumber', 'customerNumber']]) {
    const v = (fields[key] ?? '').trim();
    if (v) out.push({ kind, value: v });
  }
  return out;
}

// ---- detectors: each returns [{start, end, kind}] over the text --------------------------------

function luhn(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return digits.length >= 13 && sum % 10 === 0;
}

export function ibanValid(raw) {
  const s = raw.replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  const moved = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const v = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const d of v) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1;
}

function findAll(re, text, kind, accept = () => true) {
  const hits = [];
  for (const m of text.matchAll(re)) {
    const start = m.index;
    if (accept(m[0], start, text)) hits.push({ start, end: start + m[0].length, kind });
  }
  return hits;
}

function detectFieldValues(text, fields) {
  const hits = [];
  for (const { kind, value } of fieldValues(fields)) {
    const re = kind === 'name' ? wordRe(value) : new RegExp(escapeRe(value), 'giu');
    hits.push(...findAll(re, text, kind));
    if (kind === 'phone' && digitsOnly(value).length >= 7) {
      // The same phone written with other spacing: compare the digits.
      const want = digitsOnly(value);
      const tail = want.slice(-7);
      for (const m of text.matchAll(/\+?\d(?:[ -]?\d){6,14}/g)) {
        const d = digitsOnly(m[0]);
        if (d === want || d.endsWith(tail)) hits.push({ start: m.index, end: m.index + m[0].length, kind });
      }
    }
  }
  return hits;
}

function detectIbans(text) {
  const hits = [];
  for (const m of text.matchAll(/(?<![A-Za-z0-9])[A-Z]{2}\d{2}/g)) {
    // Take up to 34 letters or digits with single spaces, then shrink from the right until valid.
    const rest = text.slice(m.index);
    const run = /^[A-Z]{2}\d{2}(?: ?[A-Z0-9]){0,30}/.exec(rest)?.[0] ?? '';
    for (let len = run.length; len >= 15; len--) {
      const cand = run.slice(0, len);
      if (cand.endsWith(' ')) continue;
      const after = rest[len] ?? '';
      if (/[A-Za-z0-9]/.test(after)) continue;
      if (ibanValid(cand)) {
        hits.push({ start: m.index, end: m.index + len, kind: 'iban' });
        break;
      }
    }
  }
  return hits;
}

const CURRENCY = /^(?:\s?(?:eur|euro|eurot|euros|€|usd|\$|gbp|£|евро|руб))/i;
const CURRENCY_BEFORE = /(?:eur|€|\$|£|usd|gbp)\s?$/i;
const DATE_LIKE = /^\d{1,4}[-]\d{1,2}[-]\d{1,4}$/;

function detectPhones(text) {
  const hits = [];
  for (const m of text.matchAll(/\+\d(?:[ -]?\d){6,14}(?!\d)/g)) hits.push({ start: m.index, end: m.index + m[0].length, kind: 'phone' });
  for (const m of text.matchAll(/(?<![\d+.,A-Za-z-])\d(?:[ -]?\d){6,}(?!\d)/g)) {
    const end = m.index + m[0].length;
    const after = text.slice(end);
    const before = text.slice(Math.max(0, m.index - 5), m.index);
    if (/^[.,]\d/.test(after)) continue; // an amount such as 1200000.00
    if (CURRENCY.test(after) || CURRENCY_BEFORE.test(before)) continue;
    if (DATE_LIKE.test(m[0])) continue; // 2026-11-14
    if (digitsOnly(m[0]).length > 15) continue; // too long for a phone; cards are handled apart
    hits.push({ start: m.index, end, kind: 'phone' });
  }
  return hits;
}

const DOB_WORDS = String.raw`born(?:\s+on)?|birthday|date\s+of\s+birth|d\.?o\.?b\.?|sünnipäev|sündinud|sünniaeg|дата\s+рождения|родил(?:ся|ась)|д\.р\.`;
const DATE = String.raw`\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2}`;

function detectDob(text) {
  const hits = [];
  const re = new RegExp(`(?:${DOB_WORDS})[^\\d\\n]{0,15}(${DATE})`, 'giu');
  for (const m of text.matchAll(re)) {
    const start = m.index + m[0].lastIndexOf(m[1]);
    hits.push({ start, end: start + m[1].length, kind: 'dob' });
  }
  return hits;
}

const ADDRESS_RES = [
  // Tamme tänav 12, Pärnu mnt 5a, Narva mnt. 7-3, Main Street 4
  new RegExp(String.raw`(?<![\p{L}])\p{Lu}[\p{L}-]+\s+(?:street|st\.|road|rd\.|avenue|ave\.|lane|tänav|tn\.?|mnt\.?|maantee|pst\.?|puiestee)\s*\d+[a-zA-Z]?(?:[-/]\d+)?`, 'gu'),
  // 12 Baker Street
  new RegExp(String.raw`(?<![\p{L}\d])\d+[a-zA-Z]?\s+\p{Lu}[\p{L}-]+\s+(?:Street|Road|Avenue|Lane)\b`, 'gu'),
  // ул. Ленина 5, улица Мира, д. 7
  new RegExp(String.raw`(?:улица|ул\.)\s*\p{L}[\p{L}-]*,?\s*(?:д\.\s*)?\d+[а-яa-z]?(?:[-/]\d+)?`, 'giu'),
];

function detectAddresses(text) {
  return ADDRESS_RES.flatMap((re) => findAll(re, text, 'address'));
}

const detectEmails = (text) => findAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, text, 'email');
const detectCustomerNumbers = (text) => findAll(/(?<![A-Za-z0-9])DB-\d{6}(?!\d)/gi, text, 'customerNumber');
const detectCards = (text) => findAll(/(?<![\d])\d(?:[ -]?\d){12,18}(?!\d)/g, text, 'card', (s) => luhn(digitsOnly(s)));

/** Every PII span in the text, longest first where they overlap. Markers already in the text are never matched. */
export function detectPii(text, fields = {}) {
  const raw = [
    ...detectFieldValues(text, fields),
    ...detectEmails(text),
    ...detectIbans(text),
    ...detectCards(text),
    ...detectCustomerNumbers(text),
    ...detectDob(text),
    ...detectAddresses(text),
    ...detectPhones(text),
  ];
  const markers = [...text.matchAll(/\[[a-z ]+\]/g)].map((m) => [m.index, m.index + m[0].length]);
  const inMarker = (h) => markers.some(([s, e]) => h.start < e && h.end > s);
  raw.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  const out = [];
  for (const h of raw) {
    if (h.end <= h.start || inMarker(h)) continue;
    const last = out[out.length - 1];
    if (last && h.start < last.end) {
      if (h.end > last.end) last.end = h.end; // merge overlaps into one removal
      continue;
    }
    out.push({ ...h });
  }
  return out;
}

function replaceSpans(text, spans, by) {
  const removed = [];
  let out = '';
  let at = 0;
  for (const s of spans) {
    out += text.slice(at, s.start) + MARKERS[s.kind];
    removed.push({ kind: s.kind, value: text.slice(s.start, s.end), by });
    at = s.end;
  }
  return { text: out + text.slice(at), removed };
}

/** Layer 1: replaces every PII span the rules find. */
export function applyRules(text, fields = {}) {
  return replaceSpans(text, detectPii(text, fields), 'rule');
}

const CLAUDE_KINDS = { name: 'name', address: 'address', other: 'other' };

/**
 * Layer 2, applied by code: each item's text must be an exact substring of the text, at least 2
 * characters, and not a marker; anything else is ignored and reported as ignored.
 */
export function applyRemovals(text, items) {
  const removed = [];
  const ignored = [];
  let out = text;
  for (const item of Array.isArray(items) ? items : []) {
    const value = typeof item?.text === 'string' ? item.text : '';
    const kind = CLAUDE_KINDS[item?.kind] ?? 'other';
    if (value.trim().length < 2 || !out.includes(value) || /^\[[a-z ]+\]$/.test(value.trim()) || Object.values(MARKERS).some((m) => m.includes(value))) {
      ignored.push(value);
      continue;
    }
    out = out.split(value).join(MARKERS[kind]);
    removed.push({ kind, value, by: 'claude' });
  }
  return { text: out, removed, ignored };
}

/** Layer 3: what still looks personal in the outgoing text. Empty means the text may go. */
export function leakCheck(text, fields = {}) {
  return detectPii(text, fields).map((h) => ({ kind: h.kind, value: text.slice(h.start, h.end) }));
}
