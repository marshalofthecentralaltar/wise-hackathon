# Grafana on top of the Prometheus kit

A real Grafana OSS, downloaded once and provisioned from files, that reads the Prometheus kit from
`monitoring/`. It is a screen only: the tool asks Prometheus directly and never talks to Grafana.

- Grafana **13.3.1** for Windows amd64, one fixed version. `start.mjs` checks the zip's SHA-256
  (`a5e6fa38c86f44af466f0361ad516651663dd0f3574d771e1c031978c91f69dd`) before unpacking it into
  `monitoring/.run/grafana/`, which git ignores.
- Port **3100**. Grafana's default 3000 is the card app.
- No login screen: anonymous viewing as Viewer.
- One data source (`http://localhost:9090`) and one dashboard, both from files in
  `provisioning/`, so nothing is arranged by clicking.

## Two commands

    node monitoring/grafana/start.mjs
    node monitoring/grafana/stop.mjs

`start.mjs` prints how long it took and the dashboard address. `stop.mjs` stops it and confirms
that port 3100 refuses connections.

**The dashboard without menus (kiosk mode):**

    http://localhost:3100/d/card-and-transfers/card-and-transfers?kiosk

Without `?kiosk` the same dashboard opens inside Grafana's normal interface.

## On stage, in order

    node monitoring/fake-target.mjs      # or the card app itself, on port 3000
    node monitoring/start.mjs            # Prometheus on http://localhost:9090
    node monitoring/grafana/start.mjs    # Grafana on http://localhost:3100

Then open the kiosk address in the right half of the screen. If Prometheus is not running,
`start.mjs` says so instead of leaving an empty dashboard unexplained. Stop Grafana with
`node monitoring/grafana/stop.mjs`; it does not stop Prometheus.

## The dashboard

One row for `/card`, one for `/transfers`. Each row has three panels, all on the app's own metrics
that Prometheus scrapes from port 3000:

1. requests per second by status: `sum by (status) (rate(http_requests_total{path="..."}[1m]))`
2. the 5xx rate with the tool's exact query:
   `sum(rate(http_requests_total{path="/card",status=~"5.."}[1h]))`. Grafana asks it with
   `or vector(0)`, so an empty result draws the flat zero line that `monitoring/check.mjs` also
   reports as `0`, instead of "No data"; once a 5xx appears the panel rises.
3. the 95th percentile response time from `http_request_duration_seconds`:
   `histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket{path="..."}[5m])))`

The legend shows each series' last value, so a healthy page reads `200 … req/s`,
`5xx per second 0.000 req/s` and a p95 in milliseconds without opening anything.

## Files

- `start.mjs`: port check, download (SHA-256), unpack, settings, start, wait until the dashboard
  answers, then print the address and the time it took. Node 22 built-ins only.
- `stop.mjs`: stops the process `start.mjs` wrote to `monitoring/.run/grafana.pid` and waits until
  port 3100 refuses connections.
- `grafana.ini.template`: the settings; `start.mjs` fills in this machine's paths.
- `provisioning/datasources/prometheus.yml`: the kit at `http://localhost:9090`.
- `provisioning/dashboards/dashboards.yml` and `provisioning/dashboards/json/card-and-transfers.json`:
  the dashboard.
- `screenshots/`: the proof images from the pull request.

Everything `start.mjs` writes lives in `monitoring/.run/`: the zip, the unpacked Grafana, the
settings, the provisioning copy, the database, the logs and the pid. Deleting `monitoring/.run/grafana`
makes the next start unpack again; deleting the zip as well makes it download again.

## Shell

Command Prompt (`cmd.exe`) on Windows 11, Node v22.13.1. It also runs in PowerShell. No packages,
no build step; the only downloads are Grafana itself and the Prometheus kit.
