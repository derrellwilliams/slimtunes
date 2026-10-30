import { describe, expect, it } from 'vitest'
import { DEFAULT_RULES } from '../server/config.ts'
import { destFor, splitFeatured, VARIOUS_ARTISTS_ID } from '../server/planner.ts'
import { release, track } from './helpers.ts'

describe('destFor', () => {
  it('uses the default layout', () => {
    const r = release([track(1, 1, 'One More Time', 320)])
    expect(destFor(r, r.tracks[0], DEFAULT_RULES)).toBe('Daft Punk/Discovery (2001)/01 - One More Time')
  })
  it('prefers the original year', () => {
    const r = release([track(1, 1, 'A', 1)], { date: '2023-01-01', originalDate: '2013-05-17' })
    expect(destFor(r, r.tracks[0], DEFAULT_RULES)).toContain('(2013)')
    expect(destFor(r, r.tracks[0], { ...DEFAULT_RULES, release: { ...DEFAULT_RULES.release, preferOriginalYear: false } })).toContain('(2023)')
  })
  it('handles multi-disc as prefix or subfolder', () => {
    const r = release([track(1, 1, 'A', 1), track(2, 1, 'B', 1)])
    expect(destFor(r, r.tracks[1], DEFAULT_RULES)).toBe('Daft Punk/Discovery (2001)/2-01 - B')
    expect(destFor(r, r.tracks[1], { ...DEFAULT_RULES, multiDisc: 'subfolder' })).toBe('Daft Punk/Discovery (2001)/Disc 2/01 - B')
  })
  it('files compilations under Various Artists with per-track artists', () => {
    const r = release([track(1, 1, 'Song', 1, 'Someone')], { artist: 'Various Artists', artistIds: [VARIOUS_ARTISTS_ID], title: 'Now 1' })
    expect(destFor(r, r.tracks[0], DEFAULT_RULES)).toBe('Various Artists/Now 1 (2001)/01 - Someone - Song')
  })
  it('moves featured artists into the title', () => {
    const r = release([track(1, 8, 'Get Lucky', 1, 'Daft Punk feat. Pharrell Williams')])
    expect(destFor(r, r.tracks[0], DEFAULT_RULES)).toBe('Daft Punk/Discovery (2001)/08 - Get Lucky (feat. Pharrell Williams)')
  })
})

describe('splitFeatured', () => {
  it('splits common forms', () => {
    expect(splitFeatured('A ft. B')).toEqual({ main: 'A', featured: 'B' })
    expect(splitFeatured('A featuring B & C')).toEqual({ main: 'A', featured: 'B & C' })
    expect(splitFeatured('Simon & Garfunkel')).toEqual({ main: 'Simon & Garfunkel', featured: null })
  })
})
