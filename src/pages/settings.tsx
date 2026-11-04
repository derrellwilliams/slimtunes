import { CheckCircle2, ExternalLink, FolderOpen, XCircle } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Field, SwitchField } from '@/components/fields'
import { FolderPicker } from '@/components/folder-picker'
import { PageHeader, Section } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import { useApp } from '@/lib/app'

export function SettingsPage() {
  const { state } = useApp()
  const [key, setKey] = useState('')
  const [picker, setPicker] = useState(false)
  if (!state) return null

  const save = async (body: object, msg = 'Saved') => {
    try {
      await api('/settings', { method: 'PUT', body })
      toast.success(msg)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <>
      <PageHeader title="Settings" />
      <div className="max-w-3xl space-y-6">
        <Section
          title="Inbox"
          description="A folder where new downloads land. SlimTunes watches it, files confident matches into your library automatically, and sends the rest to Review."
        >
          <div className="divide-y">
            <Field
              label="Inbox folder"
              hint={state.inbox.path ? <span className="font-mono text-xs">{state.inbox.path}</span> : 'Must be outside your library folder.'}
            >
              <Button variant="outline" onClick={() => setPicker(true)}>
                <FolderOpen /> {state.inbox.path ? 'Change' : 'Choose'}
              </Button>
            </Field>
            <SwitchField label="Watch the inbox" checked={state.inbox.enabled} onChange={(v) => void save({ inbox: { enabled: v } })} />
            <SwitchField
              label="Organize confident matches automatically"
              hint="Off: everything waits for you in Review."
              checked={state.inbox.autoApply}
              onChange={(v) => void save({ inbox: { autoApply: v } })}
            />
            <Field label="Check now" hint="Normally runs 30 seconds after files stop arriving.">
              <Button variant="outline" disabled={!state.inbox.path} onClick={() => api('/inbox/process', { body: {} }).catch((e) => toast.error(e.message))}>
                Process inbox
              </Button>
            </Field>
          </div>
          <FolderPicker
            open={picker}
            onOpenChange={setPicker}
            title="Choose an inbox folder"
            description="New music dropped here gets matched and moved into your library."
            initial={state.inbox.path || undefined}
            onPick={(p) => void save({ inbox: { path: p } })}
          />
        </Section>

        <Section
          title="Audio fingerprinting"
          description="Identifies songs by how they sound, for files with missing or wrong tags. Uses the free AcoustID service."
        >
          <div className="divide-y">
            <Field
              label="Chromaprint (fpcalc)"
              hint={
                state.fpcalc ? (
                  'Installed.'
                ) : (
                  <>
                    Install with <code className="rounded bg-muted px-1">brew install chromaprint</code>, then restart SlimTunes.
                  </>
                )
              }
            >
              {state.fpcalc ? <CheckCircle2 aria-label="Installed" className="size-5 text-success" /> : <XCircle aria-label="Not installed" className="size-5 text-muted-foreground" />}
            </Field>
            <Field
              label="AcoustID API key"
              hint={
                <a href="https://acoustid.org/new-application" target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 underline">
                  Get a free key <ExternalLink className="size-3" />
                </a>
              }
            >
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  void save({ acoustidKey: key }, key ? 'Key saved' : 'Key removed')
                  setKey('')
                }}
              >
                <Input
                  aria-label="AcoustID API key"
                  type="password"
                  autoComplete="off"
                  placeholder={state.hasAcoustidKey ? '•••••••• saved' : 'Paste key'}
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  className="w-48"
                />
                <Button type="submit" variant="outline">
                  Save
                </Button>
              </form>
            </Field>
          </div>
        </Section>

        <Section title="Privacy">
          <p className="text-sm text-muted-foreground">
            SlimTunes runs only on this computer. It talks to musicbrainz.org, coverartarchive.org and (if you add a key) api.acoustid.org — sending album
            names, track lengths and audio fingerprints, never your files or personal details. Settings live in <code className="rounded bg-muted px-1">~/.slimtunes</code>.
          </p>
        </Section>
      </div>
    </>
  )
}
