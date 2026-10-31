# SlimTunes

Local web app that scans a music folder, matches albums to MusicBrainz, walks the user through anything uncertain, and organizes files into `Artist/Album (Year)/NN - Title.ext` with clean tags, MBIDs, genres and Cover Art Archive art. Every run is journaled and undoable. Scope is deliberately narrow (clean up → match → organize). Don't add Lidarr/Picard-style features without asking.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | API on :4747 (node --watch) + Vite UI on :5173 |
| `npm run build` | Typecheck + build UI to `dist/` (the server serves it) |
| `npm start` | Run the server (opens the browser; prints link if already running) |
| `npm test` | Vitest: unit tests + offline apply/undo round trips |
| `npm run typecheck` / `npm run lint` | `tsc -b` / oxlint |
| `npm run fixtures -- <dir>` | Generate a messy fake library (silent MP3/WAV, no ffmpeg) |
| `npm run service -- install\|uninstall\|restart\|status` | macOS LaunchAgent `com.slimtunes.server` |

The user's copy runs as the LaunchAgent from this repo. After changes: `npm run build && npm run service -- restart`. Log: `~/.slimtunes/server.log`.

## Stack

- **Server:** Node ≥ 23.6 running `.ts` directly (type stripping, so `erasableSyntaxOnly` applies: no enums or parameter properties). Imports use `.ts` extensions. Hono + `@hono/node-server`, built-in `node:sqlite`, `music-metadata` (read), `node-taglib-sharp` (write), chokidar (inbox).
- **UI:** Vite + React 19 + Tailwind v4 + shadcn **base-nova** style. These are **Base UI**, not Radix: use `render={<Button/>}`, not `asChild`, and `Select` needs `items`. Dark theme, Geist. Hash routing in `src/lib/app.tsx`.
- **Shared types:** `shared/types.ts` (imported by both sides).

## Server layout (`server/`)

| File | Role |
|---|---|
| `index.ts` | Routes, security middleware, startup (recover interrupted runs → auto-rescan) |
| `scanner.ts` | Walk + incremental read (mtime/size cache) → `regroup()` into albums. Key: MBID, else album tag + folder (Disc N collapsed), else folder. Carries decisions across key changes. |
| `musicbrainz.ts` | 1 req/s throttle, 30-day SQLite cache, UA is the project URL |
| `matcher.ts` | `align()` (greedy file↔track), `scoreRelease()`, issues, duplicates, fingerprint, singles |
| `planner.ts` | Builds `ExecPlan` (ops: tags, move, art, rmdir). Also re-checks `applied` albums. Skips up-to-date files. |
| `applier.ts` | Executes the plan with a journal; `undoRun()`; `recoverInterruptedRuns()` |
| `tagger.ts` | Sync taglib writes (temp copy + atomic rename) and snapshots for undo. **Only call via `tags-async.ts`**, which runs it in `tag-worker.ts` so the event loop never blocks. |
| `cleanup.ts` | `isJunk` (incl. `._*`), async `emptyDirs` (skips hidden dirs) |
| `coverart.ts` | CAA fetch + disk cache. A `.missing` marker is trusted for 30 days. |
| `safepath.ts` | `assertInside(root, p)`. Every file op must go through it. |
| `paths.ts` / `config.ts` | `~/.slimtunes` dirs / config.json (token, settings, rules, mode 600) |

## Invariants: don't break these

- **Never block the event loop with file I/O.** Tag I/O goes through the worker. Long walks use `fs/promises`. Slow USB drives (FAT32) made the server look dead before this rule existed.
- **Every change to the user's library is a journaled op in the plan**, shown in the preview and undoable. No silent deletes on scan. The only exception is our own stale `.slimtunes-<hex>.<ext>` temp files.
- **Never delete user files.** Duplicates go to `_duplicates/`, extras to `_leftovers/`. Hidden folders are never touched.
- **Files already in an album's destination folder (incl. our `cover.jpg`) are never moved as leftovers.**
- **Re-runs must converge:** after an apply, a fresh preview must show 0 ops. If it doesn't, a comparison in `planner.ts` (`changes()`, `genreKey()`, the `upToDate` check) is wrong. Fix the comparison, don't force rewrites.
- **Security:** bind `127.0.0.1` only. Token header (or `?t=` for SSE) plus Host/Origin allowlist. Never send the user's email to external services. Never commit tokens or `~/.slimtunes` contents.

## Testing

- Tests use an isolated `SLIMTUNES_HOME` (see `vitest.config.ts`) and run files serially (shared SQLite).
- No network in tests. Fake a match by `putAlbum(...{ status: 'accepted', release, alignment: align(files, release) })`.
- For real end-to-end checks, run a second server with `SLIMTUNES_HOME=$(mktemp -d) PORT=4798 node server/index.ts` against fixtures. **Never kill the user's server with broad `pkill` patterns.** Target the test PID.
- Don't use headless browsers or the user's browser unless asked. Drive the API instead.

## Known gaps / next up

- Design pass (reference: polar.sh) is the next planned work.
- Inbox watching and AcoustID fingerprinting have not been exercised on real data.
- Only the most recent run can be undone.
- `npx slimtunes` (running outside the repo) is untested.
