// Opens /card, keeps a handle to the #card-picture node, watches it for 5 seconds.
// Prints {"card_picture_replaced":bool,"balance_changed":bool,"min_opacity_seen":n}
// --expect replaced : pass when the node was replaced, the balance changed and opacity dipped below 0.5
// --expect stable   : pass when the node was never replaced (and the picture stayed visible)
// no --expect       : pass when the node was never replaced
import { BASE_URL, expectArg, finish, launch } from "./lib.mjs";

const expect = expectArg(["replaced", "stable"]);
const WATCH_MS = Number(process.env.WATCH_MS ?? 5000);

const browser = await launch();
let result;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(String(error)));

  await page.goto(`${BASE_URL}/card`, { waitUntil: "networkidle" });
  await page.waitForSelector("#card-picture");
  // Let the balance load and the mount animation finish before watching.
  await page.waitForFunction(() => document.getElementById("balance")?.textContent?.includes("EUR"));
  // Wait for the first-load fade-in to end (opacity back at 1) before watching, up to 3 s.
  // A fixed 800 ms was sometimes too short and failed a correct fix at opacity 0.965 (13 Nov).
  await page
    .waitForFunction(() => Number(getComputedStyle(document.getElementById("card-picture")).opacity) >= 0.99, null, { timeout: 3000 })
    .catch(() => undefined);
  await page.waitForTimeout(300);

  const original = await page.$("#card-picture");
  const samples = await page.evaluate(
    ({ original, watchMs }) =>
      new Promise((resolve) => {
        const balanceAtStart = document.getElementById("balance")?.textContent ?? "";
        let replaced = false;
        let balanceChanged = false;
        let minOpacity = 1;
        let count = 0;
        const timer = setInterval(() => {
          const current = document.getElementById("card-picture");
          if (current !== original || !original.isConnected) replaced = true;
          if (current) minOpacity = Math.min(minOpacity, Number(getComputedStyle(current).opacity));
          const balanceNow = document.getElementById("balance")?.textContent ?? "";
          if (balanceNow !== balanceAtStart) balanceChanged = true;
          count += 1;
        }, 100);
        setTimeout(() => {
          clearInterval(timer);
          resolve({ replaced, balanceChanged, minOpacity, count });
        }, watchMs);
      }),
    { original, watchMs: WATCH_MS },
  );

  result = {
    card_picture_replaced: samples.replaced,
    balance_changed: samples.balanceChanged,
    min_opacity_seen: Math.round(samples.minOpacity * 1000) / 1000,
    samples: samples.count,
    console_errors: consoleErrors.length,
  };
} catch (error) {
  await browser.close();
  finish({ error: String(error) }, false);
}
await browser.close();

let pass;
if (expect === "replaced") {
  pass = result.card_picture_replaced && result.balance_changed && result.min_opacity_seen < 0.5;
} else if (expect === "stable") {
  pass = !result.card_picture_replaced && result.min_opacity_seen >= 0.99;
} else {
  pass = !result.card_picture_replaced;
}
finish(result, pass);
