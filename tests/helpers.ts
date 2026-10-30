import type { Release, ReleaseTrack, TrackFile } from '../shared/types.ts'

export function track(disc: number, position: number, title: string, length: number, artist = 'Daft Punk'): ReleaseTrack {
  return { id: `t${disc}-${position}`, recordingId: `r${disc}-${position}`, disc, position, title, artist, artistIds: ['a1'], length }
}

export function release(tracks: ReleaseTrack[], over: Partial<Release> = {}): Release {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    title: 'Discovery',
    artist: 'Daft Punk',
    artistIds: ['a1'],
    date: '2001-03-12',
    originalDate: '2001-03-12',
    country: 'GB',
    formats: ['CD'],
    trackCount: tracks.length,
    discCount: new Set(tracks.map((t) => t.disc)).size,
    releaseGroupId: 'rg1',
    primaryType: 'Album',
    secondaryTypes: [],
    status: 'Official',
    barcode: null,
    disambiguation: null,
    label: 'Virgin',
    tracks,
    ...over,
  }
}

export function file(p: string, title: string | undefined, duration: number, extra: Partial<TrackFile['tags']> = {}, format = 'mp3'): TrackFile {
  return { path: p, rel: p.replace(/^\/lib\//, ''), format, lossless: format === 'flac' || format === 'wav', bitrate: 320, duration, size: 1, tags: { title, ...extra } }
}
