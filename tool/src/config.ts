// Settings for a run. Every value can be overridden by an environment variable of the same name.
// Addresses and names come from docs/CONTEXT.md, "Contracts".

import type { Page } from './types.js';

const env = (name: string, fallback: string): string => (process.env[name] ?? '').trim() || fallback;

export const config = {
  /** Slack channel the reports arrive in, without the #. */
  supportChannel: env('SUPPORT_CHANNEL', 'support'),
  /** Reports in one group before the tool acts. */
  reportThreshold: Number(env('REPORT_THRESHOLD', '3')),
  /** Repositories the product's code lives in, owner/name, comma separated. The first holds the owners file. */
  repos: env('PRODUCT_REPOS', 'marshalofthecentralaltar/demo-bank-card-app').split(',').map((r) => r.trim()).filter(Boolean),
  /** Where the running card app answers. */
  appBaseUrl: env('APP_BASE_URL', 'http://localhost:3000'),
  prometheusUrl: env('PROMETHEUS_URL', 'http://localhost:9090'),
  /** The card app's request log, one JSON object per line. */
  requestLogFile: env('REQUEST_LOG_FILE', 'C:/Users/ralfs/wise-build/demo-bank-card-app-deploy/logs/requests.log'),
  /** How far back step 4 lists commits. */
  recentDays: Number(env('RECENT_DAYS', '7')),
  /** Seconds step 8 waits for a tested fix before it pushes a branch that undoes the commit. */
  fixBudgetSeconds: Number(env('FIX_BUDGET_SECONDS', '60')),
  /** Model aliases for the `claude` CLI. */
  groupingModel: env('GROUPING_MODEL', 'haiku'),
  investigationModel: env('INVESTIGATION_MODEL', 'sonnet'),
  fixModel: env('FIX_MODEL', 'sonnet'),
} as const;

/** Web path of each page, as in the contracts. */
export const PAGE_PATHS: Record<Page, string> = {
  card: '/card',
  transfers: '/transfers',
  account: '/account',
};
