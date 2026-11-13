// node monitoring/check.mjs
// Asks Prometheus the tool's query and its alerts, and prints one line of JSON.
const PROMETHEUS = 'http://localhost:9090';
const QUERY = 'sum(rate(http_requests_total{path="/card",status=~"5.."}[1h]))';

async function ask(url) {
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
  } catch (err) {
    throw new Error(`Prometheus did not answer at ${PROMETHEUS}: ${err?.cause?.code ?? err?.message ?? err}`);
  }
  let body;
  try {
    body = await res.json();
  } catch {
    throw new Error(`Prometheus answered ${res.status} with a body that is not JSON`);
  }
  if (body?.status !== 'success') {
    throw new Error(`Prometheus answered status ${body?.status ?? res.status}: ${body?.error ?? 'no reason given'}`);
  }
  return body;
}

try {
  const query = await ask(`${PROMETHEUS}/api/v1/query?query=${encodeURIComponent(QUERY)}`);
  const result = query.data?.result ?? [];
  // An empty result is a healthy page: no series with a 5xx status exists yet.
  const errorsPerSecond = result.length === 0 ? 0 : Number(result[0].value[1]);

  const alerts = await ask(`${PROMETHEUS}/api/v1/alerts`);
  const firing = (alerts.data?.alerts ?? []).filter((a) => a.state === 'firing').map((a) => a.labels?.alertname);

  console.log(JSON.stringify({ errors_per_second: errorsPerSecond, alerts_firing: firing }));
} catch (err) {
  console.log(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
