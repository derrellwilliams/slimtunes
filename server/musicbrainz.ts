import type { Release, ReleaseSummary, ReleaseTrack } from '../shared/types.ts'
import { db } from './db.ts'

const BASE = 'https://musicbrainz.org/ws/2'
// MusicBrainz requires a descriptive UA with contact info. We use the project URL, never the user's email.
export const USER_AGENT = 'SlimTunes/0.1 ( https://github.com/derrellwilliams/slimtunes )'
const CACHE_TTL = 30 * 24 * 3600 * 1000

// 1 request per second, serialized.
let chain: Promise<unknown> = Promise.resolve()
let last = 0
function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const wait = last + 1100 - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    last = Date.now()
    return fn()
  })
  chain = run.catch(() => {})
  return run
}

async function get<T>(pathAndQuery: string): Promise<T> {
  const url = `${BASE}${pathAndQuery}${pathAndQuery.includes('?') ? '&' : '?'}fmt=json`
  const cached = db.prepare('SELECT body, fetched_at FROM mb_cache WHERE url = ?').get(url) as { body: string; fetched_at: number } | undefined
  if (cached && Date.now() - cached.fetched_at < CACHE_TTL) return JSON.parse(cached.body)

  for (let attempt = 0; ; attempt++) {
    const res = await throttled(() => fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } }))
    if (res.status === 503 && attempt < 4) {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)))
      continue
    }
    if (res.status === 404) throw new Error('Not found on MusicBrainz')
    if (!res.ok) throw new Error(`MusicBrainz ${res.status}`)
    const body = await res.text()
    db.prepare('INSERT OR REPLACE INTO mb_cache (url, body, fetched_at) VALUES (?, ?, ?)').run(url, body, Date.now())
    return JSON.parse(body)
  }
}

// --- raw MusicBrainz JSON shapes (only fields we use) ---
interface MbArtistCredit {
  name: string
  joinphrase?: string
  artist: { id: string; name: string }
}
interface MbRelease {
  id: string
  title: string
  date?: string
  country?: string
  status?: string
  barcode?: string
  disambiguation?: string
  score?: number
  'artist-credit'?: MbArtistCredit[]
  'release-group'?: { id: string; 'primary-type'?: string; 'secondary-types'?: string[]; 'first-release-date'?: string }
  'label-info'?: { label?: { name: string } }[]
  media?: {
    position: number
    format?: string
    'track-count': number
    tracks?: {
      id: string
      position: number
      title: string
      length?: number
      'artist-credit'?: MbArtistCredit[]
      recording: { id: string; title: string; length?: number }
    }[]
  }[]
}

export function creditName(ac: MbArtistCredit[] | undefined): string {
  return (ac ?? []).map((c) => c.name + (c.joinphrase ?? '')).join('')
}

function summarize(r: MbRelease): ReleaseSummary {
  const media = r.media ?? []
  return {
    id: r.id,
    title: r.title,
    artist: creditName(r['artist-credit']),
    artistIds: (r['artist-credit'] ?? []).map((c) => c.artist.id),
    date: r.date || null,
    originalDate: r['release-group']?.['first-release-date'] || null,
    country: r.country || null,
    formats: [...new Set(media.map((m) => m.format ?? 'Unknown'))],
    trackCount: media.reduce((n, m) => n + m['track-count'], 0),
    discCount: media.length,
    releaseGroupId: r['release-group']?.id ?? null,
    primaryType: r['release-group']?.['primary-type'] ?? null,
    secondaryTypes: r['release-group']?.['secondary-types'] ?? [],
    status: r.status ?? null,
    barcode: r.barcode || null,
    disambiguation: r.disambiguation || null,
    label: r['label-info']?.[0]?.label?.name ?? null,
  }
}

const luceneEscape = (s: string) => s.replace(/([+\-&|!(){}[\]^"~*?:\\/])/g, '\\$1')

export async function searchReleases(artist: string, album: string, trackCount?: number): Promise<(ReleaseSummary & { score: number })[]> {
  const parts = [`release:(${luceneEscape(album)})`]
  if (artist && artist !== 'Various Artists') parts.push(`artist:(${luceneEscape(artist)})`)
  // Track count is a boost (OR'd on), not a filter, so partial albums still find their release.
  const q = encodeURIComponent(parts.join(' AND ') + (trackCount ? ` tracks:${trackCount}^2` : ''))
  const res = await get<{ releases: MbRelease[] }>(`/release?query=${q}&limit=15`)
  return res.releases.map((r) => ({ ...summarize(r), score: (r.score ?? 0) / 100 }))
}

export async function searchRecordings(artist: string, title: string): Promise<{ id: string; title: string; artist: string; releases: ReleaseSummary[] }[]> {
  const q = encodeURIComponent(`recording:(${luceneEscape(title)})${artist ? ` AND artist:(${luceneEscape(artist)})` : ''}`)
  const res = await get<{ recordings: { id: string; title: string; 'artist-credit'?: MbArtistCredit[]; releases?: MbRelease[] }[] }>(
    `/recording?query=${q}&limit=5`,
  )
  return res.recordings.map((r) => ({
    id: r.id,
    title: r.title,
    artist: creditName(r['artist-credit']),
    releases: (r.releases ?? []).map(summarize),
  }))
}

export async function getRelease(id: string): Promise<Release> {
  const r = await get<MbRelease>(`/release/${id}?inc=recordings+artist-credits+release-groups+labels+media`)
  const tracks: ReleaseTrack[] = []
  for (const m of r.media ?? []) {
    for (const t of m.tracks ?? []) {
      const ac = t['artist-credit'] ?? r['artist-credit']
      tracks.push({
        id: t.id,
        recordingId: t.recording.id,
        disc: m.position,
        position: t.position,
        title: t.title,
        artist: creditName(ac),
        artistIds: (ac ?? []).map((c) => c.artist.id),
        length: (t.length ?? t.recording.length) ? Math.round((t.length ?? t.recording.length)! / 1000) : null,
      })
    }
  }
  return { ...summarize(r), tracks }
}

/** Other releases (editions) in the same release group. */
export async function getEditions(releaseGroupId: string): Promise<ReleaseSummary[]> {
  const res = await get<{ releases: MbRelease[] }>(`/release?release-group=${releaseGroupId}&inc=media+labels+release-groups+artist-credits&limit=100`)
  return res.releases.map(summarize)
}

/** Top genres for a release group (falls back to the first artist's genres). */
export async function getGenres(releaseGroupId: string | null, artistId: string | undefined, max: number): Promise<string[]> {
  type G = { genres?: { name: string; count: number }[] }
  const pick = (g: G) =>
    (g.genres ?? [])
      .sort((a, b) => b.count - a.count)
      .slice(0, max)
      .map((x) => x.name.replace(/\b\w/g, (c) => c.toUpperCase()))
  if (releaseGroupId) {
    const rg = pick(await get<G>(`/release-group/${releaseGroupId}?inc=genres`))
    if (rg.length) return rg
  }
  return artistId ? pick(await get<G>(`/artist/${artistId}?inc=genres`)) : []
}

/** Accepts a bare MBID or any musicbrainz.org release URL. */
export function parseReleaseId(input: string): string | null {
  const m = input.match(/(?:release\/)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)
  return m ? m[1].toLowerCase() : null
}
