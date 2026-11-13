// Whether the browser checks can start a browser on this machine: the same launch() as
// check-flicker.mjs and check-amounts.mjs (installed Chrome, then Edge; BROWSER_CHANNEL picks one).
// Prints one line of JSON, exits 0 when a browser started and 1 when none did.
import { finish, launch } from "./lib.mjs";

try {
  const browser = await launch();
  const version = browser.version();
  await browser.close();
  finish({ browser: version }, true);
} catch (error) {
  finish({ error: String(error).split("\n")[0] }, false);
}
