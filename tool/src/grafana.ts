// A link to the Grafana dashboard in monitoring/grafana/ for the page the reports are about:
// the 5xx panel (the tool's own query), from 15 minutes before the first report until now. Pure.
// Grafana runs on the stage laptop only, so the link opens on that laptop.
import { config } from './config.js';
import type { Page, ReportGroup } from './types.js';

const DASHBOARD = 'card-and-transfers';
/** Panel ids in monitoring/grafana/provisioning/dashboards/json/card-and-transfers.json. */
/**
 * The panel the link opens. The card page's flicker is a request storm (the balance asked for every
 * second), not errors, so /card opens "Requests per second"; /transfers keeps its 5xx panel.
 */
const PANEL_LINK: Partial<Record<Page, { id: number; label: string }>> = {
  card: { id: 1, label: 'requests per second' },
  transfers: { id: 5, label: '5xx' },
};
const BEFORE_FIRST_REPORT_MS = 15 * 60_000;

export function grafanaUrl(group: Pick<ReportGroup, 'page' | 'reports'>, base = config.grafanaUrl): string {
  const times = group.reports.map((r) => Number(r.ts) * 1000).filter((t) => Number.isFinite(t) && t > 0);
  // `to=now` keeps the link the same for the same reports and lets the panel keep moving.
  const from = times.length ? String(Math.round(Math.min(...times) - BEFORE_FIRST_REPORT_MS)) : 'now-30m';
  const params = new URLSearchParams({ orgId: '1', from, to: 'now' });
  const panel = group.page ? PANEL_LINK[group.page]?.id : undefined;
  if (panel) params.set('viewPanel', `panel-${panel}`);
  return `${base.replace(/\/+$/, '')}/d/${DASHBOARD}/${DASHBOARD}?${params.toString()}`;
}

/** Slack mrkdwn link to the dashboard, or '' when GRAFANA_URL is `off`. */
export function grafanaLink(group: Pick<ReportGroup, 'page' | 'reports'>, base = config.grafanaUrl): string {
  if (!base || base.toLowerCase() === 'off') return '';
  const panel = group.page ? PANEL_LINK[group.page] : undefined;
  const label = panel ? `Grafana: /${group.page} ${panel.label} since the first report` : 'Grafana dashboard';
  return `<${grafanaUrl(group, base)}|${label}>`;
}
