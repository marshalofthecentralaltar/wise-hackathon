// The two GitHub read helpers try a GET again when the network or GitHub's servers fail, and
// change nothing when GitHub answers. No network and no login: fetch, the token, the gh runner
// and the pause are stand-ins that count what they are asked.
import { describe, expect, it } from 'vitest';
import { githubRestApiWith, type RestApiDeps } from '../src/steps/changes.js';
import { GhError, ghApiWith, type ExecResult, type GhApiDeps } from '../src/steps/exec.js';

const PATH = 'repos/acme/demo-bank-card-app/commits/0e748ac7c4e36f62503750bafa231c15e8d95b62/pulls';
const TOKEN = 'gho_MARKERtoken0123456789abcdefXYZ';
const ANSWER = [{ number: 7, title: 'Card limit', body: null, html_url: 'https://github.com/acme/x/pull/7', merged_at: '2026-11-13T10:00:00Z' }];

type Step = 'reject' | 'bodyDrop' | number | { status: number; body: string };

/** A 200 whose body read fails the way undici words a dropped connection. */
function droppedBody(): Response {
  const res = new Response('', { status: 200 });
  const cause = Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' });
  return Object.assign(res, { text: () => Promise.reject(new TypeError('terminated', { cause })) });
}

/** fetch that plays the steps in order, then answers 200 with ANSWER. */
function restDeps(steps: Step[], opts: { rejectMessage?: string } = {}) {
  const sleeps: number[] = [];
  const logs: string[] = [];
  const auth: string[] = [];
  let calls = 0;
  let ghCalls = 0;
  const deps: RestApiDeps = {
    fetch: async (url, init) => {
      calls++;
      auth.push(String((init.headers as Record<string, string>).Authorization));
      expect(url).toBe(`https://api.github.com/${PATH}`);
      const step = steps.shift();
      if (step === 'reject') {
        throw new TypeError(opts.rejectMessage ?? 'fetch failed', { cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }) });
      }
      if (step === 'bodyDrop') return droppedBody();
      if (typeof step === 'number') return new Response(`{"message":"status ${step}"}`, { status: step });
      if (step) return new Response(step.body, { status: step.status });
      return new Response(JSON.stringify(ANSWER), { status: 200 });
    },
    token: async () => TOKEN,
    ghApi: async () => {
      ghCalls++;
      return 'from gh';
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    log: (line) => logs.push(line),
  };
  return { deps, sleeps, logs, auth, calls: () => calls, ghCalls: () => ghCalls };
}

async function caught(p: Promise<unknown>): Promise<Error> {
  try {
    await p;
  } catch (err) {
    return err as Error;
  }
  throw new Error('expected a rejection');
}

describe('githubRestApi retry: rejected fetch', () => {
  it('a first-time answer: one request, no pause, no log', async () => {
    const s = restDeps([]);
    expect(await githubRestApiWith(PATH, s.deps)).toEqual(ANSWER);
    expect(s.calls()).toBe(1);
    expect(s.sleeps).toEqual([]);
    expect(s.logs).toEqual([]);
  });

  it('rejects once, then answers: 2 requests, the same value, 300 ms pause, one log line', async () => {
    const s = restDeps(['reject']);
    expect(await githubRestApiWith(PATH, s.deps)).toEqual(ANSWER);
    expect(s.calls()).toBe(2);
    expect(s.sleeps).toEqual([300]);
    expect(s.logs).toEqual([`[github] GET ${PATH} failed (attempt 1 of 3): fetch failed (ECONNRESET); trying again`]);
  });

  it('rejects twice, then answers: 3 requests, pauses 300 then 1000 ms', async () => {
    const s = restDeps(['reject', 'reject']);
    expect(await githubRestApiWith(PATH, s.deps)).toEqual(ANSWER);
    expect(s.calls()).toBe(3);
    expect(s.sleeps).toEqual([300, 1000]);
    expect(s.logs).toHaveLength(2);
    expect(s.logs[1]).toContain('(attempt 2 of 3)');
  });

  it("rejects three times: 3 requests, then today's error", async () => {
    const s = restDeps(['reject', 'reject', 'reject']);
    const err = await caught(githubRestApiWith(PATH, s.deps));
    expect(err).toBeInstanceOf(GhError);
    expect(err.message).toBe(`GET ${PATH} failed: fetch failed`);
    expect(s.calls()).toBe(3);
    expect(s.sleeps).toEqual([300, 1000]);
    expect(s.logs).toHaveLength(2);
  });

  it('the body read fails once (connection dropped mid-body), then answers: 2 requests, the same value', async () => {
    const s = restDeps(['bodyDrop']);
    expect(await githubRestApiWith(PATH, s.deps)).toEqual(ANSWER);
    expect(s.calls()).toBe(2);
    expect(s.sleeps).toEqual([300]);
    expect(s.logs).toEqual([`[github] GET ${PATH} failed (attempt 1 of 3): terminated (UND_ERR_SOCKET); trying again`]);
  });

  it("the body read fails three times: 3 requests, pauses 300 then 1000 ms, a GhError in today's network format", async () => {
    const s = restDeps(['bodyDrop', 'bodyDrop', 'bodyDrop']);
    const err = await caught(githubRestApiWith(PATH, s.deps));
    expect(err).toBeInstanceOf(GhError);
    expect(err.message).toBe(`GET ${PATH} failed: terminated`);
    expect(s.calls()).toBe(3);
    expect(s.sleeps).toEqual([300, 1000]);
    expect(s.logs).toHaveLength(2);
  });

  it('cuts the logged reason at 160 characters', async () => {
    const long = `fetch failed ${'x'.repeat(400)}`;
    const s = restDeps(['reject'], { rejectMessage: long });
    await githubRestApiWith(PATH, s.deps);
    const reason = (s.logs[0] ?? '').slice(`[github] GET ${PATH} failed (attempt 1 of 3): `.length, -'; trying again'.length);
    expect(reason).toBe(long.slice(0, 160));
  });

  it('without a token every call goes through ghApi once (it retries on its own)', async () => {
    const s = restDeps([]);
    s.deps.token = async () => null;
    expect(await githubRestApiWith(PATH, s.deps)).toBe('from gh');
    expect(s.ghCalls()).toBe(1);
    expect(s.calls()).toBe(0);
  });
});

describe('githubRestApi retry: HTTP status', () => {
  it.each([429, 500, 502, 503, 504])('HTTP %i is tried again and the answer that follows is returned', async (status) => {
    const s = restDeps([status]);
    expect(await githubRestApiWith(PATH, s.deps)).toEqual(ANSWER);
    expect(s.calls()).toBe(2);
    expect(s.sleeps).toEqual([300]);
    expect(s.logs[0]).toBe(`[github] GET ${PATH} failed (attempt 1 of 3): HTTP ${status}: {"message":"status ${status}"}; trying again`);
  });

  it.each([429, 500, 502, 503, 504])("HTTP %i three times: 3 requests, today's error", async (status) => {
    const s = restDeps([status, status, status]);
    const err = await caught(githubRestApiWith(PATH, s.deps));
    expect(err).toBeInstanceOf(GhError);
    expect(err.message).toBe(`GET ${PATH} failed (HTTP ${status}): {"message":"status ${status}"}`);
    expect(s.calls()).toBe(3);
  });

  it.each([401, 403, 404, 422])("HTTP %i is not tried again: one request, today's error", async (status) => {
    const s = restDeps([status]);
    const err = await caught(githubRestApiWith(PATH, s.deps));
    expect(err).toBeInstanceOf(GhError);
    expect(err.message).toBe(`GET ${PATH} failed (HTTP ${status}): {"message":"status ${status}"}`);
    expect(s.calls()).toBe(1);
    expect(s.sleeps).toEqual([]);
    expect(s.logs).toEqual([]);
  });

  it('a 200 that is not JSON is not tried again', async () => {
    const s = restDeps([{ status: 200, body: '<html>' }]);
    const err = await caught(githubRestApiWith(PATH, s.deps));
    expect(err.message).toBe(`GET ${PATH} did not return JSON`);
    expect(s.calls()).toBe(1);
  });
});

// The stderr gh wrote at 01:53 UTC on 14 Nov 2026 (failure 2), with the repository name replaced.
const GH_PULLS = 'repos/acme/demo-bank-card-app/pulls?state=open&per_page=100';
const CONNECTEX =
  `Get "https://api.github.com/${GH_PULLS}": dial tcp 140.82.121.5:443: connectex: A connection attempt failed because the connected party did not properly respond after a period of time, or established connection failed because connected host has failed to respond.`;
const OPEN_PULLS = [{ number: 3, head: { ref: 'fix/x', repo: { full_name: 'acme/demo-bank-card-app' } } }];

type GhStep = Partial<ExecResult>;

function ghDeps(steps: GhStep[]) {
  const sleeps: number[] = [];
  const logs: string[] = [];
  const seen: { args: string[]; timeoutMs: number }[] = [];
  const deps: GhApiDeps = {
    runGh: async (args, timeoutMs) => {
      seen.push({ args, timeoutMs });
      const step = steps.shift() ?? { code: 0, stdout: JSON.stringify(OPEN_PULLS) };
      return { code: 0, stdout: '', stderr: '', timedOut: false, ...step };
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    log: (line) => logs.push(line),
  };
  return { deps, sleeps, logs, seen };
}

describe('ghApi retry', () => {
  it('a first-time answer: one gh process, no pause, no log', async () => {
    const s = ghDeps([]);
    expect(await ghApiWith(GH_PULLS, 30_000, s.deps)).toEqual(OPEN_PULLS);
    expect(s.seen).toEqual([{ args: ['api', '-H', 'Accept: application/vnd.github+json', GH_PULLS], timeoutMs: 30_000 }]);
    expect(s.sleeps).toEqual([]);
    expect(s.logs).toEqual([]);
  });

  it('the 01:53 connectex failure is tried again and the answer that follows is returned', async () => {
    const s = ghDeps([{ code: 1, stderr: `${CONNECTEX}\n` }]);
    expect(await ghApiWith(GH_PULLS, 30_000, s.deps)).toEqual(OPEN_PULLS);
    expect(s.seen).toHaveLength(2);
    expect(s.sleeps).toEqual([300]);
    expect(s.logs).toEqual([`[github] GET ${GH_PULLS} failed (attempt 1 of 3): ${`exit 1: ${CONNECTEX}`.slice(0, 160)}; trying again`]);
  });

  it('a timed-out gh is tried again', async () => {
    const s = ghDeps([{ code: null, timedOut: true }, { code: null, timedOut: true }]);
    expect(await ghApiWith(GH_PULLS, 30_000, s.deps)).toEqual(OPEN_PULLS);
    expect(s.seen).toHaveLength(3);
    expect(s.sleeps).toEqual([300, 1000]);
  });

  it.each([
    'gh: Server Error (HTTP 502)',
    'HTTP 503: Service Unavailable (https://api.github.com/x)',
    'Post "https://api.github.com/graphql": read tcp 10.0.0.2:5050->140.82.121.5:443: wsarecv: An existing connection was forcibly closed by the remote host. connection reset',
    'Get "https://api.github.com/x": EOF',
    'Get "https://api.github.com/x": net/http: TLS handshake timeout',
    'Get "https://api.github.com/x": dial tcp: lookup api.github.com: no such host',
    'Get "https://api.github.com/x": read tcp 1.2.3.4:1->5.6.7.8:443: i/o timeout',
  ])('network or server failure is tried again: %s', async (stderr) => {
    const s = ghDeps([{ code: 1, stderr }]);
    expect(await ghApiWith(GH_PULLS, 30_000, s.deps)).toEqual(OPEN_PULLS);
    expect(s.seen).toHaveLength(2);
  });

  it("the connectex failure three times: 3 gh processes, then today's error", async () => {
    const s = ghDeps([1, 2, 3].map(() => ({ code: 1, stderr: `${CONNECTEX}\n` })));
    const err = await caught(ghApiWith(GH_PULLS, 30_000, s.deps));
    expect(err).toBeInstanceOf(GhError);
    expect(err.message).toBe(`gh api ${GH_PULLS} failed (exit 1): ${CONNECTEX.slice(0, 300)}`);
    expect(s.seen).toHaveLength(3);
    expect(s.sleeps).toEqual([300, 1000]);
    expect(s.logs).toHaveLength(2);
  });

  it("timed out three times: today's 'timed out' error", async () => {
    const s = ghDeps([1, 2, 3].map(() => ({ code: null, timedOut: true })));
    const err = await caught(ghApiWith(GH_PULLS, 30_000, s.deps));
    expect(err.message).toBe(`gh api ${GH_PULLS} failed (timed out): `);
    expect(s.seen).toHaveLength(3);
  });

  it.each([
    'gh: Not Found (HTTP 404)',
    'HTTP 404: Not Found (https://api.github.com/repos/acme/x/contents/OWNERS)',
    'gh: Bad credentials (HTTP 401)',
    'gh: Resource not accessible by integration (HTTP 403)',
    'gh: Validation Failed (HTTP 422)',
  ])("an answer is not tried again: %s (one gh process, today's error)", async (stderr) => {
    const s = ghDeps([{ code: 1, stderr }]);
    const err = await caught(ghApiWith(GH_PULLS, 30_000, s.deps));
    expect(err).toBeInstanceOf(GhError);
    expect(err.message).toBe(`gh api ${GH_PULLS} failed (exit 1): ${stderr}`);
    expect(s.seen).toHaveLength(1);
    expect(s.sleeps).toEqual([]);
    expect(s.logs).toEqual([]);
  });

  it('a failure that is not a network failure (gh missing) is not tried again', async () => {
    const s = ghDeps([{ code: -1, stderr: 'Error: spawn gh ENOENT' }]);
    await caught(ghApiWith(GH_PULLS, 30_000, s.deps));
    expect(s.seen).toHaveLength(1);
  });

  it('output that is not JSON is not tried again', async () => {
    const s = ghDeps([{ code: 0, stdout: 'not json' }]);
    const err = await caught(ghApiWith(GH_PULLS, 30_000, s.deps));
    expect(err.message).toBe(`gh api ${GH_PULLS} did not return JSON`);
    expect(s.seen).toHaveLength(1);
  });
});

describe('metamorphic: when nothing fails, the retry changes nothing', () => {
  const paths = [PATH, 'repos/acme/x/commits?since=2026-11-07T00:00:00Z&per_page=100', 'repos/acme/x/issues/7/comments?per_page=100'];

  it('githubRestApi: each call one request, no pause, the same value as a bare fetch', async () => {
    for (const p of paths) {
      const body = JSON.stringify({ path: p, n: p.length });
      let calls = 0;
      const sleeps: number[] = [];
      const deps: RestApiDeps = {
        fetch: async () => {
          calls++;
          return new Response(body, { status: 200 });
        },
        token: async () => TOKEN,
        ghApi: async () => 'never',
        sleep: async (ms) => {
          sleeps.push(ms);
        },
        log: () => {
          throw new Error('no log when nothing fails');
        },
      };
      expect(await githubRestApiWith(p, deps)).toEqual(JSON.parse(body));
      expect(calls).toBe(1);
      expect(sleeps).toEqual([]);
    }
  });

  it('ghApi: each call one gh process, no pause, the same value as JSON.parse of its stdout', async () => {
    for (const p of paths) {
      const stdout = JSON.stringify([{ path: p }]);
      const s = ghDeps([{ code: 0, stdout }]);
      expect(await ghApiWith(p, 30_000, s.deps)).toEqual(JSON.parse(stdout));
      expect(s.seen).toHaveLength(1);
      expect(s.sleeps).toEqual([]);
      expect(s.logs).toEqual([]);
    }
  });
});

describe('the token is in no log line and no error message', () => {
  it('success, retry and final failure, rejected fetch and HTTP errors', async () => {
    const texts: string[] = [];
    const auths: string[] = [];
    const scenarios: Step[][] = [[], ['reject'], [503, 'reject'], ['reject', 'reject', 'reject'], [502, 502, 502], [401], ['bodyDrop', 'bodyDrop', 'bodyDrop']];
    for (const steps of scenarios) {
      const s = restDeps([...steps]);
      try {
        await githubRestApiWith(PATH, s.deps);
      } catch (err) {
        texts.push((err as Error).message, String((err as Error).stack));
      }
      texts.push(...s.logs);
      auths.push(...s.auth);
    }
    // The token did reach the request, so its absence below is not vacuous.
    expect(auths.length).toBeGreaterThan(6);
    expect(auths.every((a) => a === `Bearer ${TOKEN}`)).toBe(true);
    expect(texts.length).toBeGreaterThan(6);
    for (const t of texts) expect(t).not.toContain(TOKEN);
  });

  it('a server that echoes the token back has it removed from the log line and the error', async () => {
    const echo = { status: 502, body: `bad gateway for Bearer ${TOKEN}` };
    const s = restDeps([echo, { ...echo }, { ...echo }]);
    const err = await caught(githubRestApiWith(PATH, s.deps));
    expect(s.logs).toHaveLength(2);
    for (const t of [...s.logs, err.message]) {
      expect(t).not.toContain(TOKEN);
      expect(t).toContain('[token]');
    }
  });
});
