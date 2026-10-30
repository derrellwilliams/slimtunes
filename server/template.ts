// Path templates: `{token}`, `{token:02}` zero-pads numbers, `[ ... ]` is dropped when any token inside is empty.

export type TemplateValues = Record<string, string | number | null | undefined>

const MAX_SEGMENT = 180 // bytes-ish; most filesystems cap a name at 255 bytes

export function sanitizeSegment(s: string): string {
  let out = s
    .normalize('NFC')
    .replace(/[/\\:*?"<>|]/g, (c) => (c === ':' ? ' -' : c === '/' || c === '\\' ? '-' : c === '"' ? "'" : ''))
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '') // no hidden files
    .replace(/[. ]+$/, '') // Windows/SMB dislike trailing dots and spaces
  while (Buffer.byteLength(out) > MAX_SEGMENT) out = out.slice(0, -1).trimEnd()
  return out || '_'
}

function renderToken(name: string, pad: string | undefined, values: TemplateValues): string {
  const v = values[name]
  if (v === null || v === undefined || v === '') return ''
  // A value can never introduce a folder: "AC/DC" -> "AC-DC".
  const s = String(v).replace(/[/\\]/g, '-')
  return pad && /^\d+$/.test(s) ? s.padStart(Number(pad), '0') : s
}

function renderFlat(tpl: string, values: TemplateValues): { text: string; missing: boolean } {
  let missing = false
  const text = tpl.replace(/\{(\w+)(?::(\d+))?\}/g, (_, name: string, pad?: string) => {
    const out = renderToken(name, pad, values)
    if (!out) missing = true
    return out
  })
  return { text, missing }
}

/** Render a template into a relative path (segments sanitized individually). */
export function renderTemplate(tpl: string, values: TemplateValues): string {
  const withOptionals = tpl.replace(/\[([^\]]*)\]/g, (_, inner: string) => {
    const r = renderFlat(inner, values)
    return r.missing ? '' : r.text
  })
  const raw = renderFlat(withOptionals, values).text
  return raw
    .split('/')
    .map((seg) => seg.replace(/\(\s*\)|\[\s*\]/g, '')) // "Album ()" when year is missing
    .map(sanitizeSegment)
    .filter((seg) => seg !== '_' || raw.split('/').length === 1)
    .join('/')
}

export const TEMPLATE_TOKENS = [
  'albumartist',
  'artist',
  'album',
  'year',
  'originalyear',
  'track',
  'tracktotal',
  'disc',
  'disctotal',
  'title',
  'type',
  'country',
  'label',
  'format',
] as const
