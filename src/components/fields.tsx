import { createContext, type ReactNode, useContext, useId } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

/** Ids of the enclosing Field's label and hint, so its control is announced with them. */
const FieldContext = createContext<{ 'aria-labelledby'?: string; 'aria-describedby'?: string }>({})
const useFieldLabel = () => useContext(FieldContext)

export function SimpleSelect<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
  className?: string
}) {
  const label = useFieldLabel()
  return (
    <Select items={options} value={value} onValueChange={(v) => v !== null && onChange(v as T)}>
      <SelectTrigger className={cn('min-w-40', className)} {...label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** A labeled row: text on the left, control on the right. */
export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  const id = useId()
  return (
    <div className="flex items-center justify-between gap-6 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <div id={`${id}-label`} className="text-sm font-medium">
          {label}
        </div>
        {hint && (
          <div id={`${id}-hint`} className="mt-0.5 text-sm text-muted-foreground">
            {hint}
          </div>
        )}
      </div>
      <FieldContext value={{ 'aria-labelledby': `${id}-label`, 'aria-describedby': hint ? `${id}-hint` : undefined }}>
        <div className="shrink-0">{children}</div>
      </FieldContext>
    </div>
  )
}

export function SwitchField({ label, hint, checked, onChange }: { label: string; hint?: ReactNode; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <Field label={label} hint={hint}>
      <FieldSwitch checked={checked} onChange={onChange} />
    </Field>
  )
}

function FieldSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return <Switch checked={checked} onCheckedChange={onChange} {...useFieldLabel()} />
}

/** Big clickable option cards (used for presets). */
export function ChoiceCards<T extends string>({
  value,
  onChange,
  options,
  columns = 1,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; title: ReactNode; description?: ReactNode }[]
  columns?: 1 | 2 | 3
}) {
  return (
    <div className={cn('grid gap-2', columns === 2 && 'sm:grid-cols-2', columns === 3 && 'sm:grid-cols-3')}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'focus-ring rounded-lg border px-3.5 py-3 text-left transition-colors hover:border-foreground/30',
            value === o.value ? 'border-foreground/60 bg-muted/50 ring-1 ring-foreground/20' : 'bg-transparent',
          )}
        >
          <div className="text-sm font-medium">{o.title}</div>
          {o.description && <div className="mt-0.5 text-xs text-muted-foreground">{o.description}</div>}
        </button>
      ))}
    </div>
  )
}
