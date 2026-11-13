// Step 3 against real HTTP servers: a stand-in card app on port 3300 serving /metrics in the
// contract's format, a stub of Prometheus's HTTP API, and a log file of contract-shaped lines.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkMonitoring, errorRateQuery } from '../src/steps/monitoring.js';

const NOW = new Date('2026-11-14T10:00:00.000Z');
const APP_PORT = 3300;
const dir = mkdtempSync(join(tmpdir(), 'monitoring-'));

function metricsText(card5xx: number): string {
  const lines = [
    '# HELP http_requests_total HTTP requests answered, by method, route and status code.',
    '# TYPE http_requests_total counter',
    'http_requests_total{method="GET",path="/card",status="200"} 42',
    'http_requests_total{method="GET",path="/api/balance",status="200"} 300',
    'http_requests_total{method="GET",path="/transfers",status="500"} 9', // another page's errors
  ];
  if (card5xx) lines.push(`http_requests_total{method="GET",path="/card",status="500"} ${card5xx - 1}`, 'http_requests_total{method="POST",path="/card",status="503"} 1');
  lines.push(
    '# TYPE http_request_duration_seconds histogram',
    'http_request_duration_seconds_bucket{le="0.005",method="GET",path="/card"} 40',
    'http_request_duration_seconds_bucket{le="+Inf",method="GET",path="/card"} 42',
    'http_request_duration_seconds_sum{method="GET",path="/card"} 0.3',
    'http_request_duration_seconds_count{method="GET",path="/card"} 42',
  );
  return lines.join('\n') + '\n';
}

function logFile(name: string, lines: { minutesAgo: number; level: string; path: string; status: number }[]): string {
  const file = join(dir, name);
  const text = lines
    .map((l) => JSON.stringify({ time: new Date(NOW.getTime() - l.minutesAgo * 60_000).toISOString(), level: l.level, method: 'GET', path: l.path, status: l.status, ms: 12 }))
    .join('\n');
  writeFileSync(file, text + '\n');
  return file;
}

const healthyLog = logFile('healthy.log', [
  { minutesAgo: 1, level: 'info', path: '/card', status: 200 },
  { minutesAgo: 5, level: 'info', path: '/card', status: 200 },
  { minutesAgo: 10, level: 'error', path: '/transfers', status: 500 }, // another page
  { minutesAgo: 90, level: 'error', path: '/card', status: 500 }, // older than an hour
]);
const failingLog = logFile('failing.log', [
  { minutesAgo: 1, level: 'error', path: '/card', status: 500 },
  { minutesAgo: 2, level: 'error', path: '/card', status: 500 },
  { minutesAgo: 3, level: 'warn', path: '/card', status: 404 },
  { minutesAgo: 4, level: 'info', path: '/card', status: 200 },
]);

let appMetrics = metricsText(0);
let app: Server;

interface PromStub {
  rate: string;
  count: string;
  p95: string;
  alerts: { labels: Record<string, string>; state: string }[];
  queries: string[];
}
const prom: PromStub = { rate: '0', count: '0', p95: 'NaN', alerts: [], queries: [] };
let promServer: Server;
let promUrl = '';
let hangingServer: Server;
let hangingUrl = '';
let closedUrl = '';

const listen = (s: Server, port = 0) => new Promise<string>((resolve) => s.listen(port, '127.0.0.1', () => resolve(`http://127.0.0.1:${(s.address() as AddressInfo).port}`)));

beforeAll(async () => {
  app = createServer((req, res) => {
    if (req.url === '/metrics') {
      res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' });
      res.end(appMetrics);
    } else {
      res.writeHead(404).end();
    }
  });
  await listen(app, APP_PORT);

  promServer = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    res.setHeader('content-type', 'application/json');
    if (url.pathname === '/api/v1/alerts') {
      res.end(JSON.stringify({ status: 'success', data: { alerts: prom.alerts } }));
      return;
    }
    if (url.pathname === '/api/v1/query') {
      const q = url.searchParams.get('query') ?? '';
      prom.queries.push(q);
      const value = q.startsWith('histogram_quantile') ? prom.p95 : q.startsWith('sum(increase(') ? prom.count : prom.rate;
      res.end(JSON.stringify({ status: 'success', data: { resultType: 'vector', result: value === '' ? [] : [{ metric: {}, value: [NOW.getTime() / 1000, value] }] } }));
      return;
    }
    res.writeHead(404).end();
  });
  promUrl = await listen(promServer);

  hangingServer = createServer(() => undefined); // accepts and never answers
  hangingUrl = await listen(hangingServer);

  const closed = createServer();
  closedUrl = await listen(closed);
  await new Promise((r) => closed.close(r));
});

afterAll(async () => {
  hangingServer.closeAllConnections();
  await Promise.all([app, promServer, hangingServer].map((s) => new Promise((r) => s.close(r))));
});

const appBaseUrl = `http://127.0.0.1:${APP_PORT}`;

describe('checkMonitoring through the app /metrics (Prometheus down)', () => {
  it('healthy: nothing found', async () => {
    appMetrics = metricsText(0);
    const f = await checkMonitoring('card', { prometheusUrl: closedUrl, appBaseUrl, logFile: healthyLog, now: NOW });
    expect(f).toMatchObject({ source: 'metrics-endpoint', errorsPerSecond: 0, alertsFiring: [], p95Seconds: null, logLinesRead: 2, logErrors: 0, logWarnings: 0, showsProblem: false });
    expect(f.summary).toMatch(/^Nothing found\./);
    expect(f.summary).toContain('no responses with status 5xx on /card');
    expect(f.unavailable ?? false).toBe(false);
    expect(f.errorCount5xx).toBe(0);
  });

  it('neither Prometheus nor the app answers: unavailable, never "Nothing found"', async () => {
    const f = await checkMonitoring('card', { prometheusUrl: closedUrl, appBaseUrl: closedUrl, logFile: healthyLog, now: NOW });
    expect(f).toMatchObject({ source: 'metrics-endpoint', unavailable: true, errorsPerSecond: 0, showsProblem: false });
    expect(f.errorCount5xx).toBeUndefined();
    expect(f.summary).toMatch(/^Monitoring could not be read\./);
    expect(f.summary).not.toContain('Nothing found');
  });

  it('failing: the 5xx count is named and the log errors counted', async () => {
    appMetrics = metricsText(7);
    const f = await checkMonitoring('card', { prometheusUrl: closedUrl, appBaseUrl, logFile: failingLog, now: NOW });
    expect(f.source).toBe('metrics-endpoint');
    expect(f.showsProblem).toBe(true);
    expect(f).toMatchObject({ errorCount5xx: 7, errorsPerSecond: 0 }); // a count since start, never a made-up rate
    expect(f.unavailable ?? false).toBe(false);
    expect(f.summary).toContain('7 responses with status 5xx on /card');
    expect(f).toMatchObject({ logLinesRead: 4, logErrors: 2, logWarnings: 1 });
    expect(f.summary).not.toMatch(/^Nothing found/);
  });

  it('falls back within 4 s when Prometheus accepts but does not answer', async () => {
    appMetrics = metricsText(0);
    const t0 = performance.now();
    const f = await checkMonitoring('card', { prometheusUrl: hangingUrl, appBaseUrl, logFile: healthyLog, now: NOW });
    const ms = performance.now() - t0;
    expect(f.source).toBe('metrics-endpoint');
    expect(f.summary).toContain('did not answer within 3 seconds');
    expect(ms).toBeLessThan(4_000);
    expect(ms).toBeGreaterThan(2_900);
  });

  it('a missing log file is 0 lines read, not an error', async () => {
    appMetrics = metricsText(0);
    const f = await checkMonitoring('card', { prometheusUrl: closedUrl, appBaseUrl, logFile: join(dir, 'no-such.log'), now: NOW });
    expect(f).toMatchObject({ logLinesRead: 0, logErrors: 0, showsProblem: false });
    expect(f.summary).toContain('0 lines were read');
  });
});

describe('checkMonitoring through Prometheus', () => {
  it('healthy: sends the contract query and finds nothing', async () => {
    Object.assign(prom, { rate: '0', count: '0', p95: '0.0123', alerts: [{ labels: { alertname: 'TransfersErrors', path: '/transfers' }, state: 'firing' }], queries: [] });
    const f = await checkMonitoring('card', { prometheusUrl: promUrl, appBaseUrl, logFile: healthyLog, now: NOW });
    expect(prom.queries).toContain('sum(rate(http_requests_total{path="/card",status=~"5.."}[1h]))');
    expect(errorRateQuery('/card')).toBe('sum(rate(http_requests_total{path="/card",status=~"5.."}[1h]))');
    expect(f).toMatchObject({ source: 'prometheus', errorsPerSecond: 0, alertsFiring: [], p95Seconds: 0.0123, showsProblem: false });
    expect(f.summary).toMatch(/^Nothing found\. Prometheus shows no responses with status 5xx on \/card/);
  });

  it('failing: an error rate and a firing alert for the page', async () => {
    Object.assign(prom, {
      rate: '0.05',
      count: '180.4',
      p95: '0.2',
      queries: [],
      alerts: [
        { labels: { alertname: 'CardErrors', path: '/card' }, state: 'firing' },
        { labels: { alertname: 'CardSlow', path: '/card' }, state: 'pending' },
        { labels: { alertname: 'TransfersErrors', path: '/transfers' }, state: 'firing' },
      ],
    });
    const f = await checkMonitoring('card', { prometheusUrl: promUrl, appBaseUrl, logFile: failingLog, now: NOW });
    expect(prom.queries).toContain('sum(increase(http_requests_total{path="/card",status=~"5.."}[1h]))');
    expect(f).toMatchObject({ source: 'prometheus', errorsPerSecond: 0.05, errorCount5xx: 180, alertsFiring: ['CardErrors'], p95Seconds: 0.2, showsProblem: true, logErrors: 2 });
    expect(f.summary).toContain('about 180 responses with status 5xx on /card in the last hour (0.05 per second)');
    expect(f.summary).toContain('firing alerts: CardErrors');
  });

  it('an alert alone makes showsProblem true', async () => {
    Object.assign(prom, { rate: '', count: '', p95: '', alerts: [{ labels: { alertname: 'CardAppDown' }, state: 'firing' }] });
    const f = await checkMonitoring('card', { prometheusUrl: promUrl, appBaseUrl, logFile: healthyLog, now: NOW });
    expect(f).toMatchObject({ errorsPerSecond: 0, p95Seconds: null, alertsFiring: ['CardAppDown'], showsProblem: true });
  });
});
