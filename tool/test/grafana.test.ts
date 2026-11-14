import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { grafanaLink, grafanaUrl } from '../src/grafana.js';

const dashboard = JSON.parse(readFileSync(new URL('../../monitoring/grafana/provisioning/dashboards/json/card-and-transfers.json', import.meta.url), 'utf8'));
const report = (ts: string) => ({ channel: 'C', ts, sender: 'U', text: 'x' });

describe('grafanaUrl', () => {
  it('opens the panel of the reported page, from 15 min before the first report to now', () => {
    const u = new URL(grafanaUrl({ page: 'card', reports: [report('1794645900.000200'), report('1794645800.000100')] }, 'http://localhost:3100/'));
    expect(u.origin + u.pathname).toBe('http://localhost:3100/d/card-and-transfers/card-and-transfers');
    expect(u.searchParams.get('viewPanel')).toBe('panel-1');
    expect(Number(u.searchParams.get('from'))).toBe(1794645800_000 - 15 * 60_000);
    expect(u.searchParams.get('to')).toBe('now');
  });

  it('card opens the request-rate panel (the flicker is a request storm), transfers its 5xx panel', () => {
    const panelOf = (page: 'card' | 'transfers') => {
      const id = Number(new URL(grafanaUrl({ page, reports: [] }, 'http://g')).searchParams.get('viewPanel')!.replace('panel-', ''));
      return dashboard.panels.find((p: { id: number }) => p.id === id);
    };
    expect(panelOf('card').targets[0].expr).toContain('rate(http_requests_total{path=~"/card|/api/balance"}');
    expect(panelOf('transfers').targets[0].expr).toContain('path="/transfers",status=~"5.."');
  });

  it('opens the whole dashboard when the page has no row, and the last 30 minutes without reports', () => {
    const u = new URL(grafanaUrl({ page: 'account', reports: [] }, 'http://g'));
    expect(u.searchParams.has('viewPanel')).toBe(false);
    expect(u.searchParams.get('from')).toBe('now-30m');
  });

  it('is a Slack link, and is left out when GRAFANA_URL is off', () => {
    expect(grafanaLink({ page: 'card', reports: [] }, 'http://g')).toMatch(/^<http:\/\/g\/d\/[^|>]+\|Grafana: \/card requests per second since the first report>$/);
    expect(grafanaLink({ page: 'card', reports: [] }, 'off')).toBe('');
  });
});
