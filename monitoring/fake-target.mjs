// Test target only. Never used in the demo.
// node monitoring/fake-target.mjs [--errors]
// Listens on 127.0.0.1:3000. GET /card answers 200 (500 with --errors). GET /metrics serves
// http_requests_total and http_request_duration_seconds in Prometheus text format.
import http from 'node:http';

const PORT = 3000;
const HOST = '127.0.0.1';
const errors = process.argv.includes('--errors');
const BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1];

/** key "method|path|status" -> count */
const counts = new Map();
/** key "method|path" -> { buckets: number[], sum, count } */
const durations = new Map();

function record(method, path, status, seconds) {
  const ck = `${method}|${path}|${status}`;
  counts.set(ck, (counts.get(ck) ?? 0) + 1);
  const dk = `${method}|${path}`;
  let d = durations.get(dk);
  if (!d) {
    d = { buckets: BUCKETS.map(() => 0), sum: 0, count: 0 };
    durations.set(dk, d);
  }
  BUCKETS.forEach((le, i) => {
    if (seconds <= le) d.buckets[i] += 1;
  });
  d.sum += seconds;
  d.count += 1;
}

function metricsBody() {
  const lines = [];
  lines.push('# HELP http_requests_total Requests served.');
  lines.push('# TYPE http_requests_total counter');
  for (const [key, n] of counts) {
    const [method, path, status] = key.split('|');
    lines.push(`http_requests_total{method="${method}",path="${path}",status="${status}"} ${n}`);
  }
  lines.push('# HELP http_request_duration_seconds Request duration in seconds.');
  lines.push('# TYPE http_request_duration_seconds histogram');
  for (const [key, d] of durations) {
    const [method, path] = key.split('|');
    const l = `method="${method}",path="${path}"`;
    BUCKETS.forEach((le, i) => lines.push(`http_request_duration_seconds_bucket{${l},le="${le}"} ${d.buckets[i]}`));
    lines.push(`http_request_duration_seconds_bucket{${l},le="+Inf"} ${d.count}`);
    lines.push(`http_request_duration_seconds_sum{${l}} ${d.sum}`);
    lines.push(`http_request_duration_seconds_count{${l}} ${d.count}`);
  }
  return lines.join('\n') + '\n';
}

const server = http.createServer((req, res) => {
  const started = process.hrtime.bigint();
  const path = (req.url ?? '/').split('?')[0];
  if (req.method === 'GET' && path === '/metrics') {
    res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
    res.end(metricsBody());
    return; // /metrics itself is not counted
  }
  let status;
  if (req.method === 'GET' && path === '/card') {
    status = errors ? 500 : 200;
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(errors ? 'Card page error (fake target)\n' : 'Card page (fake target)\n');
  } else {
    status = 404;
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found\n');
  }
  const seconds = Number(process.hrtime.bigint() - started) / 1e9;
  record(req.method ?? 'GET', path, status, seconds);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`Port ${PORT} is already in use`);
    process.exit(1);
  }
  console.log(String(err));
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`Fake target at http://localhost:${PORT}${errors ? ' (answering 500 on /card)' : ''}`);
  // Request our own /card once a second so the counters move with no other traffic.
  setInterval(() => {
    http.get({ host: HOST, port: PORT, path: '/card' }, (r) => r.resume()).on('error', () => {});
  }, 1000);
});

process.on('SIGINT', () => {
  server.close();
  process.exit(0);
});
