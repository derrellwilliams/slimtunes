// Tiny valid audio files for tests and demos — no ffmpeg needed.
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { File } from 'node-taglib-sharp'

/** Silent MPEG-1 Layer III, 32 kbps / 44.1 kHz mono: 104-byte frames, ~38.28 frames per second. */
export function silentMp3(seconds: number): Buffer {
  const frame = Buffer.alloc(104)
  frame.writeUInt32BE(0xfffb10c4) // sync, MPEG1, L3, no CRC, 32kbps, 44.1kHz, no pad, mono
  const frames = Math.max(1, Math.round(seconds * 38.28125))
  return Buffer.concat(Array.from({ length: frames }, () => frame))
}

/** 8 kHz 8-bit mono PCM WAV of silence. */
export function silentWav(seconds: number): Buffer {
  const n = Math.round(seconds * 8000)
  const h = Buffer.alloc(44)
  h.write('RIFF', 0)
  h.writeUInt32LE(36 + n, 4)
  h.write('WAVEfmt ', 8)
  h.writeUInt32LE(16, 16)
  h.writeUInt16LE(1, 20)
  h.writeUInt16LE(1, 22)
  h.writeUInt32LE(8000, 24)
  h.writeUInt32LE(8000, 28)
  h.writeUInt16LE(1, 32)
  h.writeUInt16LE(8, 34)
  h.write('data', 36)
  h.writeUInt32LE(n, 40)
  return Buffer.concat([h, Buffer.alloc(n, 0x80)])
}

export interface FixtureTags {
  title?: string
  artist?: string
  albumArtist?: string
  album?: string
  track?: number
  disc?: number
  year?: number
}

export function writeAudio(file: string, seconds: number, tags: FixtureTags = {}) {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, file.endsWith('.wav') ? silentWav(seconds) : silentMp3(seconds))
  if (!Object.keys(tags).length) return
  const f = File.createFromPath(file)
  const t = f.tag
  if (tags.title) t.title = tags.title
  if (tags.artist) t.performers = [tags.artist]
  if (tags.albumArtist) t.albumArtists = [tags.albumArtist]
  if (tags.album) t.album = tags.album
  if (tags.track) t.track = tags.track
  if (tags.disc) t.disc = tags.disc
  if (tags.year) t.year = tags.year
  f.save()
  f.dispose()
}
