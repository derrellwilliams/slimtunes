import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Rules } from '../shared/types.ts'
import { ART_DIR } from './config.ts'
import { USER_AGENT } from './musicbrainz.ts'

/** Front cover from the Cover Art Archive (release, then release group). Cached on disk. */
export async function getCover(releaseId: string, releaseGroupId: string | null, size: Rules['art']['size']): Promise<Buffer | null> {
  const cached = path.join(ART_DIR, `${releaseId}-${size}.jpg`)
  const miss = `${cached}.missing`
  if (existsSync(cached)) return readFileSync(cached)
  if (existsSync(miss)) return null
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
