// Reads /api/transfers, opens /transfers, compares each row's shown amount with the stored cents.
// Prints {"rows":6,"rows_differ":n,"differ":[{row,id,stored_cents,shown,shown_cents}]}
// --expect wrong : pass when 1 or 2 rows differ
// --expect right : pass when no row differs
// no --expect    : pass when no row differs
import { BASE_URL, expectArg, finish, launch } from "./lib.mjs";

const expect = expectArg(["wrong", "right"]);

/** "2,040.00 EUR" -> 204000. Commas are thousands separators, the dot marks cents. */
function parseShownCents(text) {
  const match = text.replace(/ /g, " ").match(/-?[\d,]+(?:\.\d+)?/);
  if (!match) return null;
  const value = Number(match[0].replace(/,/g, ""));
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}

let result;
const browser = await launch();
try {
  const response = await fetch(`${BASE_URL}/api/transfers`);
  if (!response.ok) throw new Error(`/api/transfers answered ${response.status}`);
  const { transfers } = await response.json();

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${BASE_URL}/transfers`, { waitUntil: "networkidle" });
  await page.waitForFunction(
    (count) => document.querySelectorAll("#transfers-table tbody tr td:nth-child(3)").length >= count,
    transfers.length,
  );

  // The amount column is the third cell; its first line is the amount, a second line may show the fee.
  const shown = await page.$$eval("#transfers-table tbody tr", (rows) =>
    rows.map((row) => {
      const cell = row.querySelector("td:nth-child(3)");
      const first = cell?.firstElementChild ?? cell;
      return (first?.textContent ?? "").trim();
    }),
  );

  const differ = [];
  transfers.forEach((transfer, index) => {
    const text = shown[index] ?? "";
    const shownCents = parseShownCents(text);
    if (shownCents !== transfer.amount_cents) {
      differ.push({ row: index + 1, id: transfer.id, stored_cents: transfer.amount_cents, shown: text, shown_cents: shownCents });
    }
  });
  if (shown.length !== transfers.length) {
    differ.push({ row: null, note: `table shows ${shown.length} rows, API returns ${transfers.length}` });
  }
  result = { rows: shown.length, rows_differ: differ.length, differ };
} catch (error) {
  await browser.close();
  finish({ error: String(error) }, false);
}
await browser.close();

const pass = expect === "wrong" ? result.rows_differ >= 1 && result.rows_differ <= 2 : result.rows_differ === 0;
finish(result, pass);
