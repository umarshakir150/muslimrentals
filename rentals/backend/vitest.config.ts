import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // These smoke tests are DB-independent by design (no live Postgres in
    // this environment) -- see ai/current-state.md's "Testing status".
    // Anything requiring a real database belongs in a separate,
    // integration-tagged suite once that access exists.
  },
});
