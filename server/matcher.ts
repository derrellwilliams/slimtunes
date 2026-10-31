import path from 'node:path'
import type { Alignment, Candidate, Issue, Release, ReleaseSummary, Rules, TrackFile } from '../shared/types.ts'
import { fingerprint, lookup } from './acoustid.ts'
import { type AlbumRow, albumFiles, getAlbum, listAlbums, putAlbum } from './db.ts'
import { emit } from './events.ts'
import { getRelease, searchRecordings, searchReleases } from './musicbrainz.ts'
import { isSingleFileRip } from './planner.ts'
import { normalize, similarity, titleFromFilename, year } from './text.ts'

const FINAL = new Set(['leave', 'applied', 'accepted', 'skipped', 'singles', 'duplicate'])

function fileTitle(f: TrackFile) {
  return f.tags.title || titleFromFilename(path.basename(f.path))
}

function quality(f: TrackFile) {
  return (f.lossless ? 100_000 : 0) + (f.bitrate ?? 0)
}

/** Split out lower-quality copies of the same track (e.g. an MP3 next to its FLAC). */
export function splitDuplicateFiles(files: TrackFile[]): { keep: TrackFile[]; dupes: TrackFile[] } {
  const byKey = new Map<string, TrackFile[]>()
  for (const f of files) {
    const k = `${f.tags.disc ?? 1}|${f.tags.track ?? ''}|${normalize(fileTitle(f))}`
    byKey.set(k, [...(byKey.get(k) ?? []), f])
  }
  const keep: TrackFile[] = []
  const dupes: TrackFile[] = []
  for (const group of byKey.values()) {
    group.sort((a, b) => quality(b) - quality(a))
    keep.push(group[0])
    dupes.push(...group.slice(1))
  }
  return { keep, dupes }
}

function durationScore(diff: number | null) {
  return diff === null ? 0.6 : Math.max(0, 1 - Math.abs(diff) / 10)
}

/** Greedy best-pair assignment of files to release tracks. */
export function align(files: TrackFile[], release: Release): Alignment[] {
  const pairs: { f: number; t: number; score: number; title: number; diff: number | null }[] = []
  files.forEach((file, fi) => {
    release.tracks.forEach((track, ti) => {
      if (file.tags.mbRecordingId && file.tags.mbRecordingId === track.recordingId) {
        pairs.push({ f: fi, t: ti, score: 2, title: 1, diff: diffOf(file, track.length) })
        return
      }
      const known = fileTitle(file)
      const title = similarity(known, track.title)
      const diff = diffOf(file, track.length)
      const pos = file.tags.track === track.position && (file.tags.disc ?? 1) === track.disc ? 1 : 0
      // No usable title (e.g. "01.mp3"): lean on duration and track position instead.
      const score = known ? 0.55 * title + 0.3 * durationScore(diff) + 0.15 * pos : 0.6 * durationScore(diff) + 0.4 * pos
      pairs.push({ f: fi, t: ti, score, title, diff })
    })
  })
  pairs.sort((a, b) => b.score - a.score)
  const usedF = new Set<number>()
  const usedT = new Set<number>()
  const out: Alignment[] = files.map((f) => ({ filePath: f.path, trackId: null, titleScore: 0, durationDiff: null }))
  for (const p of pairs) {
    if (p.score < 0.5 || usedF.has(p.f) || usedT.has(p.t)) continue
    usedF.add(p.f)
    usedT.add(p.t)
    out[p.f] = { filePath: files[p.f].path, trackId: release.tracks[p.t].id, titleScore: p.title, durationDiff: p.diff }
  }
  return out
}

function diffOf(f: TrackFile, length: number | null) {
  return f.duration != null && length != null ? Math.round(f.duration - length) : null
}

function preferenceScore(r: ReleaseSummary, rules: Rules): number {
  let s = 0
  if (r.status === 'Official') s += 0.4
  if (rules.release.country && r.country === rules.release.country) s += 0.3
  const fmt = r.formats.join(' ').toLowerCase()
  if (rules.release.format === 'digital' && fmt.includes('digital')) s += 0.3
  if (rules.release.format === 'cd' && fmt.includes('cd')) s += 0.3
  if (rules.release.format === 'vinyl' && fmt.includes('vinyl')) s += 0.3
  if (rules.release.preferOriginalYear && r.date && r.originalDate && r.date === r.originalDate) s += 0.1
  return Math.min(1, s)
}

export function scoreRelease(album: Pick<AlbumRow, 'title' | 'artist'>, files: TrackFile[], release: Release, rules: Rules) {
  const alignment = align(files, release)
  const matched = alignment.filter((a) => a.trackId)
  const count = matched.length / Math.max(files.length, release.tracks.length, 1)
  const title = matched.length ? matched.reduce((s, a) => s + a.titleScore, 0) / matched.length : 0
  const withDur = matched.filter((a) => a.durationDiff !== null)
  const dur = withDur.length ? withDur.reduce((s, a) => s + durationScore(a.durationDiff), 0) / withDur.length : 0.6
  const albumSim = similarity(album.title, release.title)
  const artistSim = album.artist === 'Various Artists' ? 0.8 : similarity(album.artist, release.artist)
  let confidence = 0.15 * albumSim + 0.1 * artistSim + 0.25 * title + 0.2 * dur + 0.3 * count
  const tagged = files.filter((f) => f.tags.mbReleaseId === release.id).length
  if (tagged === files.length && count > 0.8) confidence = Math.max(confidence, 0.97)
  confidence = Math.min(1, confidence * 0.98 + 0.02 * preferenceScore(release, rules))
  return { alignment, confidence }
}

export function issuesFor(release: Release, alignment: Alignment[], confidence: number, rules: Rules): Issue[] {
  const issues: Issue[] = []
  const matched = alignment.filter((a) => a.trackId).length
  if (matched < release.tracks.length)
    issues.push({
      kind: 'partial',
      message: `You have ${matched} of ${release.tracks.length} tracks from this release.`,
    })
  const extra = alignment.filter((a) => !a.trackId).length
  if (extra)
    issues.push({ kind: 'extra', message: `${extra} file${extra > 1 ? 's don’t' : ' doesn’t'} match any track on this release.` })
  const drift = alignment.filter((a) => a.durationDiff !== null && Math.abs(a.durationDiff) > 7).length
  if (drift)
    issues.push({ kind: 'duration', message: `${drift} track${drift > 1 ? 's are' : ' is'} more than 7 seconds off. Could be a different edition.` })
  if (confidence < rules.autoAcceptThreshold)
    issues.push({ kind: 'low-confidence', message: `Best match is ${Math.round(confidence * 100)}% confident.` })
  return issues
}

async function evaluate(album: AlbumRow, files: TrackFile[], summaries: { s: ReleaseSummary; source: Candidate['source']; prior: number }[], rules: Rules, fetchTop: number) {
  // Rank by cheap signals first; only the most promising get a full (rate-limited) fetch.
  const ranked = summaries
    .map((x) => {
      const countFit = 1 - Math.min(1, Math.abs(x.s.trackCount - files.length) / Math.max(files.length, 1))
      return { ...x, pre: 0.5 * x.prior + 0.3 * countFit + 0.2 * preferenceScore(x.s, rules) }
    })
    .sort((a, b) => b.pre - a.pre)
  const seen = new Set<string>()
  const candidates: (Candidate & { release: ReleaseSummary; full?: Release })[] = []
  for (const [i, x] of ranked.entries()) {
    if (seen.has(x.s.id)) continue
    seen.add(x.s.id)
    if (i < fetchTop || x.source !== 'search') {
      const full = await getRelease(x.s.id)
      const { alignment, confidence } = scoreRelease(album, files, full, rules)
      candidates.push({ release: full, confidence, alignment, source: x.source, full })
    } else {
      candidates.push({ release: x.s, confidence: Math.min(0.6, x.pre * 0.7), alignment: null, source: x.source })
    }
    if (candidates.length >= 10) break
  }
  return candidates.sort((a, b) => b.confidence - a.confidence)
}

function stripTracks(r: ReleaseSummary): ReleaseSummary {
  // Candidates store summaries only; the full tracklist is kept for the chosen release.
  const { tracks: _t, ...rest } = r as Release
  return rest
}

function applyResult(album: AlbumRow, candidates: Awaited<ReturnType<typeof evaluate>>, rules: Rules, dupes: TrackFile[]) {
  const best = candidates[0]
  const base: Issue[] = album.issues.filter((i) => i.kind === 'untagged' || i.kind === 'duplicate-album')
  if (dupes.length)
    base.push({ kind: 'duplicate-files', message: `${dupes.length} lower-quality duplicate file${dupes.length > 1 ? 's' : ''} found.` })
  album.duplicateFiles = dupes.map((d) => d.path)
  album.candidates = candidates.map((c) => ({ release: stripTracks(c.release), confidence: c.confidence, alignment: c.alignment, source: c.source }))
  if (!best) {
    album.status = 'unmatched'
    album.confidence = null
    album.chosen = album.release = album.alignment = null
    album.issues = [...base, { kind: 'no-candidates', message: 'Nothing on MusicBrainz looks like this album.' }]
    return
  }
  album.confidence = best.confidence
  album.chosen = stripTracks(best.release)
  album.release = best.full ?? null
  album.alignment = best.alignment
  album.issues = [...base, ...(best.full && best.alignment ? issuesFor(best.full, best.alignment, best.confidence, rules) : [])]
  album.status = best.confidence >= rules.autoAcceptThreshold && best.full ? 'matched' : 'review'
  if (best.full && isSingleFileRip(albumFiles(album.id), best.full)) {
    album.status = 'review'
    album.issues = [
      ...base,
      {
        kind: 'single-file',
        message: `This album is one big file (usually with a .cue sheet), not ${best.full.tracks.length} separate tracks. Confirming files it in the album folder under its current name; it won’t be split or retagged.`,
      },
    ]
  }
}

export async function matchAlbum(root: string, id: string, rules: Rules, opts: { force?: boolean; query?: { artist: string; album: string } } = {}) {
  const album = getAlbum(id)
  if (!album) return
  if (!opts.force && FINAL.has(album.status)) return
  const all = albumFiles(id)
  const { keep: files, dupes } = splitDuplicateFiles(all)
  const summaries: { s: ReleaseSummary; source: Candidate['source']; prior: number }[] = []

  const tagged = [...new Set(files.map((f) => f.tags.mbReleaseId).filter(Boolean))] as string[]
  for (const rid of tagged.slice(0, 2)) {
    try {
      summaries.push({ s: await getRelease(rid), source: 'tags', prior: 1 })
    } catch {
      /* stale MBID */
    }
  }
  const artist = opts.query?.artist ?? album.artist
  const title = opts.query?.album ?? album.title
  if (!tagged.length || opts.query) {
    for (const s of await searchReleases(artist, title, files.length)) summaries.push({ s, source: opts.query ? 'manual' : 'search', prior: s.score })
  }
  // Keep previously found fingerprint/manual candidates in the pool.
  for (const c of album.candidates) if (c.source !== 'search') summaries.push({ s: c.release, source: c.source, prior: c.confidence })

  const candidates = await evaluate({ ...album, artist, title }, files, summaries, rules, 2)
  // Third fetch only when the first two weren't convincing.
  if (candidates[0] && candidates[0].confidence < rules.autoAcceptThreshold) {
    const next = candidates.find((c) => !c.alignment)
    if (next) {
      const full = await getRelease(next.release.id)
      const scored = scoreRelease(album, files, full, rules)
      Object.assign(next, { release: full, full, ...scored })
      candidates.sort((a, b) => b.confidence - a.confidence)
    }
  }
  applyResult(album, candidates, rules, dupes)
  putAlbum(root, album)
  emit({ type: 'album', id })
}

/** Evaluate a single specific release (from a pasted URL, an edition, or a candidate) and add it to the pool. */
export async function addCandidate(root: string, id: string, releaseId: string, source: Candidate['source'], rules: Rules) {
  const album = getAlbum(id)
  if (!album) throw new Error('Album not found')
  const { keep: files } = splitDuplicateFiles(albumFiles(id))
  const full = await getRelease(releaseId)
  const { alignment, confidence } = scoreRelease(album, files, full, rules)
  album.candidates = [
    { release: stripTracks(full), confidence, alignment, source },
    ...album.candidates.filter((c) => c.release.id !== releaseId),
  ].sort((a, b) => b.confidence - a.confidence)
  putAlbum(root, album)
  emit({ type: 'album', id })
  return { release: full, alignment, confidence }
}

/** User decision: lock this release in. */
export async function chooseRelease(root: string, id: string, releaseId: string, rules: Rules) {
  const { release, alignment, confidence } = await addCandidate(root, id, releaseId, 'manual', rules)
  const album = getAlbum(id)!
  album.chosen = stripTracks(release)
  album.release = release
  album.alignment = alignment
  album.confidence = confidence
  album.status = 'accepted'
  album.issues = [
    ...album.issues.filter((i) => i.kind === 'untagged' || i.kind === 'duplicate-files'),
    ...issuesFor(release, alignment, confidence, rules).filter((i) => i.kind !== 'low-confidence'),
  ]
  putAlbum(root, album)
  emit({ type: 'album', id })
}

/** Fingerprint a sample of files and add the releases AcoustID points to. */
export async function fingerprintAlbum(root: string, id: string, rules: Rules, progress?: (d: number, t: number, m?: string) => void) {
  const album = getAlbum(id)
  if (!album) throw new Error('Album not found')
  const { keep: files } = splitDuplicateFiles(albumFiles(id))
  const sample = files.length <= 5 ? files : [0, 0.25, 0.5, 0.75, 1].map((p) => files[Math.round(p * (files.length - 1))])
  const releaseVotes = new Map<string, number>()
  const singles: AlbumRow['singles'] = {}
  for (const [i, f] of sample.entries()) {
    progress?.(i, sample.length, path.basename(f.path))
    const results = await lookup(await fingerprint(f.path))
    const best = results.sort((a, b) => b.score - a.score)[0]
    if (!best || best.score < 0.5) continue
    for (const rec of best.recordings) {
      for (const r of rec.releases ?? []) releaseVotes.set(r.id, (releaseVotes.get(r.id) ?? 0) + best.score)
    }
    const rec = best.recordings.find((r) => r.title)
    if (rec) singles[f.path] = { recordingId: rec.id, title: rec.title!, artist: rec.artists?.map((a) => a.name).join(', ') ?? '', artistId: rec.artists?.[0]?.id ?? null, year: null }
  }
  album.singles = { ...album.singles, ...singles }
  putAlbum(root, album)
  const top = [...releaseVotes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)
  for (const [rid] of top) await addCandidate(root, id, rid, 'fingerprint', rules)
  const updated = getAlbum(id)!
  const best = updated.candidates[0]
  if (best && updated.status !== 'accepted') {
    updated.confidence = best.confidence
    updated.issues = updated.issues.filter((i) => i.kind !== 'no-candidates' && i.kind !== 'untagged')
    if (updated.status === 'unmatched') updated.status = 'review'
    putAlbum(root, updated)
  }
  emit({ type: 'album', id })
  return { releases: top.length, recordings: Object.keys(singles).length }
}

/** Treat files as standalone recordings: find each one on MusicBrainz by fingerprint or tags. */
export async function resolveSingles(root: string, id: string) {
  const album = getAlbum(id)
  if (!album) throw new Error('Album not found')
  const files = albumFiles(id)
  for (const f of files) {
    if (album.singles[f.path]) continue
    const recs = await searchRecordings(f.tags.artist ?? album.artist, fileTitle(f))
    const r = recs[0]
    if (r && similarity(r.title, fileTitle(f)) > 0.7)
      album.singles[f.path] = {
        recordingId: r.id,
        title: r.title,
        artist: r.artist,
        artistId: null,
        year: year(r.releases.map((x) => x.date).filter(Boolean).sort()[0]) || null,
      }
  }
  album.status = 'singles'
  putAlbum(root, album)
  emit({ type: 'album', id })
}

/** Albums that resolve to the same release group: keep the best copy, send the rest to review. */
export function flagDuplicateAlbums(root: string) {
  const albums = listAlbums(root)
  const byGroup = new Map<string, AlbumRow[]>()
  for (const a of albums) {
    const rg = a.chosen?.releaseGroupId
    if (!rg || a.status === 'leave' || a.status === 'duplicate') continue
    byGroup.set(rg, [...(byGroup.get(rg) ?? []), a])
  }
  for (const a of albums) {
    const before = a.issues.length
    a.issues = a.issues.filter((i) => i.kind !== 'duplicate-album')
    if (a.issues.length !== before) putAlbum(root, a)
  }
  for (const group of byGroup.values()) {
    if (group.length < 2) continue
    const scored = group
      .map((a) => {
        const files = albumFiles(a.id)
        return { a, q: files.reduce((s, f) => s + quality(f), 0) / Math.max(files.length, 1) + files.length * 10 }
      })
      .sort((x, y) => y.q - x.q)
    for (const { a } of scored.slice(1)) {
      a.issues.push({ kind: 'duplicate-album', message: `You have another copy of this album in “${scored[0].a.folder}”.` })
      if (a.status === 'matched') a.status = 'review'
      putAlbum(root, a)
    }
  }
}

export async function matchAll(root: string, rules: Rules, progress: (d: number, t: number, m?: string) => void) {
  const todo = listAlbums(root).filter((a) => a.status === 'pending')
  for (const [i, a] of todo.entries()) {
    progress(i, todo.length, `${a.artist} — ${a.title}`)
    try {
      await matchAlbum(root, a.id, rules)
    } catch (e) {
      a.status = 'unmatched'
      a.issues = [...a.issues, { kind: 'no-candidates', message: `Lookup failed: ${e instanceof Error ? e.message : e}` }]
      putAlbum(root, a)
    }
  }
  flagDuplicateAlbums(root)
  progress(todo.length, todo.length, 'Done')
  emit({ type: 'albums' })
}
