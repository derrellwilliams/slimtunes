#!/usr/bin/env node
// Starts the local SlimTunes server and opens it in your browser.
process.env.SLIMTUNES_OPEN ??= '1'
await import('../server/index.ts')
