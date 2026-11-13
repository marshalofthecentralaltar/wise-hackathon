// Step 3. Monitoring and logs for one page: Prometheus (5xx rate, firing alerts, p95) and the
// card app's request log for the last hour. Finding nothing is the normal result.
import { readFile } from 'node:fs/promises';
import { config, PAGE_PATHS } from '../config.js';
import type { MonitoringFinding, Page } from '../types.js';

export interface MonitoringOptions {
  prometheusUrl?: string;
  appBaseUrl?: string;
  logFile?: string;
  now?: Date;
  /** How long Prometheus gets to answer all three questions before the /metrics fallback. */
  prometheusTimeoutMs?: number;
  metricsTimeoutMs?: number;
}

const HOUR_MS = 3_600_000;

/** The contract's query: `sum(rate(http_requests_total{path="/card",status=~"5.."}[1h]))`. */
export function errorRateQuery(path: string | null): string {
  return path === null
    ? 'sum(rate(http_requests_total{status=~"5.."}[1h]))'
    : `sum(rate(http_requests_total{path="${path}",status=~"5.."}[1h]))`;
}

/** The count behind the rate: `sum(increase(http_requests_total{path="/card",status=~"5.."}[1h]))`. */
export function errorCountQuery(path: string | null): string {
  return errorRateQuery(path).replace('sum(rate(', 'sum(increase(');
}

export function p95Query(path: string | null): string {
  const selector = path === null ? '' : `{path="${path}"}`;
  return `histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket${selector}[1h])))`;
}

/**
 * Whether Prometheus read the app at its last try. The job name is the one in monitoring/prometheus.template.yml.
 * Without this, an app that is down gives empty answers to the three queries above, and empty reads as "no errors".
 */
export function upQuery(): string {
  return 'max(up{job="card-app"})';
}

/** Prometheus answered, but it holds no fresh reading of the app: its "no errors" would mean nothing. */
class NoReadingError extends Error {}

async function getJson(url: string, signal: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.json();
}

interface PromVector {
  status?: string;
  data?: { result?: { metric?: Record<string, string>; value?: [number, string] }[] };
}

function scalarOf(answer: unknown): number | null {
  const a = answer as PromVector;
  if (a?.status !== 'success') throw new Error('Prometheus query did not succeed');
  const v = a.data?.result?.[0]?.value?.[1];
  if (v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

interface PromAlert {
  labels?: Record<string, string>;
  state?: string;
}

/** Firing alerts that concern the page: labelled with its path or page, or labelled with neither (app-wide). */
export function firingAlertsFor(answer: unknown, page: Page | null): string[] {
  const a = answer as { status?: string; data?: { alerts?: PromAlert[] } };
  if (a?.status !== 'success') throw new Error('Prometheus alerts did not succeed');
  const path = page ? PAGE_PATHS[page] : null;
  const names = (a.data?.alerts ?? [])
    .filter((al) => al.state === 'firing')
    .filter((al) => {
      const l = al.labels ?? {};
      if (page === null) return true;
      if (l.path === undefined && l.page === undefined) return true;
      return l.path === path || l.page === page;
    })
    .map((al) => al.labels?.alertname ?? 'unnamed alert');
  return [...new Set(names)];
}

/** Sums a counter's samples in Prometheus text format whose labels pass the filter. */
export function sumCounter(metricsText: string, name: string, keep: (labels: Record<string, string>) => boolean): number {
  let total = 0;
  for (const line of metricsText.split(/\r?\n/)) {
    if (!line.startsWith(name)) continue;
    const m = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{(.*)\})?\s+(\S+)/.exec(line);
    if (!m || m[1] !== name) continue;
    const labels: Record<string, string> = {};
    for (const lm of (m[2] ?? '').matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g)) labels[lm[1]!] = lm[2]!;
    const value = Number(m[3]);
    if (Number.isFinite(value) && keep(labels)) total += value;
  }
  return total;
}

export interface LogCounts {
  found: boolean;
  lines: number;
  errors: number;
  warnings: number;
}

/** Counts the last hour's request-log lines for the path, by level. A missing file is 0 lines. */
export async function countLogLines(file: string, path: string | null, now: Date): Promise<LogCounts> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    return { found: false, lines: 0, errors: 0, warnings: 0 };
  }
  const from = now.getTime() - HOUR_MS;
  const to = now.getTime() + 60_000; // clock skew between the app and the tool
  const counts: LogCounts = { found: true, lines: 0, errors: 0, warnings: 0 };
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    let line: { time?: string; level?: string; path?: string };
    try {
      line = JSON.parse(raw);
    } catch {
      continue;
    }
    const t = Date.parse(line.time ?? '');
    if (!(t >= from && t <= to)) continue;
    if (path !== null && line.path !== path) continue;
    counts.lines++;
    if (line.level === 'error') counts.errors++;
    else if (line.level === 'warn') counts.warnings++;
  }
  return counts;
}

const fmt = (n: number) => (n === 0 ? '0' : n >= 0.01 ? String(Math.round(n * 100) / 100) : n.toPrecision(2));
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

export async function checkMonitoring(page: Page | null, opts: MonitoringOptions = {}): Promise<MonitoringFinding> {
  const prometheusUrl = (opts.prometheusUrl ?? config.prometheusUrl).replace(/\/$/, '');
  const appBaseUrl = (opts.appBaseUrl ?? config.appBaseUrl).replace(/\/$/, '');
  const logFile = opts.logFile ?? config.requestLogFile;
  const now = opts.now ?? new Date();
  const path = page ? PAGE_PATHS[page] : null;
  const where = path ?? 'any page';

  const logsPromise = countLogLines(logFile, path, now);

  let source: MonitoringFinding['source'] = 'prometheus';
  let errorsPerSecond = 0;
  let alertsFiring: string[] = [];
  let p95Seconds: number | null = null;
  let monitoringSentence: string;
  let monitoringProblem = false;
  let errorCount5xx: number | undefined;
  let unavailable = false;

  try {
    const signal = AbortSignal.timeout(opts.prometheusTimeoutMs ?? 3_000);
    const q = (query: string) => getJson(`${prometheusUrl}/api/v1/query?query=${encodeURIComponent(query)}`, signal);
    const [rate, increase, p95, alerts, up] = await Promise.all([
      q(errorRateQuery(path)),
      q(errorCountQuery(path)),
      q(p95Query(path)),
      getJson(`${prometheusUrl}/api/v1/alerts`, signal),
      q(upQuery()),
    ]);
    if (scalarOf(up) !== 1) throw new NoReadingError();
    errorsPerSecond = scalarOf(rate) ?? 0;
    errorCount5xx = Math.round(scalarOf(increase) ?? 0);
    p95Seconds = scalarOf(p95);
    alertsFiring = firingAlertsFor(alerts, page);
    monitoringProblem = errorsPerSecond > 0 || errorCount5xx > 0 || alertsFiring.length > 0;
    const parts = [
      errorsPerSecond > 0 || errorCount5xx > 0
        ? `about ${plural(errorCount5xx, 'response')} with status 5xx on ${where} in the last hour (${fmt(errorsPerSecond)} per second)`
        : `no responses with status 5xx on ${where} in the last hour`,
      alertsFiring.length ? `firing alerts: ${alertsFiring.join(', ')}` : 'no firing alert',
      p95Seconds === null ? 'no response-time data' : `95th percentile response time ${fmt(p95Seconds)} s`,
    ];
    monitoringSentence = `Prometheus shows ${parts.join(', ')}.`;
  } catch (promErr) {
    source = 'metrics-endpoint';
    const why = promErr instanceof NoReadingError
      ? 'has no fresh reading of the app'
      : promErr instanceof Error && promErr.name === 'TimeoutError' ? 'did not answer within 3 seconds' : 'did not answer';
    try {
      const signal = AbortSignal.timeout(opts.metricsTimeoutMs ?? 3_000);
      const res = await fetch(`${appBaseUrl}/metrics`, { signal });
      if (!res.ok) throw new Error(`/metrics answered ${res.status}`);
      const text = await res.text();
      const count = sumCounter(text, 'http_requests_total', (l) => (path === null || l.path === path) && /^5\d\d$/.test(l.status ?? ''));
      // One read of a counter gives a count since the app started, not a rate: errorsPerSecond stays 0.
      errorCount5xx = count;
      monitoringProblem = count > 0;
      monitoringSentence = count > 0
        ? `Prometheus ${why}; the app's own /metrics counts ${plural(count, 'response')} with status 5xx on ${where} since the app started.`
        : `Prometheus ${why}; the app's own /metrics counts no responses with status 5xx on ${where} since the app started.`;
    } catch {
      unavailable = true;
      monitoringSentence = `Prometheus ${why} and the app's /metrics could not be read, so the page's health is unknown.`;
    }
  }

  const logs = await logsPromise;
  const logProblem = logs.errors > 0;
  const logSentence = !logs.found
    ? 'The request log was not found, so 0 lines were read.'
    : logs.lines === 0
      ? `The request log has no lines for ${where} in the last hour.`
      : logs.errors + logs.warnings === 0
        ? `The request log has ${plural(logs.lines, 'line')} for ${where} in the last hour, none at warn or error level.`
        : `The request log has ${plural(logs.lines, 'line')} for ${where} in the last hour: ${plural(logs.errors, 'error')} and ${plural(logs.warnings, 'warning')}.`;

  const showsProblem = monitoringProblem || logProblem;
  const lead = unavailable ? 'Monitoring could not be read. ' : showsProblem ? '' : 'Nothing found. ';
  const summary = `${lead}${monitoringSentence} ${logSentence}`;
  return {
    source,
    errorsPerSecond,
    ...(errorCount5xx === undefined ? {} : { errorCount5xx }),
    ...(unavailable ? { unavailable } : {}),
    alertsFiring,
    p95Seconds,
    logLinesRead: logs.lines,
    logErrors: logs.errors,
    logWarnings: logs.warnings,
    showsProblem,
    summary,
  };
}
