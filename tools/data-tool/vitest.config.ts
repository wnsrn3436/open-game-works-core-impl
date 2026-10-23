import { defineConfig } from 'vitest/config';
import { moduleChecksSource, VIRTUAL_ID } from './scripts/module-checks.ts';

const RESOLVED = `\0${VIRTUAL_ID}`;

export default defineConfig({
  plugins: [{
    name: 'module-checks',
    resolveId: (id: string) => (id === VIRTUAL_ID ? RESOLVED : null),
    load: (id: string) => (id === RESOLVED ? moduleChecksSource() : null),
  }],
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 60_000,
  },
});
