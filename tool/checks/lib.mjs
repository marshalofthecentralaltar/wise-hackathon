import { chromium } from "playwright-core";

export const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");

/** Reads `--expect <value>` from argv; returns null when absent. */
export function expectArg(allowed) {
  const index = process.argv.indexOf("--expect");
  if (index === -1) return null;
  const value = process.argv[index + 1];
  if (!allowed.includes(value)) {
    console.log(JSON.stringify({ error: `--expect must be one of ${allowed.join(", ")}` }));
    process.exit(1);
  }
  return value;
}

/** Launches installed Chrome, falling back to Edge. No browser download. */
export async function launch() {
  const channel = process.env.BROWSER_CHANNEL;
  const channels = channel ? [channel] : ["chrome", "msedge"];
  let lastError;
  for (const name of channels) {
    try {
      return await chromium.launch({ channel: name, headless: true });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export function finish(result, pass) {
  console.log(JSON.stringify(result));
  process.exit(pass ? 0 : 1);
}
