// Builds a deliberately messy library for trying SlimTunes end to end.
// Usage: npm run fixtures -- /tmp/slimtunes-demo
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { writeAudio } from './fixture-audio.ts'

const out = path.resolve(process.argv[2] ?? 'fixtures-library')
mkdirSync(out, { recursive: true })

const m = (s: string) => s.split(':').reduce((a, b) => a * 60 + Number(b), 0)

// 1. A full album with sloppy names, a .cue and an old cover — should auto-match.
const discovery = [
  ['One More Time', '5:20'], ['Aerodynamic', '3:27'], ['Digital Love', '4:58'], ['Harder, Better, Faster, Stronger', '3:44'],
  ['Crescendolls', '3:31'], ['Nightvision', '1:44'], ['Superheroes', '3:57'], ['High Life', '3:22'], ['Something About Us', '3:51'],
  ['Voyager', '3:47'], ['Veridis Quo', '5:45'], ['Short Circuit', '3:26'], ['Face to Face', '4:00'], ['Too Long', '10:00'],
] as const
discovery.forEach(([title, len], i) =>
  writeAudio(path.join(out, 'daft punk - discovery', `${String(i + 1).padStart(2, '0')} ${title.toLowerCase()}.mp3`), m(len), {
    title: title.toLowerCase(),
    artist: 'daft punk',
    album: 'discovery',
    track: i + 1,
  }),
)
writeFileSync(path.join(out, 'daft punk - discovery', 'discovery.cue'), 'REM fake cue\n')
writeFileSync(path.join(out, 'daft punk - discovery', 'folder.jpg'), 'not really a jpeg')

// 2. A lossless duplicate of one track sitting next to the MP3.
writeAudio(path.join(out, 'daft punk - discovery', '01 one more time.wav'), m('5:20'), { title: 'One More Time', artist: 'Daft Punk', album: 'discovery', track: 1 })

// 3. A partial album — 4 of 12 tracks.
const okc = [['Airbag', '4:44', 1], ['Paranoid Android', '6:23', 2], ['Karma Police', '4:21', 6], ['No Surprises', '3:49', 10]] as const
for (const [title, len, n] of okc)
  writeAudio(path.join(out, 'Music', 'Radiohead', 'OK Computer', `${n} - ${title}.mp3`), m(len), { title, artist: 'Radiohead', album: 'OK Computer', track: n })

// 4. Untagged files — need fingerprinting or a manual search.
writeAudio(path.join(out, 'unsorted', 'track01.mp3'), 200)
writeAudio(path.join(out, 'unsorted', 'track02.mp3'), 185)

// 5. A second copy of Discovery elsewhere — duplicate album.
discovery.slice(0, 3).forEach(([title, len], i) =>
  writeAudio(path.join(out, 'old ipod', 'Discovery', `${i + 1}.mp3`), m(len), { title, artist: 'Daft Punk', album: 'Discovery', track: i + 1 }),
)

console.log(`Fixture library written to ${out}`)
