import { describe, expect, it } from 'vitest'
import { DEFAULT_RULES } from '../server/config.ts'
import { align, scoreRelease, splitDuplicateFiles } from '../server/matcher.ts'
import { file, release, track } from './helpers.ts'

const rel = release([track(1, 1, 'One More Time', 320), track(1, 2, 'Aerodynamic', 207), track(1, 3, 'Digital Love', 298)])

describe('align', () => {
  it('maps files to tracks by title and duration, regardless of order', () => {
    const files = [file('/lib/c.mp3', 'digital love', 299), file('/lib/a.mp3', 'one more time', 321), file('/lib/b.mp3', 'aerodynamic', 207)]
    const out = align(files, rel)
    expect(out.map((a) => a.trackId)).toEqual(['t1-3', 't1-1', 't1-2'])
  })
  it('uses durations and positions when files are untagged', () => {
    const files = [file('/lib/01.mp3', undefined, 320, { track: 1 }), file('/lib/02.mp3', undefined, 207, { track: 2 })]
    expect(align(files, rel).map((a) => a.trackId)).toEqual(['t1-1', 't1-2'])
  })
  it('leaves unrelated files unmatched', () => {
    expect(align([file('/lib/x.mp3', 'Paranoid Android', 383)], rel)[0].trackId).toBeNull()
  })
})

describe('scoreRelease', () => {
  const album = { title: 'discovery', artist: 'daft punk' }
  it('is confident for a complete, well-tagged album', () => {
    const files = [file('/lib/1.mp3', 'One More Time', 320), file('/lib/2.mp3', 'Aerodynamic', 207), file('/lib/3.mp3', 'Digital Love', 298)]
    expect(scoreRelease(album, files, rel, DEFAULT_RULES).confidence).toBeGreaterThan(0.9)
  })
  it('is unsure about a partial album', () => {
    const files = [file('/lib/1.mp3', 'One More Time', 320)]
    expect(scoreRelease(album, files, rel, DEFAULT_RULES).confidence).toBeLessThan(0.9)
  })
})

describe('splitDuplicateFiles', () => {
  it('keeps the lossless copy', () => {
    const { keep, dupes } = splitDuplicateFiles([
      file('/lib/1.mp3', 'One More Time', 320, { track: 1 }),
      file('/lib/1.wav', 'One More Time', 320, { track: 1 }, 'wav'),
      file('/lib/2.mp3', 'Aerodynamic', 207, { track: 2 }),
    ])
    expect(keep.map((f) => f.path).sort()).toEqual(['/lib/1.wav', '/lib/2.mp3'])
    expect(dupes.map((f) => f.path)).toEqual(['/lib/1.mp3'])
  })
})
