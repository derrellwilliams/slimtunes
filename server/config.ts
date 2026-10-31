import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Rules, Settings } from '../shared/types.ts'
import { DATA_DIR } from './paths.ts'

export { ART_DIR, BLOB_DIR, DATA_DIR } from './paths.ts'
const CONFIG_PATH = path.join(DATA_DIR, 'config.json')

export const DEFAULT_RULES: Rules = {
  folderTemplate: '{albumartist}/{album} ({year})',
  fileTemplate: '{track:02} - {title}',
  compilationFolderTemplate: 'Various Artists/{album} ({year})',
  compilationFileTemplate: '{track:02} - {artist} - {title}',
  singlesTemplate: '{artist}/Singles/{title}',
  multiDisc: 'prefix',
  featuredArtists: 'title',
  release: { preferOriginalYear: true, country: '', format: 'any' },
  art: { embed: true, saveFile: true, fileName: 'cover.jpg', size: '1200' },
  leftovers: 'move-with-album',
  removeEmptyFolders: true,
  duplicates: 'move-to-duplicates',
  genres: { enabled: true, max: 3 },
  autoAcceptThreshold: 0.9,
}

interface ConfigFile {
  token: string
  settings: Settings
  rules: Rules
}

function load(): ConfigFile {
  const fallback: ConfigFile = {
    token: randomBytes(24).toString('base64url'),
    settings: { libraryRoot: null, acoustidKey: '', inbox: { enabled: false, path: '', autoApply: true } },
    rules: DEFAULT_RULES,
  }
  if (!existsSync(CONFIG_PATH)) return fallback
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as Partial<ConfigFile>
    return {
      token: raw.token || fallback.token,
      settings: { ...fallback.settings, ...raw.settings, inbox: { ...fallback.settings.inbox, ...raw.settings?.inbox } },
      rules: mergeRules(raw.rules),
    }
  } catch {
    return fallback
  }
}

export function mergeRules(r: Partial<Rules> | undefined): Rules {
  const d = DEFAULT_RULES
  return {
    ...d,
    ...r,
    release: { ...d.release, ...r?.release },
    art: { ...d.art, ...r?.art },
    genres: { ...d.genres, ...r?.genres },
  }
}

export const config = load()
save()

export function save() {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 })
  chmodSync(CONFIG_PATH, 0o600)
}
