import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Many tests spawn git and node; on a busy PC (other lanes' servers and model calls running)
    // the 5 s default timed out tests that pass on a quiet one. Per-test longer timeouts still apply.
    testTimeout: 30_000,
  },
});
