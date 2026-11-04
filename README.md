# SlimTunes

<img width="1649" height="1075" alt="Screenshot 2026-11-03 at 8 06 06 PM" src="https://github.com/user-attachments/assets/1b9a27fd-0035-40d0-a4dc-f8dc3eb1e778" />


Clean up your music library, match it to [MusicBrainz](https://musicbrainz.org), and organize it into one folder per artist and album, with album art for everything.

It's a small, focused alternative to Lidarr and Picard. It does one job: **clean up → match → organize**.

## What it does

- **Scans** a folder of music (MP3, FLAC, M4A, OGG/Opus, WAV, AIFF, …) on your Mac, an external USB drive, or a network share
- **Matches** each album to MusicBrainz by track titles, durations and track count, and auto-accepts confident matches
- **Walks you through** anything that doesn't match exactly: partial albums, other editions, untagged files, duplicates, and whole albums ripped to one file with a `.cue` sheet
- **Organizes** into `Artist/Album (Year)/01 - Title.ext`, or a pattern you choose
- **Writes clean tags** plus MusicBrainz IDs (Picard-compatible), genres, and **album art** from the Cover Art Archive
- **Previews everything first**, and **undo** puts every file, name, tag and folder back
- **Cleans up after itself**: removes emptied and empty folders (including macOS `._` clutter on FAT/exFAT drives), sets lower-quality duplicates aside in `_duplicates`, and collects stray extras in `_leftovers`
- **Keeps your library tidy**: each preview re-checks already-organized albums, restores missing covers and applies rule changes. Anything already correct is skipped, so re-runs are fast even on slow USB drives.
- **Inbox**: watches a downloads folder and files new music automatically
- **Fingerprinting** (optional) identifies untagged files with [AcoustID](https://acoustid.org)

## Run it

Requires Node.js 23.6 or newer (runs on Apple Silicon and Intel Macs). On an Intel Mac without Homebrew, install Node from the [nodejs.org installer](https://nodejs.org) and git with `xcode-select --install`.

```sh
git clone https://github.com/derrellwilliams/slimtunes
cd slimtunes
npm install
npm run build
npm start          # opens http://127.0.0.1:4747/?t=<private key>
```

If the page asks you to unlock it, paste the link printed in the terminal (it contains the private key). Your browser remembers it.

### Keep it running (macOS)

Run SlimTunes as a background service so it starts at login and restarts if it crashes:

```sh
npm run service -- install    # also: uninstall | restart | status
npm run open                  # open SlimTunes in your browser
```

The service runs straight from this folder, so after pulling changes run `npm run build && npm run service -- restart`. Logs go to `~/.slimtunes/server.log`. If the service is already running, `npm start` just prints the link instead of starting a second copy.

### Using it from another computer

It only listens on `127.0.0.1`. The simplest option is to install it on the Mac that has the music. To reach it from another machine, use an SSH tunnel (turn on Remote Login on the Mac running SlimTunes):

```sh
ssh -N -L 4747:127.0.0.1:4747 you@your-mac.local
```

Then open the same `http://127.0.0.1:4747/?t=…` link on the other computer.

### Development

- `npm run dev` runs the API on :4747 and the UI on :5173, with the link printed in the terminal.
- To try it on a fake messy library: `npm run fixtures -- /tmp/slimtunes-demo`, then point SlimTunes at that folder.
- Optional, for fingerprinting: `brew install chromaprint`, then add a free AcoustID key in Settings.

## How it stays safe

- Runs only on your machine and listens on `127.0.0.1`. Every API call needs the private key from the startup link, and requests from other websites are rejected (Host/Origin checks against DNS rebinding and CSRF).
- Every file operation is checked to stay inside your library folder (no `..` or symlink escapes). Hidden folders belonging to other apps (`.stfolder`, `.git`, …) are never touched.
- Tags are written to a temporary copy and swapped in atomically, so a crash can't corrupt a file. Leftover temp copies from an interrupted run are removed on the next scan.
- Every change, including folder clean-up, is journaled and shown in the preview first. Undo restores paths, tags, embedded art and folders. Runs interrupted by a crash or restart are marked as stopped (still undoable), and the library is rescanned automatically.
- Tag writing runs in a background thread, so the app stays responsive during long runs on slow drives.
- SlimTunes never deletes your music or your own files. Duplicates and extras are moved, not removed. Delete `_duplicates` and `_leftovers` yourself once you're happy.
- Settings, cache and the AcoustID key live in `~/.slimtunes` (mode 600), never in this repo. MusicBrainz is contacted with the project URL as the contact, never your email.

## Tests

```sh
npm test        # unit tests + offline apply → undo round trips on real (silent) audio files
npm run typecheck
```
