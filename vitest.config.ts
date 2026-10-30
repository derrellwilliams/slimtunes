import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Isolated data dir so tests never touch ~/.slimtunes.
    env: { SLIMTUNES_HOME: mkdtempSync(path.join(tmpdir(), 'slimtunes-test-')) },
    pool: 'forks',
    fileParallelism: false, // tests share one SQLite file
    testTimeout: 30_000,
  },
})
