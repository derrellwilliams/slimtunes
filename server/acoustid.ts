import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { config } from './config.ts'

const run = promisify(execFile)

let available: boolean | null = null
export async function hasFpcalc(): Promise<boolean> {
  if (available !== null) return available
  try {
    await run('fpcalc', ['-version'])
    available = true
  } catch {
    available = false
  }
  return available
}

export async function fingerprint(file: string): Promise<{ duration: number; fingerprint: string }> {
  // execFile with an argv array: the path is never interpreted by a shell.
  const { stdout } = await run('fpcalc', ['-json', '-length', '120', file], { maxBuffer: 4 * 1024 * 1024 })
  return JSON.parse(stdout)
}

export interface AcoustidRecording {
  id: string
  title?: string
  artists?: { id: string; name: string }[]
  releases?: { id: string }[]
}

let last = 0
export async function lookup(fp: { duration: number; fingerprint: string }): Promise<{ score: number; recordings: AcoustidRecording[] }[]> {
  if (!config.settings.acoustidKey) throw new Error('Add an AcoustID API key in Settings to use fingerprinting')
  const wait = last + 350 - Date.now() // AcoustID allows 3 req/s
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  last = Date.now()
  const body = new URLSearchParams({
    client: config.settings.acoustidKey,
    meta: 'recordings releaseids',
    duration: String(Math.round(fp.duration)),
    fingerprint: fp.fingerprint,
  })
  const res = await fetch('https://api.acoustid.org/v2/lookup', { method: 'POST', body })
  const json = (await res.json()) as { status: string; error?: { message: string }; results?: { score: number; recordings?: AcoustidRecording[] }[] }
  if (json.status !== 'ok') throw new Error(`AcoustID: ${json.error?.message ?? 'lookup failed'}`)
  return (json.results ?? []).map((r) => ({ score: r.score, recordings: r.recordings ?? [] }))
}
