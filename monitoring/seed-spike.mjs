// Demo only: makes the Grafana "requests per second" panel for /card show the flicker's request
// storm. The broken card page asks for the balance every second from each open browser; on stage
// one tab is open, which is too small to see. This sends RATE GETs a second to /api/balance on the
// card app for SECONDS seconds, then stops. Real requests, so Prometheus and Grafana show real data.
// node monitoring/seed-spike.mjs [--rate 25] [--seconds 240] [--url http://localhost:3000]
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const rate = Math.max(1, Math.min(100, Number(arg('rate', '25'))));
const seconds = Math.max(1, Math.min(900, Number(arg('seconds', '240'))));
const base = arg('url', process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const target = `${base}/api/balance`;
const until = Date.now() + seconds * 1000;
let sent = 0;
let failed = 0;
console.log(`seed-spike: ${rate} requests a second to ${target} for ${seconds} s`);
const timer = setInterval(() => {
  if (Date.now() >= until) {
    clearInterval(timer);
    console.log(`seed-spike: done, ${sent} sent, ${failed} failed`);
    return;
  }
  for (let i = 0; i < rate; i++) {
    sent++;
    fetch(target, { signal: AbortSignal.timeout(2000) }).then((r) => r.arrayBuffer()).catch(() => { failed++; });
  }
}, 1000);
