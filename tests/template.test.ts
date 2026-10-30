import { describe, expect, it } from 'vitest'
import { renderTemplate, sanitizeSegment } from '../server/template.ts'
import { normalize, similarity, titleFromFilename } from '../server/text.ts'

describe('renderTemplate', () => {
  it('fills tokens and pads numbers', () => {
    expect(renderTemplate('{albumartist}/{album} ({year})/{track:02} - {title}', { albumartist: 'Daft Punk', album: 'Discovery', year: '2001', track: 3, title: 'Digital Love' })).toBe(
      'Daft Punk/Discovery (2001)/03 - Digital Love',
    )
  })
  it('drops empty optional sections and empty parens', () => {
    expect(renderTemplate('{album} ({year})/[{disc}-]{track:02}', { album: 'X', year: '', disc: '', track: 1 })).toBe('X/01')
  })
  it('never lets a value create extra folders', () => {
    expect(renderTemplate('{artist}/{title}', { artist: 'AC/DC', title: 'Back: In Black?' })).toBe('AC-DC/Back - In Black')
  })
})

describe('sanitizeSegment', () => {
  it('strips leading dots and trailing dots/spaces', () => {
    expect(sanitizeSegment('..hidden. ')).toBe('hidden')
  })
  it('caps very long names', () => {
    expect(Buffer.byteLength(sanitizeSegment('a'.repeat(400)))).toBeLessThanOrEqual(180)
  })
  it('falls back to _ for empty names', () => {
    expect(sanitizeSegment('???')).toBe('_')
  })
})

describe('text', () => {
  it('normalizes accents, punctuation and edition noise', () => {
    expect(normalize('Beyoncé — Lemonade (Deluxe Edition)')).toBe('beyonce lemonade')
  })
  it('scores near-identical titles highly', () => {
    expect(similarity('Harder, Better, Faster, Stronger', 'harder better faster stronger')).toBe(1)
    expect(similarity('Airbag', 'Karma Police')).toBeLessThan(0.4)
  })
  it('extracts titles from filenames', () => {
    expect(titleFromFilename('03 - Digital Love.mp3')).toBe('Digital Love')
    expect(titleFromFilename('1-08 Get Lucky.flac')).toBe('Get Lucky')
  })
})
