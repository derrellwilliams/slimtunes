import { ArrowDown, Check, RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { Rules } from '../../shared/types'
import { ChoiceCards, Field, SimpleSelect, SwitchField } from '@/components/fields'
import { PageHeader, Section } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import { useApp } from '@/lib/app'

const PRESETS = [
  { value: 'standard', folder: '{albumartist}/{album} ({year})', file: '{track:02} - {title}', title: 'Artist / Album (Year) / 01 - Title', description: 'Recommended. Works with Plex, Jellyfin, Navidrome and Music.app.' },
  { value: 'year-first', folder: '{albumartist}/{year} - {album}', file: '{track:02} - {title}', title: 'Artist / Year - Album / 01 - Title', description: 'Albums sort chronologically in Finder.' },
  { value: 'minimal', folder: '{albumartist}/{album}', file: '{track:02} {title}', title: 'Artist / Album / 01 Title', description: 'Shortest paths.' },
] as const

const TOKENS = ['albumartist', 'artist', 'album', 'year', 'originalyear', 'track:02', 'tracktotal', 'disc', 'disctotal', 'title', 'type', 'country', 'label']

export function RulesPage() {
  const { state } = useApp()
  const [rules, setRules] = useState<Rules>(state!.rules)
  const [saved, setSaved] = useState(true)
  const [preview, setPreview] = useState<{ from: string; to: string }[]>([])
  const first = useRef(true)

  // Auto-save + live preview, debounced.
  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        setPreview(await api('/rules/preview', { body: rules }))
        if (!first.current) {
          await api('/rules', { method: 'PUT', body: rules })
          setSaved(true)
        }
        first.current = false
      } catch (e) {
        toast.error((e as Error).message)
      }
    }, 350)
    return () => clearTimeout(t)
  }, [rules])

  const set = (patch: Partial<Rules>) => {
    setSaved(false)
    setRules((r) => ({ ...r, ...patch }))
  }
  const [customOpen, setCustomOpen] = useState(false)
  const matchedPreset = PRESETS.find((p) => p.folder === rules.folderTemplate && p.file === rules.fileTemplate)?.value
  const preset = customOpen || !matchedPreset ? 'custom' : matchedPreset

  return (
    <>
      <PageHeader
        title="Rules"
        description="How your library should look. Changes save automatically and only take effect when you apply."
        actions={
          <>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">{saved ? <><Check className="size-3.5" /> Saved</> : 'Saving…'}</span>
            <Button
              variant="ghost"
              onClick={async () => {
                setRules(await api<Rules>('/rules/reset', { body: {} }))
                toast.success('Rules reset to defaults')
              }}
            >
              <RotateCcw /> Reset
            </Button>
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Section title="Folder & file names" description="Every album gets its own folder inside its artist’s folder. Names come straight from MusicBrainz.">
            <ChoiceCards
              value={preset}
              onChange={(v) => {
                const p = PRESETS.find((x) => x.value === v)
                setCustomOpen(!p)
                if (p) set({ folderTemplate: p.folder, fileTemplate: p.file })
              }}
              options={[...PRESETS.map((p) => ({ value: p.value as string, title: <span className="font-mono text-[13px]">{p.title}</span>, description: p.description })), { value: 'custom', title: 'Custom', description: 'Write your own pattern.' }]}
            />
            {preset === 'custom' && (
              <div className="mt-4 space-y-3">
                <TemplateInput label="Album folder" value={rules.folderTemplate} onChange={(v) => set({ folderTemplate: v })} />
                <TemplateInput label="File name" value={rules.fileTemplate} onChange={(v) => set({ fileTemplate: v })} />
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Tokens: {TOKENS.map((t) => <code key={t} className="mr-1 rounded bg-muted px-1 py-0.5">{`{${t}}`}</code>)}
                  <br />
                  Wrap optional parts in square brackets — <code className="rounded bg-muted px-1">[{'{disc}'}-]</code> is dropped when empty.
                </p>
              </div>
            )}
          </Section>

          <Section title="Special cases">
            <div className="divide-y">
              <Field label="Multi-disc albums" hint="Where disc 2 goes.">
                <SimpleSelect
                  value={rules.multiDisc}
                  onChange={(v) => set({ multiDisc: v })}
                  options={[
                    { value: 'prefix', label: '1-01, 2-01 in one folder' },
                    { value: 'subfolder', label: 'Disc 1/, Disc 2/ folders' },
                  ]}
                />
              </Field>
              <Field label="Featured artists" hint={<>“Get Lucky” by Daft Punk feat. Pharrell</>}>
                <SimpleSelect
                  value={rules.featuredArtists}
                  onChange={(v) => set({ featuredArtists: v })}
                  options={[
                    { value: 'title', label: 'In the title (feat. …)' },
                    { value: 'artist', label: 'In the artist field' },
                  ]}
                />
              </Field>
              <Field label="Compilations" hint="Albums credited to Various Artists.">
                <Input className="w-72 font-mono text-xs" value={rules.compilationFolderTemplate} onChange={(e) => set({ compilationFolderTemplate: e.target.value })} />
              </Field>
              <Field label="Loose tracks" hint="Songs you chose to treat as singles.">
                <Input className="w-72 font-mono text-xs" value={rules.singlesTemplate} onChange={(e) => set({ singlesTemplate: e.target.value })} />
              </Field>
            </div>
          </Section>

          <Section title="Matching" description="Which version of an album to prefer when there are several (deluxe, remaster, regional).">
            <div className="divide-y">
              <SwitchField
                label="Use the original release year"
                hint="A 2023 remaster of a 2013 album is filed as 2013."
                checked={rules.release.preferOriginalYear}
                onChange={(v) => set({ release: { ...rules.release, preferOriginalYear: v } })}
              />
              <Field label="Preferred format">
                <SimpleSelect
                  value={rules.release.format}
                  onChange={(v) => set({ release: { ...rules.release, format: v } })}
                  options={[
                    { value: 'any', label: 'No preference' },
                    { value: 'digital', label: 'Digital' },
                    { value: 'cd', label: 'CD' },
                    { value: 'vinyl', label: 'Vinyl' },
                  ]}
                />
              </Field>
              <Field label="Preferred country" hint="Two-letter code, e.g. US, GB, JP. Leave empty for any.">
                <Input
                  className="w-24 text-center uppercase"
                  maxLength={2}
                  value={rules.release.country}
                  onChange={(e) => set({ release: { ...rules.release, country: e.target.value.toUpperCase() } })}
                />
              </Field>
              <Field label="Auto-accept matches above" hint="Anything below this comes to you for review.">
                <SimpleSelect
                  value={String(rules.autoAcceptThreshold)}
                  onChange={(v) => set({ autoAcceptThreshold: Number(v) })}
                  options={['0.8', '0.85', '0.9', '0.95'].map((v) => ({ value: v, label: `${Math.round(Number(v) * 100)}% confident` }))}
                />
              </Field>
            </div>
          </Section>

          <Section title="Album art" description="From the Cover Art Archive, which uses the same IDs as MusicBrainz.">
            <div className="divide-y">
              <SwitchField label="Embed in every file" hint="Shows up in any player, even outside this folder." checked={rules.art.embed} onChange={(v) => set({ art: { ...rules.art, embed: v } })} />
              <SwitchField label="Save as a file in the album folder" checked={rules.art.saveFile} onChange={(v) => set({ art: { ...rules.art, saveFile: v } })} />
              <Field label="Size">
                <SimpleSelect
                  value={rules.art.size}
                  onChange={(v) => set({ art: { ...rules.art, size: v } })}
                  options={[
                    { value: '500', label: '500 px' },
                    { value: '1200', label: '1200 px (recommended)' },
                    { value: 'original', label: 'Original (can be large)' },
                  ]}
                />
              </Field>
            </div>
          </Section>

          <Section title="Clean-up">
            <div className="divide-y">
              <Field label="Other files in album folders" hint=".cue, .log, booklets, old cover images…">
                <SimpleSelect
                  value={rules.leftovers}
                  onChange={(v) => set({ leftovers: v })}
                  options={[
                    { value: 'move-with-album', label: 'Move with the album' },
                    { value: 'leftovers-folder', label: 'Collect in _leftovers' },
                    { value: 'leave', label: 'Leave where they are' },
                  ]}
                />
              </Field>
              <Field label="Duplicate copies" hint="Lower-quality copies of the same track or album.">
                <SimpleSelect
                  value={rules.duplicates}
                  onChange={(v) => set({ duplicates: v })}
                  options={[
                    { value: 'move-to-duplicates', label: 'Move to _duplicates' },
                    { value: 'leave', label: 'Leave where they are' },
                  ]}
                />
              </Field>
              <SwitchField label="Delete empty folders" hint="After files move out. Undo brings them back." checked={rules.removeEmptyFolders} onChange={(v) => set({ removeEmptyFolders: v })} />
              <SwitchField label="Add genres" hint="Top genres voted on MusicBrainz." checked={rules.genres.enabled} onChange={(v) => set({ genres: { ...rules.genres, enabled: v } })} />
            </div>
          </Section>
        </div>

        <aside className="lg:sticky lg:top-6 lg:self-start">
          <div className="rounded-xl border bg-card/40">
            <div className="border-b px-5 py-4">
              <h2 className="text-sm font-medium">Preview</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">{state?.stats.byStatus.matched ? 'From your matched albums.' : 'An example album, until you’ve matched yours.'}</p>
            </div>
            <ul className="divide-y">
              {preview.map((p) => (
                <li key={p.from} className="space-y-1 px-5 py-3 font-mono text-[11.5px] leading-snug">
                  <div className="break-all text-muted-foreground line-through decoration-muted-foreground/40">{p.from}</div>
                  <ArrowDown className="size-3 text-muted-foreground/60" />
                  <div className="break-all text-foreground">{p.to}</div>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </>
  )
}

function TemplateInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Input className="font-mono text-xs" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}
