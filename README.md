# SlimTunes

<img width="1560" height="921" alt="Screenshot 2026-10-30 at 3 41 49 PM" src="https://github.com/user-attachments/assets/4e8bccb0-d7b9-4d13-a970-ee2081b9dea4" />
<img width="1551" height="927" alt="Screenshot 2026-10-30 at 3 43 14 PM" src="https://github.com/user-attachments/assets/3cef759b-324f-40aa-9b3c-ea3f3702c0d0" />


Clean up your music library, match it to [MusicBrainz](https://musicbrainz.org), and organize it into one folder per artist and album, with album art for everything.

It's a small, focused alternative to Lidarr and Picard. It does one job: **clean up → match → organize**.

## What it does

- **Scans** a folder of music (MP3, FLAC, M4A, OGG/Opus, WAV, AIFF, …)
- **Matches** each album to MusicBrainz by track titles, durations and track count, and auto-accepts confident matches
- **Walks you through** anything that doesn't match exactly: partial albums, other editions, untagged files, duplicates
- **Organizes** into `Artist/Album (Year)/01 - Title.ext`, or a pattern you choose
- **Writes clean tags** plus MusicBrainz IDs (Picard-compatible), genres, and **album art** from the Cover Art Archive
- **Previews everything first**, and **undo** puts every file, name, tag and folder back
- **Inbox**: watches a downloads folder and files new music automatically
- **Fingerprinting** (optional) identifies untagged files with [AcoustID](https://acoustid.org)

## Run it

Requires Node.js 23.6 or newer.

```sh
git clone https://github.com/derrellwilliams/slimtunes
cd slimtunes
npm install
npm run build
npm start          # opens http://127.0.0.1:4747/?t=<private key>
```

For development: `npm run dev` (API on :4747, UI on :5173, with the link printed in the terminal).

To try it on a fake messy library: `npm run fixtures -- /tmp/slimtunes-demo`, then point SlimTunes at that folder.

Optional, for fingerprinting: `brew install chromaprint`, then add a free AcoustID key in Settings.

## How it stays safe

- Runs only on your machine and listens on `127.0.0.1`. Every API call needs the private key from the startup link, and requests from other websites are rejected (Host/Origin checks against DNS rebinding and CSRF).
- Every file operation is checked to stay inside your library folder (no `..` or symlink escapes).
- Tags are written to a temporary copy and swapped in atomically, so a crash can't corrupt a file.
- Every change is journaled. Undo restores paths, tags, embedded art and folders.
- Settings, cache and the AcoustID key live in `~/.slimtunes` (mode 600), never in this repo.

## Tests

```sh
npm test        # unit tests + an offline apply → undo round trip on real audio files
npm run typecheck
```
