# Prometheus kit

Prometheus 3.15.1, downloaded once into `monitoring/.bin/` (SHA-256 checked); settings, data, log and pid in `monitoring/.run/`. Node 22, no dependencies. Runs from any folder, in PowerShell or Git Bash.

- Start: `node monitoring/start.mjs [--target localhost:3000] [--scheme http]` prints `Prometheus ready at http://localhost:9090`. Listens on 127.0.0.1 only.
- Check: `node monitoring/check.mjs` prints `{"errors_per_second":0,"alerts_firing":[]}` on a healthy page; exit 1 if Prometheus does not answer.
- Stop: `node monitoring/stop.mjs` prints `Prometheus stopped`.
- Test target (never in the demo): `node monitoring/fake-target.mjs [--errors]` on 127.0.0.1:3000.
- Query: `sum(rate(http_requests_total{path="/card",status=~"5.."}[1h]))`. Alert `CardPageErrors` (rules.yml).
- Errors stay in the 1 h window: after an error test, stop, delete `monitoring/.run/data`, start again.

Proofs (two terminals: fake target in one, the rest in the other):

1. Healthy: `node monitoring/fake-target.mjs`, `node monitoring/start.mjs`, wait 90 s, `node monitoring/check.mjs` prints `{"errors_per_second":0,"alerts_firing":[]}`.
2. Broken: restart the fake target with `--errors`, wait 150 s, `check.mjs` prints `errors_per_second` above 0 and `CardPageErrors` firing.
3. Stopped: `node monitoring/stop.mjs`; `check.mjs` exits 1; `tasklist | findstr prometheus` prints nothing.
4. Second start: `start.mjs` twice; the second prints `Port 9090 is already in use`, exits 1, downloads nothing.
5. `git status --short` shows only the seven files in `monitoring/`.
