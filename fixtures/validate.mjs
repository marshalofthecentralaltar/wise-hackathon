// Validates fixtures/reports.json against the rules in issue #3.
// Node 22, no dependencies. Run: node fixtures/validate.mjs
// Prints "OK 60 messages" and exits 0 when every check passes.
// Otherwise prints one "FAIL <id or file>: <reason>" line per failure and exits 1.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const dataPath = join(here, "reports.json");

const failures = [];
const fail = (who, reason) => failures.push(`FAIL ${who}: ${reason}`);

// The fixed shape of each problem: the page and severity its table row gives.
const PROBLEM_SPEC = {
  "card-picture-flicker": { page: "card", severity: "low" },
  "transfers-amount-wrong": { page: "transfers", severity: "high" },
  "card-payment-declined": { page: "card", severity: "high" },
  "account-name-cut-off": { page: "account", severity: "low" },
  "other-login-code-late": { page: null, severity: null },
  "other-statement-download": { page: "account", severity: null },
  "other-card-pin-reveal": { page: "card", severity: null },
  "other-transfers-search": { page: "transfers", severity: null },
  "other-app-language": { page: null, severity: null },
  "other-address-save": { page: "account", severity: null },
};

const EXPECTED_COUNTS = {
  "card-picture-flicker": 20,
  "transfers-amount-wrong": 8,
  "card-payment-declined": 6,
  "account-name-cut-off": 6,
  "other-login-code-late": 1,
  "other-statement-download": 1,
  "other-card-pin-reveal": 1,
  "other-transfers-search": 1,
  "other-app-language": 1,
  "other-address-save": 1,
};

// Expected language mix per problem (and for chatter, keyed by "chatter").
const EXPECTED_LANGS = {
  "card-picture-flicker": { en: 14, et: 4, ru: 2 },
  "transfers-amount-wrong": { en: 6, et: 2 },
  "card-payment-declined": { en: 6 },
  "account-name-cut-off": { en: 6 },
  "other-login-code-late": { en: 1 },
  "other-statement-download": { en: 1 },
  "other-card-pin-reveal": { en: 1 },
  "other-transfers-search": { en: 1 },
  "other-app-language": { en: 1 },
  "other-address-save": { en: 1 },
  chatter: { en: 10, et: 3, ru: 1 },
};

const KEYS = ["id", "text", "lang", "is_report", "page", "problem", "severity"];
const LANGS = ["en", "et", "ru"];
const PAGES = ["card", "transfers", "account", null];
const SEVERITIES = ["low", "high", null];

const wordCount = (t) => t.trim().split(/\s+/).length;
const normText = (t) => t.toLowerCase().replace(/\s+/g, " ").trim();

let data;

// Check 1: the file parses as JSON and is an array of exactly 60 objects.
try {
  data = JSON.parse(readFileSync(dataPath, "utf8"));
} catch (e) {
  fail("file", `reports.json does not parse as JSON: ${e.message}`);
}
const isArray = Array.isArray(data);
if (!isArray) {
  if (data !== undefined) fail("file", "reports.json is not a JSON array");
} else {
  if (data.length !== 60) fail("file", `expected 60 objects, found ${data.length}`);
  data.forEach((o, i) => {
    if (o === null || typeof o !== "object" || Array.isArray(o)) {
      fail(`index ${i}`, "is not an object");
    }
  });
}

// Only run the per-object checks on the objects. Each keeps its index in the file,
// so one bad entry does not shift the ids reported for the entries after it.
const isObj = (o) => o !== null && typeof o === "object" && !Array.isArray(o);
const rows = isArray ? data.flatMap((o, i) => (isObj(o) ? [[o, i]] : [])) : [];
const who = (o, i) => (typeof o.id === "string" ? o.id : `index ${i}`);

// Check 2: each object has exactly the seven keys, none extra, none missing.
rows.forEach(([o, i]) => {
  const keys = Object.keys(o);
  const extra = keys.filter((k) => !KEYS.includes(k));
  const missing = KEYS.filter((k) => !keys.includes(k));
  if (extra.length) fail(who(o, i), `extra keys: ${extra.join(", ")}`);
  if (missing.length) fail(who(o, i), `missing keys: ${missing.join(", ")}`);
});

// Check 3: ids are r01 to r60, each once, in order.
rows.forEach(([o, i]) => {
  const expected = `r${String(i + 1).padStart(2, "0")}`;
  if (o.id !== expected) fail(who(o, i), `id should be ${expected}, found ${JSON.stringify(o.id)}`);
});

// Check 4: lang, page and severity hold only allowed values; is_report is a boolean; text is a string.
rows.forEach(([o, i]) => {
  if (!LANGS.includes(o.lang)) fail(who(o, i), `lang not allowed: ${JSON.stringify(o.lang)}`);
  if (!PAGES.includes(o.page)) fail(who(o, i), `page not allowed: ${JSON.stringify(o.page)}`);
  if (!SEVERITIES.includes(o.severity)) fail(who(o, i), `severity not allowed: ${JSON.stringify(o.severity)}`);
  if (typeof o.is_report !== "boolean") fail(who(o, i), `is_report is not a boolean: ${JSON.stringify(o.is_report)}`);
  if (typeof o.text !== "string") fail(who(o, i), `text is not a string`);
});

// Check 5: when is_report is false, page, problem and severity are all null.
rows.forEach(([o, i]) => {
  if (o.is_report === false) {
    if (o.page !== null) fail(who(o, i), "is_report false but page is not null");
    if (o.problem !== null) fail(who(o, i), "is_report false but problem is not null");
    if (o.severity !== null) fail(who(o, i), "is_report false but severity is not null");
  }
});

// Check 6: when is_report is true, problem is not null.
rows.forEach(([o, i]) => {
  if (o.is_report === true && o.problem === null) fail(who(o, i), "is_report true but problem is null");
});

// Check 7: each problem has the page and severity its table row gives.
rows.forEach(([o, i]) => {
  if (o.problem === null) return;
  const spec = Object.hasOwn(PROBLEM_SPEC, o.problem) ? PROBLEM_SPEC[o.problem] : null;
  if (!spec) {
    fail(who(o, i), `unknown problem slug: ${JSON.stringify(o.problem)}`);
    return;
  }
  if (o.page !== spec.page) fail(who(o, i), `problem ${o.problem} should have page ${JSON.stringify(spec.page)}, found ${JSON.stringify(o.page)}`);
  if (o.severity !== spec.severity) fail(who(o, i), `problem ${o.problem} should have severity ${JSON.stringify(spec.severity)}, found ${JSON.stringify(o.severity)}`);
});

// Check 8: the count of each group.
{
  const counts = {};
  let chatter = 0;
  rows.forEach(([o]) => {
    if (o.is_report === false) chatter++;
    else if (typeof o.problem === "string") counts[o.problem] = (counts[o.problem] || 0) + 1;
  });
  for (const [slug, want] of Object.entries(EXPECTED_COUNTS)) {
    const got = counts[slug] || 0;
    if (got !== want) fail("file", `group ${slug}: expected ${want}, found ${got}`);
  }
  if (chatter !== 14) fail("file", `chatter (is_report false): expected 14, found ${chatter}`);
}

// Check 9: languages per group.
{
  const byGroup = {};
  rows.forEach(([o]) => {
    const key = o.is_report === false ? "chatter" : o.problem;
    if (key === null || key === undefined) return;
    byGroup[key] = byGroup[key] || {};
    byGroup[key][o.lang] = (byGroup[key][o.lang] || 0) + 1;
  });
  for (const [group, want] of Object.entries(EXPECTED_LANGS)) {
    const got = byGroup[group] || {};
    for (const lang of LANGS) {
      const wantN = want[lang] || 0;
      const gotN = got[lang] || 0;
      if (wantN !== gotN) fail("file", `group ${group} language ${lang}: expected ${wantN}, found ${gotN}`);
    }
  }
}

// Check 10: no duplicate text, compared lower case with runs of spaces collapsed.
{
  const seen = new Map();
  rows.forEach(([o, i]) => {
    if (typeof o.text !== "string") return;
    const key = normText(o.text);
    if (seen.has(key)) fail(who(o, i), `duplicate text (matches ${seen.get(key)})`);
    else seen.set(key, who(o, i));
  });
}

// Check 11: each text has 6 to 40 words.
rows.forEach(([o, i]) => {
  if (typeof o.text !== "string") return;
  const n = wordCount(o.text);
  if (n < 6 || n > 40) fail(who(o, i), `text has ${n} words, must be 6 to 40`);
});

// Check 12: of the 14 English flicker messages, at least 6 do not contain "flicker".
{
  const enFlicker = rows.map(([o]) => o).filter((o) => o.problem === "card-picture-flicker" && o.lang === "en" && typeof o.text === "string");
  const withoutFlicker = enFlicker.filter((o) => !o.text.toLowerCase().includes("flicker")).length;
  if (withoutFlicker < 6) fail("file", `English flicker messages without the word "flicker": expected at least 6, found ${withoutFlicker}`);
}

// Check 13: at least 3 declined-payment messages contain "card".
{
  const declined = rows.map(([o]) => o).filter((o) => o.problem === "card-payment-declined" && typeof o.text === "string");
  const withCard = declined.filter((o) => o.text.toLowerCase().includes("card")).length;
  if (withCard < 3) fail("file", `declined-payment messages containing "card": expected at least 3, found ${withCard}`);
}

// Check 14: at least 4 chatter messages contain card, transfer or account.
{
  const chatter = rows.map(([o]) => o).filter((o) => o.is_report === false && typeof o.text === "string");
  const withWord = chatter.filter((o) => /card|transfer|account/i.test(o.text)).length;
  if (withWord < 4) fail("file", `chatter messages containing card/transfer/account: expected at least 4, found ${withWord}`);
}

// Check 15: no text contains "wise", an "@", or 12 or more digits in a row.
rows.forEach(([o, i]) => {
  if (typeof o.text !== "string") return;
  if (o.text.toLowerCase().includes("wise")) fail(who(o, i), 'text contains "wise"');
  if (o.text.includes("@")) fail(who(o, i), 'text contains "@"');
  if (/\d{12,}/.test(o.text)) fail(who(o, i), "text contains 12 or more digits in a row");
});

// Check 16: no 4 objects in a row have the same problem value (null counts as a value).
const run = isArray ? data : [];
for (let i = 3; i < run.length; i++) {
  const four = run.slice(i - 3, i + 1);
  if (!four.every(isObj)) continue;
  const p = four[3].problem;
  if (four.every((o) => o.problem === p)) {
    fail(who(four[3], i), `four in a row share problem ${JSON.stringify(p)} (ids ${four[0].id}..${four[3].id})`);
  }
}

if (failures.length === 0) {
  console.log("OK 60 messages");
  process.exit(0);
} else {
  for (const line of failures) console.log(line);
  process.exit(1);
}
