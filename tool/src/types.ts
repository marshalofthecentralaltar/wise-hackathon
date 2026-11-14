// The shapes passed between the ten steps of a run (docs/CONTEXT.md, "The run, step by step").
// Each lane builds its steps to these shapes so the pieces join without changes.
// Change this file only through the orchestrator.

export type Page = 'card' | 'transfers' | 'account';
export type Severity = 'low' | 'high';

/** Step 1. One message from #support that passed isCustomerReportCandidate. */
export interface Report {
  channel: string;
  ts: string;
  /** Slack user id, or the bot id when another app posted it. */
  sender: string;
  text: string;
  /** Link to the message, filled before the handoff is written. */
  permalink?: string;
}

/** Step 2. Reports the tool judged to be about the same problem. */
export interface ReportGroup {
  id: string;
  /** The page the problem is on, or null when the reports do not say. */
  page: Page | null;
  /** The problem in one sentence, in English, as customers describe it. */
  summary: string;
  reports: Report[];
  /** ts of the first report; the tool's thread hangs off this message. */
  threadTs: string;
}

/** Step 3. What monitoring and the logs showed for the page. "Nothing" is a normal result. */
export interface MonitoringFinding {
  /** Where the error rate came from. 'metrics-endpoint' is the fallback when Prometheus does not answer. */
  source: 'prometheus' | 'metrics-endpoint';
  errorsPerSecond: number;
  alertsFiring: string[];
  /** 95th percentile response time over the last hour, or null when there is no data. */
  p95Seconds: number | null;
  logLinesRead: number;
  logErrors: number;
  logWarnings: number;
  /** True when errors, a firing alert or error log lines were found. */
  showsProblem: boolean;
  /** True when neither Prometheus nor the app's own /metrics could be read. The page's health is then unknown. */
  unavailable?: boolean;
  /** Count of 5xx responses behind the finding: over the last hour from Prometheus, since the app started from the fallback. */
  errorCount5xx?: number;
  /** The PromQL sent to Prometheus for the 5xx rate; absent when the reading came from the fallback. */
  query?: string;
  /** One or two plain sentences for part 3 of the handoff. */
  summary: string;
}

/** Step 4. One commit of the last 7 days, with its pull request when it has one. */
export interface RecentCommit {
  repo: string;
  sha: string;
  author: string;
  /** ISO time the commit reached the default branch (merge time when known, else commit time). */
  mergedAt: string;
  message: string;
  files: string[];
  pullRequest?: {
    number: number;
    title: string;
    body: string;
    url: string;
    comments: { author: string; body: string }[];
  };
}

/** Step 5. Who owns the page, from the owners file. Nobody is told at this step. */
export interface Owner {
  repo: string;
  /** Folder in the repository that holds the page's code, for example src/pages/card/. */
  codePath: string | null;
  /** GitHub login without the @, or null when no owners line covers the page. */
  githubLogin: string | null;
  /** Slack user id of that person, or null when not found in the workspace. */
  slackUserId: string | null;
  /** The owners-file line that decided it, for the handoff. */
  ownersLine: string | null;
}

/** Step 6. What Claude Code found in a fresh copy of the code. */
export interface Investigation {
  /** False when the investigation could not name a responsible commit. */
  found: boolean;
  repo: string;
  commitSha: string | null;
  commitAuthor: string | null;
  mergedAt: string | null;
  pullRequestUrl: string | null;
  file: string | null;
  /** For example "12-20". */
  lines: string | null;
  /** What is wrong in the code, two or three plain sentences. */
  whatIsWrong: string;
  /** What the problem does to a customer: used by the severity rules. */
  customerEffect: 'appearance' | 'wording' | 'figure' | 'payment' | 'customer-data' | 'action-blocked' | 'unknown';
  /** Result of a trial `git revert` in a scratch copy; null when not tried. Nothing is pushed. */
  revertsCleanly: boolean | null;
  nextSteps: string[];
  seconds: number;
}

/** Step 7. */
export interface Verdict {
  severity: Severity;
  reason: string;
  /** 'rule' when a written rule decided it; 'model' only for what the rules leave open. */
  decidedBy: 'rule' | 'model';
}

/** Step 8. Low severity only. For high severity the kind is 'none' and nothing is pushed. */
export interface FixOutcome {
  /** 'fix' = Claude Code's change; 'undo' = a branch that reverts the commit; 'none' = no change to code. */
  kind: 'fix' | 'undo' | 'none';
  prUrl: string | null;
  prNumber: number | null;
  branch: string | null;
  filesChanged: string[];
  testsPassed: boolean | null;
  /** Why there is no pull request, when kind is 'none' for a low-severity problem. */
  note: string | null;
  seconds: number;
  /** Unified diff of the pushed change, capped at 4,000 characters; null or absent when there is none. */
  diff?: string | null;
}

/** Step 8 input: what the fix step is given. It acts only when verdict.severity is 'low'. */
export interface FixStepInput {
  group: ReportGroup;
  owner: Owner;
  investigation: Investigation;
  verdict: Verdict;
}

/**
 * Steps 6 to 8 as the pipeline calls them. The pipeline takes these injected, so it runs in tests
 * with stand-ins and in the tool with the real functions (investigate, classifyCustomerEffect,
 * judge, fixStep). The pipeline starts classifyCustomerEffect together with investigate and passes
 * the promise to judge as textEffect.
 */
export interface CodeSteps {
  investigate(input: { group: ReportGroup; owner: Owner; monitoring: MonitoringFinding; commits: RecentCommit[] }): Promise<Investigation>;
  classifyCustomerEffect(reportTexts: string[]): Promise<Investigation['customerEffect']>;
  judge(input: {
    group: ReportGroup;
    monitoring: MonitoringFinding;
    investigation: Investigation;
    textEffect?: Investigation['customerEffect'] | Promise<Investigation['customerEffect']>;
  }): Promise<Verdict>;
  fix(input: FixStepInput): Promise<FixOutcome>;
}

/** Step 9. Everything the handoff message needs, in the order of docs/CONTEXT.md "The handoff". */
export interface Handoff {
  group: ReportGroup;
  monitoring: MonitoringFinding;
  owner: Owner;
  investigation: Investigation;
  verdict: Verdict;
  fix: FixOutcome;
  /** Part 8: one sentence support may tell the customers. Plain text. */
  sentenceForCustomers: string;
}

/** Seconds per step of one run, for MORNING.md. */
export interface RunTimings {
  groupId: string;
  startedAt: string;
  secondsByStep: Partial<Record<'pattern' | 'monitoring' | 'changes' | 'owner' | 'investigation' | 'verdict' | 'fix' | 'handoff' | 'post', number>>;
  totalSeconds: number;
  /** Where step 3's monitoring reading came from; absent when step 3 did not finish. */
  monitoringSource?: 'prometheus' | 'metrics-endpoint';
}
