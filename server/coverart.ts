import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Rules } from '../shared/types.ts'
import { ART_DIR } from './config.ts'
import { USER_AGENT } from './musicbrainz.ts'

const cachePath = (releaseId: string, size: Rules['art']['size']) => path.join(ART_DIR, `${releaseId}-${size}.jpg`)

/** True once we've asked the Cover Art Archive and it had nothing for this release. */
export function coverKnownMissing(releaseId: string, size: Rules['art']['size']) {
  const miss = `${cachePath(releaseId, size)}.missing`
  try {
    return Date.now() - statSync(miss).mtimeMs < RECHECK_MISSING_MS
  } catch {
    return false
  }
}
// Art gets added to the archive over time, so "no cover" is only trusted for a while.
const RECHECK_MISSING_MS = 30 * 24 * 3600 * 1000

/** Front cover from the Cover Art Archive (release, then release group). Cached on disk. */
export async function getCover(releaseId: string, releaseGroupId: string | null, size: Rules['art']['size']): Promise<Buffer | null> {
  const cached = cachePath(releaseId, size)
  const miss = `${cached}.missing`
  if (existsSync(cached)) return readFileSync(cached)
  if (coverKnownMissing(releaseId, size)) return null
  const suffix = size === 'original' ? 'front' : `front-${size}`
  const urls = [`https://coverartarchive.org/release/${releaseId}/${suffix}`]
  if (releaseGroupId) urls.push(`https://coverartarchive.org/release-group/${releaseGroupId}/${suffix}`)
  for (const url of urls) {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, redirect: 'follow' })
    if (!res.ok) continue
    const type = res.headers.get('content-type') ?? ''
    if (!type.startsWith('image/')) continue
    const buf = Buffer.from(await res.arrayBuffer())
    writeFileSync(cached, buf)
    return buf
  }
  writeFileSync(miss, '')
  return null
}
