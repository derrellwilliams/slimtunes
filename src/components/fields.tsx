import type { ReactNode } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

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
  return (
    <Select items={options} value={value} onValueChange={(v) => v !== null && onChange(v as T)}>
      <SelectTrigger className={cn('min-w-40', className)}>
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
  return (
    <div className="flex items-center justify-between gap-6 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="mt-0.5 text-sm text-muted-foreground">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

export function SwitchField({ label, hint, checked, onChange }: { label: string; hint?: ReactNode; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <Field label={label} hint={hint}>
      <Switch checked={checked} onCheckedChange={onChange} />
    </Field>
  )
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
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-lg border px-3.5 py-3 text-left transition-colors hover:border-foreground/30',
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
