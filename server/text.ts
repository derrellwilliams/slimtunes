/** Lowercase, strip accents/punctuation and edition noise for fuzzy comparisons. */
export function normalize(s: string | undefined | null): string {
  if (!s) return ''
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\[[^\]]*\]|\((?:[^)]*(?:remaster|deluxe|edition|version|explicit|bonus|mono|stereo)[^)]*)\)/g, ' ')
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[b.length]
}

/** Similarity in 0..1 after normalization. */
export function similarity(a: string | undefined | null, b: string | undefined | null): number {
  const x = normalize(a)
  const y = normalize(b)
  if (!x && !y) return 1
  if (!x || !y) return 0
  if (x === y) return 1
  if (x.includes(y) || y.includes(x)) return 0.9 * (Math.min(x.length, y.length) / Math.max(x.length, y.length)) + 0.1
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length)
}

/** Strip a leading track number and separators from a filename: "03 - Song.mp3" -> "Song". */
export function titleFromFilename(file: string): string {
  return file
    .replace(/\.[^.]+$/, '')
    .replace(/^\s*(?:\d{1,2}[-.])?\d{1,3}\s*[-._)\]]?\s*/, '')
    .replace(/_/g, ' ')
    .trim()
}

export function year(date: string | null | undefined): string {
  return date?.slice(0, 4) ?? ''
}
