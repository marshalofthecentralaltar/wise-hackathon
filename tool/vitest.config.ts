import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Many tests spawn git and node; on a busy PC (other lanes' servers and model calls running)
    // the 5 s default timed out tests that pass on a quiet one. Per-test longer timeouts still apply.
    testTimeout: 30_000,
    // beforeAll hooks that build git fixtures timed out at the 10 s default under the same load.
    hookTimeout: 60_000,
    // Tests name their own owner; the three demo approvers (src/config.ts) are off unless a test sets them.
    env: { APPROVERS: 'off', MONITOR_CHANNEL: 'off' },
  },
});
