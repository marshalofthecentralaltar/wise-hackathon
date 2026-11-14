// The two GitHub read helpers (githubRestApi in changes.ts, ghApi in exec.ts) try a GET again
// when the network or GitHub's servers fail. On 14 Nov 2026 three runs of about forty each died
// on one dropped connection during a read. Nothing that writes (push, pull request, merge, ref
// update) goes through here. When every attempt fails, the caller throws exactly what it threw
// before for that last failure.

/** At most this many requests per GET. */
export const GITHUB_ATTEMPTS = 3;
/** The pause before the second and before the third attempt. */
export const GITHUB_RETRY_PAUSES_MS: readonly number[] = [300, 1_000];

export type Sleep = (ms: number) => Promise<void>;
export const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export type RetryLog = (line: string) => void;
export const consoleRetryLog: RetryLog = (line) => console.error(line);

/** One attempt's outcome: a value, or the error to throw if no attempt follows. */
export type Attempt<T> = { ok: true; value: T } | { ok: false; error: unknown; retry: boolean; reason: string };

/** Removes the token from a text that is about to be logged or thrown. */
export function redact(text: string, secret: string | null | undefined): string {
  return secret ? text.split(secret).join('[token]') : text;
}

/**
 * Runs attempt() up to GITHUB_ATTEMPTS times. An attempt that fails with retry: false, or the
 * last attempt, throws its own error unchanged. Each retry logs one line and pauses first.
 */
export async function withGithubRetry<T>(
  path: string,
  attempt: () => Promise<Attempt<T>>,
  deps: { sleep: Sleep; log: RetryLog; secret?: string | null },
): Promise<T> {
  for (let n = 1; ; n++) {
    const r = await attempt();
    if (r.ok) return r.value;
    if (!r.retry || n >= GITHUB_ATTEMPTS) throw r.error;
    const reason = redact(r.reason.replace(/\s+/g, ' ').trim(), deps.secret).slice(0, 160);
    deps.log(`[github] GET ${path} failed (attempt ${n} of ${GITHUB_ATTEMPTS}): ${reason}; trying again`);
    await deps.sleep(GITHUB_RETRY_PAUSES_MS[n - 1] ?? 1_000);
  }
}

/** HTTP statuses of GitHub's REST API that are tried again: rate limit and server failures. */
export const RETRY_HTTP_STATUSES: ReadonlySet<number> = new Set([429, 500, 502, 503, 504]);

// gh's own answers that mean "asked and refused": never tried again.
const GH_REFUSED = /Not Found|HTTP 4(?!29)\d\d\b/i;
// Network and server failures as gh (Go's net/http) words them.
const GH_TRANSIENT =
  /dial tcp|connectex|connection reset|connection refused|broken pipe|i\/o timeout|timed out|timeout awaiting|TLS handshake|\bEOF\b|no such host|network is unreachable|temporary failure in name resolution|HTTP 5\d\d\b|HTTP 429\b|Bad Gateway|Service Unavailable|Gateway Timeout|Internal Server Error/i;

/** True when a failed `gh api` looks like a network or server failure, not an answer. */
export function ghFailureIsTransient(text: string, timedOut: boolean): boolean {
  if (GH_REFUSED.test(text)) return false;
  return timedOut || GH_TRANSIENT.test(text);
}
