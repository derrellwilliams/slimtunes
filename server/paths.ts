import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

// Side-effect-light so worker threads can import it without touching config.json.
export const DATA_DIR = process.env.SLIMTUNES_HOME ?? path.join(homedir(), '.slimtunes')
export const BLOB_DIR = path.join(DATA_DIR, 'blobs')
export const ART_DIR = path.join(DATA_DIR, 'art')

for (const dir of [DATA_DIR, BLOB_DIR, ART_DIR]) mkdirSync(dir, { recursive: true, mode: 0o700 })
