import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseFile } from 'music-metadata'
import { describe, expect, it } from 'vitest'
import { writeAudio } from '../scripts/fixture-audio.ts'
import { applyPlan, undoRun } from '../server/applier.ts'
import { DEFAULT_RULES } from '../server/config.ts'
import { albumFiles, getAlbum, listAlbums, putAlbum } from '../server/db.ts'
import { align } from '../server/matcher.ts'
import { buildPlan } from '../server/planner.ts'
import { scanLibrary } from '../server/scanner.ts'
import { assertInside } from '../server/safepath.ts'
import { release, track } from './helpers.ts'

const noop = () => {}
const rules = { ...DEFAULT_RULES, art: { ...DEFAULT_RULES.art, embed: false, saveFile: false }, genres: { enabled: false, max: 0 } }

function tree(dir: string, base = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? tree(path.join(dir, e.name), base) : [path.relative(base, path.join(dir, e.name))],
  )
}

describe('apply + undo', () => {
  it('organizes files, writes tags, and undo restores everything exactly', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'slimtunes-lib-'))
    writeAudio(path.join(root, 'dp - disc', '01 one more time.mp3'), 320, { title: 'one more time', artist: 'daft punk', album: 'discovery', track: 1 })
    writeAudio(path.join(root, 'dp - disc', '02 aerodynamic.mp3'), 207, { title: 'aerodynamic', artist: 'daft punk', album: 'discovery', track: 2 })
    writeAudio(path.join(root, 'dp - disc', '01 one more time.wav'), 320, { title: 'one more time', artist: 'daft punk', album: 'discovery', track: 1 })
    writeFileSync(path.join(root, 'dp - disc', 'notes.cue'), 'cue')
    const before = tree(root).sort()
    const beforeBytes = readFileSync(path.join(root, 'dp - disc', '02 aerodynamic.mp3'))

    await scanLibrary(root, noop)
    const [album] = listAlbums(root)
    expect(album.title).toBe('discovery')

    // Pretend the matcher picked this release (no network in tests).
    const rel = release([track(1, 1, 'One More Time', 320), track(1, 2, 'Aerodynamic', 207)])
    const files = albumFiles(album.id)
    const mp3 = files.find((f) => f.path.endsWith('one more time.mp3'))!
    const kept = files.filter((f) => f !== mp3)
    putAlbum(root, { ...album, status: 'accepted', release: rel, chosen: rel, alignment: align(kept, rel), duplicateFiles: [mp3.path] })

    const plan = await buildPlan({ srcRoot: root, destRoot: root, rules, genres: async () => [] })
    expect(plan.counts.duplicates).toBe(1)
    const runId = await applyPlan(plan, rules, 'manual', noop)

    const after = tree(root).sort()
    expect(after).toEqual([
      'Daft Punk/Discovery (2001)/01 - One More Time.wav',
      'Daft Punk/Discovery (2001)/02 - Aerodynamic.mp3',
      'Daft Punk/Discovery (2001)/notes.cue',
      '_duplicates/dp - disc/01 one more time.mp3',
    ])
    const tagged = await parseFile(path.join(root, 'Daft Punk/Discovery (2001)/02 - Aerodynamic.mp3'))
    expect(tagged.common.title).toBe('Aerodynamic')
    expect(tagged.common.album).toBe('Discovery')
    expect(tagged.common.musicbrainz_albumid).toBe(rel.id)
    expect(getAlbum(album.id)?.status).toBe('applied')
    expect(existsSync(path.join(root, 'dp - disc'))).toBe(false)

    const { missing } = await undoRun(runId, noop)
    expect(missing).toEqual([])
    expect(tree(root).sort()).toEqual(before)
    const restored = await parseFile(path.join(root, 'dp - disc', '02 aerodynamic.mp3'))
    expect(restored.common.title).toBe('aerodynamic')
    expect(restored.common.musicbrainz_albumid).toBeUndefined()
    expect(readFileSync(path.join(root, 'dp - disc', '02 aerodynamic.mp3')).length).toBeGreaterThan(beforeBytes.length * 0.9)
    expect(getAlbum(album.id)?.status).toBe('accepted')
  })
})

describe('assertInside', () => {
  it('rejects paths that escape the library', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'slimtunes-safe-'))
    expect(() => assertInside(root, path.join(root, '..', 'etc'))).toThrow()
    expect(assertInside(root, path.join(root, 'a', 'b.mp3'))).toBe(path.join(root, 'a', 'b.mp3'))
  })
})

describe('rescan after apply, then undo', () => {
  it('keeps the organized status across a rescan and leaves no stale albums after undo', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'slimtunes-lib-'))
    writeAudio(path.join(root, 'x', '1.mp3'), 100, { title: 'A', artist: 'Band', album: 'Record', track: 1 })
    await scanLibrary(root, noop)
    const [album] = listAlbums(root)
    const rel = release([track(1, 1, 'A', 100, 'Band')], { id: '22222222-2222-2222-2222-222222222222', artist: 'Band', title: 'Record' })
    putAlbum(root, { ...album, status: 'accepted', release: rel, chosen: rel, alignment: align(albumFiles(album.id), rel) })
    const runId = await applyPlan(await buildPlan({ srcRoot: root, destRoot: root, rules, genres: async () => [] }), rules, 'manual', noop)

    await scanLibrary(root, noop) // MBIDs are now in the tags, so the album gets a new grouping key
    expect(listAlbums(root).map((a) => a.status)).toEqual(['applied'])

    await undoRun(runId, noop)
    const after = listAlbums(root)
    expect(after).toHaveLength(1)
    expect(after[0].status).toBe('accepted')
    expect(tree(root)).toEqual(['x/1.mp3'])
  })
})
